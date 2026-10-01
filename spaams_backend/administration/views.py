import csv
import io
import json
import secrets
from datetime import date

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Admin, PasswordReset, Student, Teacher, UserLogin
from accounts.views import IsAdminRole
from academics.models import Faculty, Guardian, Semester, StudentEnrollment, Subject, TeacherAssignment
from analytics.models import PerformanceAnalytics
from assessment.models import AssessmentType, BoardMarks, StudentMarks
from attendance.models import Attendance, AttendanceSession, SmsHistory
from progression.models import ArchiveAttendance, ArchiveMarks, ArchivedStudent, SemesterPromotion
from .models import CsvUploadHistory


STUDENT_IMPORT_REQUIRED_COLUMNS = {
    "registration_number", "full_name", "gender", "date_of_birth", "phone", "address",
    "guardian_name", "guardian_phone", "faculty", "semester_number", "academic_year",
}


def clean_csv_heading(value):
    """Make CSV heading comparison resilient to Excel/BOM/quote whitespace."""
    return str(value or "").replace("\ufeff", "").strip().strip('"').strip("'").strip()


def validate_student_import(rows, mapping, headers, allow_existing=False):
    """Validate a roster against the live database without inserting records."""
    errors = []
    headers = {clean_csv_heading(header) for header in headers}
    mapping = {clean_csv_heading(field): clean_csv_heading(heading) for field, heading in mapping.items()}
    missing_fields = STUDENT_IMPORT_REQUIRED_COLUMNS.difference(mapping)
    missing_headings = {heading for heading in mapping.values() if heading not in headers}
    if missing_fields:
        errors.append({"row": None, "message": f"Required fields not mapped: {', '.join(sorted(missing_fields))}"})
    if missing_headings:
        errors.append({"row": None, "message": f"Selected CSV heading(s) not found: {', '.join(sorted(missing_headings))}"})
    if len(mapping.values()) != len(set(mapping.values())):
        errors.append({"row": None, "message": "One uploaded heading cannot be mapped to more than one SPAAMS field."})
    if errors:
        return errors

    existing = set(Student.objects.values_list("registration_number", flat=True))
    seen, faculties = set(), set(Faculty.objects.values_list("faculty_name", flat=True))
    semesters = set(Semester.objects.values_list("semester_number", flat=True))
    for row_number, source_row in enumerate(rows, start=2):
        row = StudentImportView._normalise_row(source_row, mapping)
        row_errors = []
        blanks = [field for field in STUDENT_IMPORT_REQUIRED_COLUMNS if not row.get(field)]
        if blanks:
            row_errors.append(f"blank required value(s): {', '.join(sorted(blanks))}")
        registration = row.get("registration_number", "")
        if registration in existing and not allow_existing:
            row_errors.append("registration number already exists in the database")
        if registration and registration in seen:
            row_errors.append("registration number is repeated in this CSV")
        seen.add(registration)
        if row.get("gender") and row["gender"] not in {"Male", "Female", "Other"}:
            row_errors.append("gender must be Male, Female, or Other")
        if row.get("faculty") and row["faculty"] not in faculties:
            row_errors.append(f"faculty '{row['faculty']}' does not exist")
        try:
            if row.get("semester_number") and int(row["semester_number"]) not in semesters:
                row_errors.append("semester_number must be from 1 to 8")
        except ValueError:
            row_errors.append("semester_number must be a number")
        try:
            if row.get("academic_year"):
                int(row["academic_year"])
        except ValueError:
            row_errors.append("academic_year must be a number")
        try:
            if row.get("date_of_birth"):
                date.fromisoformat(row["date_of_birth"])
        except ValueError:
            row_errors.append("date_of_birth must use YYYY-MM-DD")
        if row_errors:
            errors.append({"row": row_number, "message": "; ".join(row_errors)})
    return errors


