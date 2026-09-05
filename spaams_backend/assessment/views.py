from django.db import transaction
from django.db.models import Prefetch
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import StudentEnrollment, TeacherAssignment
from accounts.models import Admin, Teacher
from accounts.views import IsAdminRole
from .models import AssessmentType, BoardMarks, StudentMarks
from .serializers import AssessmentTypeSerializer, BoardMarksSerializer


class IsTeacherRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "Teacher"


class AssessmentTypeListView(APIView):
    permission_classes = [IsTeacherRole | IsAdminRole]

    def get(self, request):
        return Response(AssessmentTypeSerializer(AssessmentType.objects.all().order_by("assessment_name"), many=True).data)


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
    permission_classes = [IsTeacherRole]

    def _assignment(self, request, subject_id, academic_year):
        return TeacherAssignment.objects.filter(
            teacher__user=request.user, subject_id=subject_id, academic_year=academic_year, status="Active"
        ).select_related("semester", "subject").first()

    def get(self, request):
        subject_id = request.query_params.get("subject_id")
        academic_year = request.query_params.get("academic_year")
        if not subject_id or not academic_year:
            return Response({"message": "subject_id and academic_year are required."}, status=400)
        assignment = self._assignment(request, subject_id, academic_year)
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        students = StudentEnrollment.objects.filter(
            semester=assignment.semester, academic_year=academic_year, status="Active"
        ).select_related("student", "student__guardian").order_by("student__full_name")
        marks = StudentMarks.objects.filter(subject_id=subject_id, academic_year=academic_year)
        by_student = {}
        for mark in marks:
            by_student.setdefault(mark.student_id, {})[str(mark.assessment_id)] = float(mark.marks_obtained)
        return Response({
            "assignment": {"subject_id": assignment.subject_id, "subject_name": assignment.subject.subject_name,
                           "semester_id": assignment.semester_id, "semester_number": assignment.semester.semester_number},
            "assessment_types": AssessmentTypeSerializer(AssessmentType.objects.all().order_by("assessment_name"), many=True).data,
            "students": [{"id": e.student_id, "registration_number": e.student.registration_number,
                          "symbol_number": e.student.symbol_number, "full_name": e.student.full_name,
                          "gender": e.student.gender, "date_of_birth": e.student.date_of_birth,
                          "phone": e.student.phone, "email": e.student.email, "address": e.student.address,
                          "guardian_name": e.student.guardian.guardian_name,
                          "guardian_phone": e.student.guardian.phone,
                          "guardian_email": e.student.guardian.email,
                          "marks": by_student.get(e.student_id, {})} for e in students],
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
        valid_students = set(StudentEnrollment.objects.filter(semester=assignment.semester, academic_year=academic_year, status="Active").values_list("student_id", flat=True))
        valid_assessments = {a.id: a for a in AssessmentType.objects.all()}
        with transaction.atomic():
            for entry in entries:
                student_id, assessment_id, value = entry.get("student_id"), entry.get("assessment_id"), entry.get("marks_obtained")
                if student_id not in valid_students or assessment_id not in valid_assessments:
                    return Response({"message": "An entry has an invalid student or assessment."}, status=400)
                if value is None or float(value) < 0 or float(value) > valid_assessments[assessment_id].maximum_marks:
                    return Response({"message": "Marks must be within the assessment maximum."}, status=400)
                StudentMarks.objects.update_or_create(
                    student_id=student_id, subject_id=subject_id, assessment_id=assessment_id, academic_year=academic_year,
                    defaults={"teacher": Teacher.objects.get(user=request.user), "marks_obtained": value},
                )
        return Response({"success": True, "updated": len(entries)}, status=status.HTTP_200_OK)

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
