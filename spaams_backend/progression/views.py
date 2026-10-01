from collections import defaultdict

from django.db import transaction
from django.db.models import Max
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Admin, Student
from accounts.views import IsAdminRole
from academics.models import Semester, StudentEnrollment
from assessment.models import BoardMarks, StudentMarks
from attendance.models import Attendance
from .models import ArchiveAttendance, ArchivedStudent, ArchiveMarks, SemesterPromotion


class PromoteStudentView(APIView):
    """Records a semester promotion without creating a second login account."""
    permission_classes = [IsAdminRole]

    def post(self, request, student_id):
        target_id = request.data.get("to_semester_id")
        academic_year = request.data.get("academic_year")
        if not target_id or not academic_year:
            return Response({"message": "to_semester_id and academic_year are required."}, status=400)
        student = Student.objects.get(pk=student_id, status="Active")
        target = Semester.objects.get(pk=target_id)
        current = StudentEnrollment.objects.filter(student=student, status="Active").select_related("semester", "faculty").order_by("-academic_year", "-semester__semester_number").first()
        if not current or target.semester_number != current.semester.semester_number + 1:
            return Response({"message": "Promotion must move the current student to the next semester."}, status=400)
        admin = Admin.objects.get(user=request.user)
        with transaction.atomic():
            current.status = "Graduated"  # completed the prior semester; records remain as history
            current.save(update_fields=["status"])
            StudentEnrollment.objects.create(student=student, faculty=current.faculty, semester=target, academic_year=academic_year, status="Active")
            SemesterPromotion.objects.create(student=student, from_semester=current.semester, to_semester=target, promoted_by=admin)
        return Response({"success": True, "student_id": student.id, "semester": target.semester_name})


class PassOutStudentView(APIView):
    """Archives all marks/attendance for an 8th-semester student and disables their active account."""
    permission_classes = [IsAdminRole]

    def post(self, request, student_id):
        student = Student.objects.select_related("guardian").get(pk=student_id, status="Active")
        current = StudentEnrollment.objects.filter(student=student, status="Active").select_related("semester", "faculty").first()
        if not current or current.semester.semester_number != 8:
            return Response({"message": "Only active 8th-semester students can pass out."}, status=400)
        admin = Admin.objects.get(user=request.user)
        with transaction.atomic():
            archive = ArchivedStudent.objects.create(original_student_id=student.id, registration_number=student.registration_number,
                symbol_number=student.symbol_number, full_name=student.full_name, gender=student.gender, date_of_birth=student.date_of_birth,
                phone=student.phone, email=student.email, address=student.address, photo=student.photo,
                guardian_name=student.guardian.guardian_name, guardian_phone=student.guardian.phone, guardian_email=student.guardian.email,
                guardian_relationship=student.guardian.relationship, faculty_name=current.faculty.faculty_name,
                final_semester=current.semester, archived_by=admin)
            ArchiveMarks.objects.bulk_create([ArchiveMarks(archived_student=archive, subject_name=m.subject.subject_name,
                assessment_name=m.assessment.assessment_name, marks_obtained=m.marks_obtained, academic_year=m.academic_year)
                for m in StudentMarks.objects.filter(student=student).select_related("subject", "assessment")])
            attendance_rows = Attendance.objects.filter(student=student).select_related("session__subject")
            grouped = {}
            for row in attendance_rows:
                key = (row.session.subject.subject_name, row.session.semester_id)
                grouped.setdefault(key, [0, 0])
                grouped[key][0] += 1
                grouped[key][1] += row.status == "Present"
            ArchiveAttendance.objects.bulk_create([ArchiveAttendance(archived_student=archive, subject_name=subject,
                total_sessions=counts[0], total_present=counts[1], total_absent=counts[0] - counts[1], academic_year=current.academic_year)
                for (subject, _), counts in grouped.items()])
            StudentEnrollment.objects.filter(student=student, status="Active").update(status="Graduated")
            student.status = "Disabled"
            student.save(update_fields=["status"])
            student.user.status = "Disabled"
            student.user.save(update_fields=["status"])
        return Response({"success": True, "archive_id": archive.id})


