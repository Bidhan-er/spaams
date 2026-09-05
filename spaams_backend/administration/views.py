import csv
import io
import json

from django.db import transaction
from django.http import HttpResponse
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Admin, Student, Teacher, UserLogin
from accounts.views import IsAdminRole
from academics.models import Faculty, Guardian, Semester, StudentEnrollment
from .models import CsvUploadHistory


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
    required_columns = {"registration_number", "full_name", "gender", "date_of_birth", "phone", "address", "guardian_name", "guardian_phone", "faculty", "semester_number", "academic_year"}

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
        missing_fields = self.required_columns.difference(mapping)
        missing_headings = {heading for heading in mapping.values() if heading not in headers}
        if missing_fields or missing_headings:
            details = []
            if missing_fields:
                details.append(f"required fields not mapped: {', '.join(sorted(missing_fields))}")
            if missing_headings:
                details.append(f"CSV headings not found: {', '.join(sorted(missing_headings))}")
            return Response({"message": "; ".join(details)}, status=400)
        admin = Admin.objects.get(user=request.user)
        success, errors = 0, []
        for row_number, source_row in enumerate(rows, start=2):
            try:
                with transaction.atomic():
                    row = self._normalise_row(source_row, mapping)
                    if any(not row.get(column) for column in self.required_columns):
                        raise ValueError("A required value is blank")
                    if Student.objects.filter(registration_number=row["registration_number"].strip()).exists():
                        raise ValueError("Registration number already exists")
                    faculty = Faculty.objects.get(faculty_name=row["faculty"].strip())
                    semester = Semester.objects.get(semester_number=int(row["semester_number"]))
                    guardian = Guardian.objects.create(guardian_name=row["guardian_name"].strip(), phone=row["guardian_phone"].strip(), email=row.get("guardian_email") or None)
                    reg = row["registration_number"].strip()
                    user = UserLogin(username=reg, role="Student", first_login=True, status="Active")
                    user.set_password(f"{reg}@123")
                    user.save()
                    student = Student.objects.create(user=user, guardian=guardian, registration_number=reg, full_name=row["full_name"].strip(), gender=row["gender"].strip(), date_of_birth=row["date_of_birth"], phone=row["phone"].strip(), email=row.get("email") or None, address=row["address"].strip())
                    StudentEnrollment.objects.create(student=student, faculty=faculty, semester=semester, academic_year=int(row["academic_year"]), status="Active")
                    success += 1
            except Exception as exc:
                errors.append({"row": row_number, "message": str(exc)})
        CsvUploadHistory.objects.create(uploaded_by=admin, file_name=upload.name, total_records=len(rows), success_records=success, failed_records=len(errors))
        return Response({"success": success, "failed": len(errors), "errors": errors})


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
                    user = UserLogin(username=username, role="Teacher", first_login=True, status="Active")
                    user.set_password("Teacher@123")
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