class StudentExportView(APIView):
    """Export all students or one semester/year as a portable CSV file."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        semester_id, academic_year = request.query_params.get("semester_id"), request.query_params.get("academic_year")
        enrollments = StudentEnrollment.objects.select_related("student", "student__guardian", "faculty", "semester")
        if semester_id:
            enrollments = enrollments.filter(semester_id=semester_id)
        if academic_year:
            enrollments = enrollments.filter(academic_year=academic_year)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="spaams_students.csv"'
        writer = csv.writer(response)
        writer.writerow(["registration_number", "full_name", "gender", "date_of_birth", "phone", "address", "guardian_name", "guardian_phone", "guardian_email", "faculty", "semester_number", "academic_year"])
        for e in enrollments.order_by("semester__semester_number", "student__registration_number"):
            s, g = e.student, e.student.guardian
            writer.writerow([s.registration_number, s.full_name, s.gender, s.date_of_birth, s.phone, s.address, g.guardian_name, g.phone, g.email or "", e.faculty.faculty_name, e.semester.semester_number, e.academic_year])
        return response


class StudentImportView(APIView):
    """Import a semester roster. Invalid rows are reported without rolling back valid rows."""
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]
    required_columns = STUDENT_IMPORT_REQUIRED_COLUMNS

    @staticmethod
    def _normalise_row(row, mapping):
        """Convert administrator-selected CSV headings to SPAAMS field names."""
        return {
            field: str(row.get(source, "")).strip()
            for field, source in mapping.items()
        }

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload or not upload.name.lower().endswith(".csv"):
            return Response({"message": "Upload a CSV file."}, status=400)
        rows = list(csv.DictReader(io.TextIOWrapper(upload.file, encoding="utf-8-sig")))
        if not rows:
            return Response({"message": "The CSV file has no data rows."}, status=400)

        try:
            mapping = json.loads(request.data.get("field_mapping", "{}"))
        except json.JSONDecodeError:
            return Response({"message": "The CSV column mapping is invalid."}, status=400)
        headers = set(rows[0].keys())
        if not mapping:
            mapping = {column: column for column in headers}
        # Existing registration numbers are safely skipped below. This lets an
        # interrupted upload resume without creating duplicate student accounts.
        validation_errors = validate_student_import(rows, mapping, headers, allow_existing=True)
        if validation_errors:
            return Response({"message": "Fix the CSV validation errors before importing.", "errors": validation_errors}, status=400)
        admin = Admin.objects.get(user=request.user)
        success, skipped, errors = 0, 0, []
        for row_number, source_row in enumerate(rows, start=2):
            try:
                with transaction.atomic():
                    row = self._normalise_row(source_row, mapping)
                    if any(not row.get(column) for column in self.required_columns):
                        raise ValueError("A required value is blank")
                    if Student.objects.filter(registration_number=row["registration_number"].strip()).exists():
                        skipped += 1
                        continue
                    faculty = Faculty.objects.get(faculty_name=row["faculty"].strip())
                    semester = Semester.objects.get(semester_number=int(row["semester_number"]))
                    guardian = Guardian.objects.create(guardian_name=row["guardian_name"].strip(), phone=row["guardian_phone"].strip(), email=row.get("guardian_email") or None)
                    reg = row["registration_number"].strip()
                    temporary_password = f"Spaams!{secrets.token_urlsafe(9)}"
                    user = UserLogin(username=reg, role="Student", first_login=True, status="Active", temp_password_plain=temporary_password)
                    user.set_password(temporary_password)
                    user.save()
                    student = Student.objects.create(user=user, guardian=guardian, registration_number=reg, full_name=row["full_name"].strip(), gender=row["gender"].strip(), date_of_birth=row["date_of_birth"], phone=row["phone"].strip(), email=row.get("email") or None, address=row["address"].strip())
                    StudentEnrollment.objects.create(student=student, faculty=faculty, semester=semester, academic_year=int(row["academic_year"]), status="Active")
                    success += 1
            except Exception as exc:
                errors.append({"row": row_number, "message": str(exc)})
        CsvUploadHistory.objects.create(uploaded_by=admin, file_name=upload.name, total_records=len(rows), success_records=success, failed_records=len(errors))
        return Response({"success": success, "skipped": skipped, "failed": len(errors), "errors": errors})


class StudentImportPreviewView(APIView):
    """Validates a CSV without changing MySQL."""
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload or not upload.name.lower().endswith(".csv"):
            return Response({"message": "Upload a CSV file."}, status=400)
        rows = list(csv.DictReader(io.TextIOWrapper(upload.file, encoding="utf-8-sig")))
        if not rows:
            return Response({"message": "The CSV file has no data rows."}, status=400)
        try:
            mapping = json.loads(request.data.get("field_mapping", "{}"))
        except json.JSONDecodeError:
            return Response({"message": "The CSV column mapping is invalid."}, status=400)
        headers = {clean_csv_heading(header) for header in rows[0].keys()}
        errors = validate_student_import(rows, mapping, headers, allow_existing=True)
        existing = set(Student.objects.values_list("registration_number", flat=True))
        duplicate_count = sum(1 for row in rows if str(row.get(mapping.get("registration_number", ""), "")).strip() in existing)
        return Response({"valid": not errors, "headers": list(headers), "total_rows": len(rows), "already_imported": duplicate_count, "errors": errors})


class OperationalDataResetView(APIView):
    """Remove operational data while retaining administrator accounts."""

    permission_classes = [IsAdminRole]
    confirmation_phrase = "RESET ALL DATA"

    def post(self, request):
        if request.data.get("confirmation") != self.confirmation_phrase:
            return Response({"message": "Confirmation phrase did not match."}, status=400)
        if not request.user.check_password(request.data.get("password", "")):
            return Response({"message": "The admin password is incorrect."}, status=403)
        supplied_code = str(request.data.get("secret_code", ""))
        if not settings.ADMIN_DATA_RESET_CODE or not secrets.compare_digest(supplied_code, settings.ADMIN_DATA_RESET_CODE):
            return Response({"message": "The security code is incorrect."}, status=403)

        with transaction.atomic():
            deleted = {
                "students": Student.objects.count(),
                "teachers": Teacher.objects.count(),
                "attendance_sessions": AttendanceSession.objects.count(),
                "marks": StudentMarks.objects.count() + BoardMarks.objects.count(),
            }

            # Delete dependent records first so database-level protected
            # relationships never leave partial records behind.
            PerformanceAnalytics.objects.all().delete()
            SmsHistory.objects.all().delete()
            Attendance.objects.all().delete()
            AttendanceSession.objects.all().delete()
            StudentMarks.objects.all().delete()
            BoardMarks.objects.all().delete()
            SemesterPromotion.objects.all().delete()
            ArchiveMarks.objects.all().delete()
            ArchiveAttendance.objects.all().delete()
            ArchivedStudent.objects.all().delete()
            TeacherAssignment.objects.all().delete()
            StudentEnrollment.objects.all().delete()
            AssessmentType.objects.all().delete()
            Student.objects.all().delete()
            Teacher.objects.all().delete()
            Guardian.objects.all().delete()
            Subject.objects.all().delete()
            Semester.objects.all().delete()
            Faculty.objects.all().delete()
            CsvUploadHistory.objects.all().delete()
            PasswordReset.objects.filter(user__role__in=["Student", "Teacher"]).delete()

            # Every admin account and its password-reset records remain
            # available, so a new import can begin immediately.
            UserLogin.objects.filter(role__in=["Student", "Teacher"]).delete()

        return Response({"message": "Existing operational data was removed. Your admin account is still active.", "deleted": deleted})


class TeacherExportView(APIView):
    """Export real teacher records without passwords or password hashes."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="spaams_teachers.csv"'
        writer = csv.writer(response)
        writer.writerow(["username", "teacher_name", "gender", "email", "phone", "qualification", "joining_date", "status"])
        for teacher in Teacher.objects.select_related("user").order_by("teacher_name"):
            writer.writerow([teacher.user.username, teacher.teacher_name, teacher.gender, teacher.email, teacher.phone, teacher.qualification or "", teacher.joining_date or "", teacher.status])
        return response


