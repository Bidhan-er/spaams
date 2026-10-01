import logging
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from types import SimpleNamespace

from django.db import transaction
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import StudentEnrollment, Subject, TeacherAssignment
from accounts.models import Admin, Teacher
from accounts.views import IsAdminRole
from .models import AssessmentType, BoardMarks, StudentMarks
from .serializers import AssessmentTypeSerializer, BoardMarksSerializer
from .performance import CATEGORY_TOTALS, ENTRY_FULL_MARKS, FIXED_ASSESSMENT_CATEGORIES, FLEXIBLE_CATEGORIES, canonical_category, student_performance


logger = logging.getLogger(__name__)
GROUP_CATEGORIES = set(CATEGORY_TOTALS) - {"Attendance"}
FIXED_PASS_MARKS = {"Midterm": Decimal("24"), "Preboard": Decimal("24")}


def _allocation(total, count):
    """Two-decimal allocation that always sums exactly to the category total."""
    base = (total / count).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    pennies = int((total - base * count) * 100)
    return [base + (Decimal("0.01") if index < pennies else Decimal("0")) for index in range(count)]


def _ensure_fixed_columns(subject_id):
    for category in FIXED_ASSESSMENT_CATEGORIES:
        column, _ = AssessmentType.objects.get_or_create(
            subject_id=subject_id, category=category,
            defaults={"assessment_name": category, "maximum_marks": ENTRY_FULL_MARKS[category], "pass_marks": FIXED_PASS_MARKS.get(category, Decimal("0"))},
        )
        # Existing Midterm/Preboard columns are upgraded to the new raw
        # examination scale on their next use.
        if Decimal(column.maximum_marks) != ENTRY_FULL_MARKS[category] or Decimal(column.pass_marks) != FIXED_PASS_MARKS.get(category, Decimal("0")):
            column.maximum_marks = ENTRY_FULL_MARKS[category]
            column.pass_marks = FIXED_PASS_MARKS.get(category, Decimal("0"))
            column.save(update_fields=["maximum_marks", "pass_marks"])


def _legacy_category(name):
    """Classify older columns created before the category field existed."""
    value = name.lower()
    if "unit" in value or "test" in value:
        return "Unit Test"
    if "assign" in value:
        return "Assignments"
    if "lab" in value:
        return "Lab Reports"
    if "groom" in value:
        return "Grooming"
    if "mid" in value:
        return "Midterm"
    if "pre" in value:
        return "Preboards"
    return "Other"


class IsTeacherRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "Teacher"


class AssessmentTypeListView(APIView):
    permission_classes = [IsTeacherRole | IsAdminRole]

    def get(self, request):
        return Response(AssessmentTypeSerializer(AssessmentType.objects.all().order_by("assessment_name"), many=True).data)