class BatchPromotionView(APIView):
    """Promote one intake batch only, so two cohorts in the same semester never mix."""
    permission_classes = [IsAdminRole]

    def post(self, request):
        from_semester_id = request.data.get("from_semester_id")
        academic_year = request.data.get("academic_year")
        if not from_semester_id or not academic_year:
            return Response({"message": "from_semester_id and academic_year (the batch) are required."}, status=400)
        try:
            current_semester = Semester.objects.get(pk=from_semester_id)
            batch = int(academic_year)
        except (Semester.DoesNotExist, TypeError, ValueError):
            return Response({"message": "Choose a valid semester and batch."}, status=400)

        enrollments = StudentEnrollment.objects.filter(
            semester=current_semester, academic_year=batch, status="Active"
        ).select_related("student", "faculty", "student__guardian")
        total = enrollments.count()
        if not total:
            return Response({"message": f"No active students exist for the {batch} batch in {current_semester.semester_name}."}, status=400)
        admin = Admin.objects.get(user=request.user)

        if current_semester.semester_number < 8:
            target = Semester.objects.filter(semester_number=current_semester.semester_number + 1).first()
            if not target:
                return Response({"message": "The next semester has not been configured."}, status=400)
            with transaction.atomic():
                for current in enrollments.select_for_update():
                    current.status = "Graduated"  # completed this semester; it remains historical data
                    current.save(update_fields=["status"])
                    StudentEnrollment.objects.create(
                        student=current.student, faculty=current.faculty, semester=target,
                        academic_year=batch, status="Active"
                    )
                    SemesterPromotion.objects.create(
                        student=current.student, from_semester=current_semester,
                        to_semester=target, promoted_by=admin
                    )
            return Response({"success": True, "count": total, "batch": batch,
                             "from_semester": current_semester.semester_name,
                             "to_semester": target.semester_name, "archived": False})

        # Semester eight is the completion step: copy records to archive and disable the account.
        with transaction.atomic():
            for current in enrollments.select_for_update():
                student = current.student
                archive = ArchivedStudent.objects.create(
                    original_student_id=student.id, registration_number=student.registration_number,
                    symbol_number=student.symbol_number, full_name=student.full_name, gender=student.gender,
                    date_of_birth=student.date_of_birth, phone=student.phone, email=student.email,
                    address=student.address, photo=student.photo,
                    guardian_name=student.guardian.guardian_name, guardian_phone=student.guardian.phone,
                    guardian_email=student.guardian.email, guardian_relationship=student.guardian.relationship,
                    faculty_name=current.faculty.faculty_name, final_semester=current_semester, archived_by=admin,
                )
                ArchiveMarks.objects.bulk_create([
                    ArchiveMarks(archived_student=archive, subject_name=mark.subject.subject_name,
                                 assessment_name=mark.assessment.assessment_name,
                                 marks_obtained=mark.marks_obtained, academic_year=mark.academic_year)
                    for mark in StudentMarks.objects.filter(student=student).select_related("subject", "assessment")
                ])
                attendance_rows = Attendance.objects.filter(student=student).select_related("session__subject")
                grouped = {}
                for row in attendance_rows:
                    key = row.session.subject.subject_name
                    grouped.setdefault(key, [0, 0])
                    grouped[key][0] += 1
                    grouped[key][1] += row.status == "Present"
                ArchiveAttendance.objects.bulk_create([
                    ArchiveAttendance(archived_student=archive, subject_name=subject,
                                      total_sessions=counts[0], total_present=counts[1],
                                      total_absent=counts[0] - counts[1], academic_year=batch)
                    for subject, counts in grouped.items()
                ])
                current.status = "Graduated"
                current.save(update_fields=["status"])
                student.status = "Disabled"
                student.save(update_fields=["status"])
                student.user.status = "Disabled"
                student.user.save(update_fields=["status"])
        return Response({"success": True, "count": total, "batch": batch,
                         "from_semester": current_semester.semester_name,
                         "to_semester": "Data Storage Management", "archived": True})


class ArchiveStudentListView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        rows = ArchivedStudent.objects.select_related("final_semester").order_by("-archived_date")
        original_student_ids = [row.original_student_id for row in rows]
        batches = {
            item["student_id"]: item["batch"]
            for item in StudentEnrollment.objects.filter(student_id__in=original_student_ids)
            .values("student_id")
            .annotate(batch=Max("academic_year"))
        }

        # A CGPA is the average of the actual Board GPA from each semester
        # with saved board results. No value is returned until those results exist.
        semester_totals = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
        for mark in BoardMarks.objects.filter(student_id__in=original_student_ids).select_related("subject__semester"):
            totals = semester_totals[mark.student_id][mark.subject.semester_id]
            totals[0] += float(mark.marks_obtained)
            totals[1] += float(mark.maximum_marks)

        cgpAs = {}
        for student_id, semesters in semester_totals.items():
            semester_gpas = [obtained / maximum for obtained, maximum in semesters.values() if maximum]
            cgpAs[student_id] = round(sum(semester_gpas) / len(semester_gpas), 2) if semester_gpas else None

        return Response([{
            "id": row.id,
            "registration_number": row.registration_number,
            "full_name": row.full_name,
            "batch": batches.get(row.original_student_id),
            "cgpa": cgpAs.get(row.original_student_id),
        } for row in rows])