class TeacherImportView(APIView):
    """Bulk import teachers. Passwords are generated, never imported in CSV."""
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]
    required_columns = {"teacher_name", "email", "phone", "qualification"}

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload or not upload.name.lower().endswith(".csv"):
            return Response({"message": "Upload a teacher CSV file."}, status=400)
        rows = list(csv.DictReader(io.TextIOWrapper(upload.file, encoding="utf-8-sig")))
        if not rows or not self.required_columns.issubset(rows[0].keys()):
            return Response({"message": f"CSV needs these columns: {', '.join(sorted(self.required_columns))}. Optional: username, gender, joining_date, status."}, status=400)
        success, errors = 0, []
        for row_number, row in enumerate(rows, start=2):
            try:
                with transaction.atomic():
                    name, email, phone = row["teacher_name"].strip(), row["email"].strip(), row["phone"].strip()
                    if Teacher.objects.filter(email=email).exists() or Teacher.objects.filter(phone=phone).exists():
                        raise ValueError("Teacher email or phone already exists")
                    username = row.get("username", "").strip() or f"teacher{Teacher.objects.count() + 1:02d}"
                    if UserLogin.objects.filter(username=username).exists():
                        raise ValueError("Username already exists")
                    temporary_password = f"Spaams!{secrets.token_urlsafe(9)}"
                    user = UserLogin(username=username, role="Teacher", first_login=True, status="Active", temp_password_plain=temporary_password)
                    user.set_password(temporary_password)
                    user.save()
                    Teacher.objects.create(user=user, teacher_name=name, email=email, phone=phone,
                        gender=row.get("gender", "Other").strip() or "Other",
                        qualification=row["qualification"].strip(), joining_date=row.get("joining_date") or None,
                        status=row.get("status", "Active").strip() or "Active")
                    success += 1
            except Exception as exc:
                errors.append({"row": row_number, "message": str(exc)})
        admin = Admin.objects.get(user=request.user)
        CsvUploadHistory.objects.create(uploaded_by=admin, file_name=upload.name, total_records=len(rows), success_records=success, failed_records=len(errors))
        return Response({"success": success, "failed": len(errors), "errors": errors})