class TeacherAssessmentColumnView(APIView):
    """Teachers can manage assessment columns only for subjects assigned to them."""
    permission_classes = [IsTeacherRole | IsAdminRole]

    @staticmethod
    def _assignment(request, subject_id, academic_year):
        filters = {"subject_id": subject_id, "academic_year": academic_year, "status": "Active"}
        if request.user.role == "Teacher":
            filters["teacher__user"] = request.user
            return TeacherAssignment.objects.filter(**filters).first()
        # Admin owns system-wide academic management, including subjects that
        # are awaiting their first teacher assignment.
        return TeacherAssignment.objects.filter(**filters).first() or Subject.objects.filter(pk=subject_id).first()

    def post(self, request):
        subject_id = request.data.get("subject_id")
        academic_year = request.data.get("academic_year")
        name = str(request.data.get("assessment_name", "")).strip()
        category = canonical_category(request.data.get("category"))
        if not self._assignment(request, subject_id, academic_year):
            message = "Select an existing subject before adding an assessment column." if request.user.role == "Admin" else "You are not assigned to this subject and batch."
            return Response({"message": message}, status=403)
        if not name or category not in FLEXIBLE_CATEGORIES:
            return Response({"message": "Only Assignments, Unit Tests, and Lab Reports can have dynamic columns. Fixed category full marks cannot be changed."}, status=400)
        if AssessmentType.objects.filter(subject_id=subject_id, assessment_name__iexact=name).exists():
            return Response({"message": "This column already exists for the subject."}, status=400)
        with transaction.atomic():
            existing = list(AssessmentType.objects.select_for_update().filter(subject_id=subject_id, category__in=[category, "Unit Test"] if category == "Unit Tests" else [category]).order_by("id"))
            allocation = _allocation(CATEGORY_TOTALS[category], len(existing) + 1)
            existing_marks = StudentMarks.objects.filter(subject_id=subject_id, assessment_id__in=[item.id for item in existing], marks_obtained__isnull=False)
            if existing_marks.exists() and not request.data.get("confirm_reallocation"):
                return Response({"message": "This reallocates full marks for existing columns. Saved marks will be preserved; review and confirm to continue.", "requires_confirmation": True}, status=409)
            if existing_marks.filter(marks_obtained__gt=max(allocation)).exists():
                return Response({"message": "Existing marks exceed the proposed redistributed full marks. Edit those marks first; no data was changed."}, status=409)
            for item, full_marks in zip(existing, allocation):
                item.maximum_marks = full_marks
                item.save(update_fields=["maximum_marks"])
            column = AssessmentType.objects.create(subject_id=subject_id, assessment_name=name, maximum_marks=allocation[-1], pass_marks=0, category=category)
            # A deliberately created new assessment starts at zero for the
            # whole selected batch.  This is different from an old blank
            # field: it must not receive the provisional full-mark treatment.
            semester_id = Subject.objects.only("semester_id").get(pk=subject_id).semester_id
            enrolled_student_ids = StudentEnrollment.objects.filter(
                semester_id=semester_id, academic_year=academic_year,
                status="Active", student__status="Active",
            ).values_list("student_id", flat=True)
            default_teacher = getattr(self._assignment(request, subject_id, academic_year), "teacher", None)
            StudentMarks.objects.bulk_create([
                StudentMarks(
                    student_id=student_id, subject_id=subject_id,
                    assessment=column, academic_year=academic_year,
                    teacher=default_teacher, marks_obtained=Decimal("0"),
                    mark_status="Entered",
                ) for student_id in enrolled_student_ids
            ], ignore_conflicts=True)
        return Response(AssessmentTypeSerializer(column).data, status=status.HTTP_201_CREATED)

    def delete(self, request, assessment_id):
        subject_id = request.data.get("subject_id")
        academic_year = request.data.get("academic_year")
        if not self._assignment(request, subject_id, academic_year):
            message = "Select an existing subject before deleting an assessment column." if request.user.role == "Admin" else "You are not assigned to this subject and batch."
            return Response({"message": message}, status=403)
        column = AssessmentType.objects.filter(pk=assessment_id, subject_id=subject_id).first()
        if not column:
            return Response({"message": "Assessment column not found for this subject."}, status=404)
        category = canonical_category(column.category)
        if category not in FLEXIBLE_CATEGORIES:
            return Response({"message": "Fixed categories cannot be removed."}, status=400)
        saved_marks = StudentMarks.objects.filter(subject_id=subject_id, assessment=column, marks_obtained__isnull=False)
        if saved_marks.exists() and not request.data.get("confirm_delete"):
            return Response({"message": f"This permanently deletes {saved_marks.count()} saved mark(s). Confirm deletion to continue.", "requires_confirmation": True}, status=409)
        siblings = list(AssessmentType.objects.filter(subject_id=subject_id, category=column.category).exclude(pk=column.pk).order_by("id"))
        StudentMarks.objects.filter(subject_id=subject_id, assessment=column).delete()
        column.delete()
        for item, full_marks in zip(siblings, _allocation(CATEGORY_TOTALS[category], len(siblings))):
            item.maximum_marks = full_marks
            item.save(update_fields=["maximum_marks"])
        return Response({"success": True})


class BoardMarksViewSet(viewsets.ModelViewSet):
    """Board marks are exclusively controlled by Admin—not teachers."""
    queryset = BoardMarks.objects.select_related("student", "subject", "admin").all()
    serializer_class = BoardMarksSerializer
    permission_classes = [IsAdminRole]

    def perform_create(self, serializer):
        serializer.save(admin=Admin.objects.get(user=self.request.user))

    def perform_update(self, serializer):
        serializer.save(admin=Admin.objects.get(user=self.request.user))


class TeacherMarksView(APIView):
    """Read and bulk upsert a teacher's marks for one assigned subject."""
    permission_classes = [IsTeacherRole | IsAdminRole]

    def _assignment(self, request, subject_id, academic_year):
        filters = {"subject_id": subject_id, "academic_year": academic_year, "status": "Active"}
        if request.user.role == "Teacher":
            filters["teacher__user"] = request.user
            return TeacherAssignment.objects.filter(**filters).select_related("semester", "subject", "teacher").first()
        assignment = TeacherAssignment.objects.filter(**filters).select_related("semester", "subject", "teacher").first()
        if assignment:
            return assignment
        subject = Subject.objects.select_related("semester").filter(pk=subject_id).first()
        return SimpleNamespace(subject=subject, subject_id=subject_id, semester=subject.semester, semester_id=subject.semester_id, teacher=None) if subject else None

    def get(self, request):
        subject_id = request.query_params.get("subject_id")
        academic_year = request.query_params.get("academic_year")
        if not subject_id or not academic_year:
            return Response({"message": "subject_id and academic_year are required."}, status=400)
        assignment = self._assignment(request, subject_id, academic_year)
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        _ensure_fixed_columns(subject_id)
        students = StudentEnrollment.objects.filter(
            semester=assignment.semester, academic_year=academic_year, status="Active",
            student__status="Active"
        ).select_related("student", "student__guardian").order_by("student__full_name")
        # Only surface marks entered by the logged-in teacher. The assignment
        # check above already guarantees this teacher owns this class/batch.
        marks = StudentMarks.objects.filter(subject_id=subject_id, academic_year=academic_year)
        if request.user.role == "Teacher":
            marks = marks.filter(teacher__user=request.user)
        by_student = {}
        for mark in marks:
            by_student.setdefault(mark.student_id, {})[str(mark.assessment_id)] = {"obtained": float(mark.marks_obtained) if mark.marks_obtained is not None else None, "status": mark.mark_status}
        board_marks = {row.student_id: row for row in BoardMarks.objects.filter(subject_id=subject_id, academic_year=academic_year)}
        columns = list(AssessmentType.objects.filter(subject_id=subject_id).order_by("assessment_name"))
        for column in columns:
            column.category = canonical_category(column.category if column.category != "Other" else _legacy_category(column.assessment_name))
        return Response({
            "assignment": {"subject_id": assignment.subject_id, "subject_name": assignment.subject.subject_name,
                           "semester_id": assignment.semester_id, "semester_number": assignment.semester.semester_number},
            "assessment_types": AssessmentTypeSerializer(columns, many=True).data,
            "students": [{"id": e.student_id, "registration_number": e.student.registration_number,
                          "symbol_number": e.student.symbol_number, "full_name": e.student.full_name,
                          "gender": e.student.gender, "date_of_birth": e.student.date_of_birth,
                          "phone": e.student.phone, "email": e.student.email, "address": e.student.address,
                          "guardian_name": e.student.guardian.guardian_name,
                          "guardian_phone": e.student.guardian.phone,
                          "guardian_email": e.student.guardian.email,
                          "marks": by_student.get(e.student_id, {}),
                          "performance": student_performance(e.student_id, int(subject_id), int(academic_year), assignment.semester_id),
                          "board_exam": (float(board_marks[e.student_id].marks_obtained) if e.student_id in board_marks else None),
                          "board_exam_id": (board_marks[e.student_id].id if e.student_id in board_marks else None),
                          "board_exam_maximum": 4} for e in students],
        })

    def post(self, request):
        subject_id = request.data.get("subject_id")
        academic_year = request.data.get("academic_year")
        entries = request.data.get("marks", [])
        if not subject_id or not academic_year or not isinstance(entries, list):
            return Response({"message": "subject_id, academic_year and marks are required."}, status=400)
        assignment = self._assignment(request, subject_id, academic_year)
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        valid_students = set(StudentEnrollment.objects.filter(
            semester=assignment.semester, academic_year=academic_year,
            status="Active", student__status="Active"
        ).values_list("student_id", flat=True))
        valid_assessments = {a.id: a for a in AssessmentType.objects.filter(subject_id=subject_id)}
        with transaction.atomic():
            for entry in entries:
                # JSON form fields arrive as strings in some browsers.  Convert
                # them before checking membership against integer primary keys.
                try:
                    student_id = int(entry.get("student_id"))
                    assessment_id = int(entry.get("assessment_id"))
                except (TypeError, ValueError):
                    return Response({"message": "Each mark must identify a valid student and assessment column."}, status=400)
                value = entry.get("marks_obtained")
                mark_status = entry.get("mark_status", "Entered")
                if student_id not in valid_students or assessment_id not in valid_assessments:
                    return Response({"message": "An entry has an invalid student or assessment."}, status=400)
                if value == "":
                    value = None
                try:
                    value = Decimal(str(value)) if value is not None else None
                except (InvalidOperation, ValueError):
                    return Response({"message": "Marks must be a valid number."}, status=400)
                maximum = Decimal(valid_assessments[assessment_id].maximum_marks)
                if value is not None and (value < 0 or value > maximum):
                    return Response({"message": f"Please enter a value between 0 and {maximum.normalize()}."}, status=400)
                if value is not None:
                    mark_status = "Entered"
                if mark_status not in dict(StudentMarks.MARK_STATUS_CHOICES):
                    return Response({"message": "Invalid mark status."}, status=400)
                StudentMarks.objects.update_or_create(
                    student_id=student_id, subject_id=subject_id, assessment_id=assessment_id, academic_year=academic_year,
                    defaults={"teacher": (Teacher.objects.get(user=request.user) if request.user.role == "Teacher" else assignment.teacher), "marks_obtained": value, "mark_status": mark_status},
                )
        performance = {str(student_id): student_performance(student_id, int(subject_id), int(academic_year), assignment.semester_id) for student_id in {int(item["student_id"]) for item in entries}}
        return Response({"success": True, "updated": len(entries), "performance": performance}, status=status.HTTP_200_OK)

    def delete(self, request):
        subject_id = request.data.get("subject_id")
        academic_year = request.data.get("academic_year")
        student_id = request.data.get("student_id")
        assessment_id = request.data.get("assessment_id")
        assignment = self._assignment(request, subject_id, academic_year) if subject_id and academic_year else None
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        deleted, _ = StudentMarks.objects.filter(student_id=student_id, subject_id=subject_id, assessment_id=assessment_id, academic_year=academic_year, teacher__user=request.user).delete()
        return Response({"success": True, "deleted": deleted})
