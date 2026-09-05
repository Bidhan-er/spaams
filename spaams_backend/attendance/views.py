from django.conf import settings
from django.db import transaction
from django.conf import settings
from django.utils import timezone
from urllib.parse import urlencode
from urllib.request import urlopen
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import StudentEnrollment, TeacherAssignment
from accounts.views import IsAdminRole
from assessment.views import IsTeacherRole
from .models import Attendance, AttendanceSession, SmsHistory


def _teacher_assignment(request, subject_id, academic_year):
    return TeacherAssignment.objects.filter(teacher__user=request.user, subject_id=subject_id, academic_year=academic_year, status="Active").select_related("semester", "subject").first()


def _send_sms(phone, message):
    """Deliver with Sparrow when configured; never expose the token to the browser."""
    if not settings.SPARROW_SMS_TOKEN:
        return "Pending"
    query = urlencode({"token": settings.SPARROW_SMS_TOKEN, "from": settings.SPARROW_SMS_FROM, "to": phone, "text": message})
    try:
        with urlopen(f"https://api.sparrowsms.com/v2/sms/?{query}", timeout=12) as response:
            return "Sent" if 200 <= response.status < 300 else "Failed"
    except Exception:
        return "Failed"


class AttendanceTodayView(APIView):
    permission_classes = [IsTeacherRole]

    def get(self, request):
        subject_id, academic_year = request.query_params.get("subject_id"), request.query_params.get("academic_year")
        if not subject_id or not academic_year:
            return Response({"message": "subject_id and academic_year are required."}, status=400)
        assignment = _teacher_assignment(request, subject_id, academic_year)
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        session = AttendanceSession.objects.filter(subject_id=subject_id, semester=assignment.semester, attendance_date=timezone.localdate()).prefetch_related("records").first()
        students = StudentEnrollment.objects.filter(semester=assignment.semester, academic_year=academic_year, status="Active").select_related("student", "student__guardian").order_by("student__full_name")
        record_by_student = {r.student_id: r.status for r in session.records.all()} if session else {}
        return Response({"locked": bool(session and session.is_locked), "session_id": session.id if session else None,
                         "records": [{"student_id": e.student_id, "registration_number": e.student.registration_number,
                                      "full_name": e.student.full_name, "guardian_name": e.student.guardian.guardian_name,
                                      "guardian_phone": e.student.guardian.phone, "status": record_by_student.get(e.student_id)} for e in students]})


class AttendanceSubmitView(APIView):
    permission_classes = [IsTeacherRole]

    def post(self, request):
        subject_id, academic_year, rows = request.data.get("subject_id"), request.data.get("academic_year"), request.data.get("records", [])
        if not subject_id or not academic_year or not isinstance(rows, list):
            return Response({"message": "subject_id, academic_year and records are required."}, status=400)
        assignment = _teacher_assignment(request, subject_id, academic_year)
        if not assignment:
            return Response({"message": "You are not assigned to this subject."}, status=403)
        valid_students = set(StudentEnrollment.objects.filter(semester=assignment.semester, academic_year=academic_year, status="Active").values_list("student_id", flat=True))
        submitted = {r.get("student_id"): r.get("status") for r in rows}
        if set(submitted) != valid_students or not set(submitted.values()).issubset({"Present", "Absent"}):
            return Response({"message": "Attendance must include every enrolled student with Present or Absent status."}, status=400)
        with transaction.atomic():
            session, created = AttendanceSession.objects.select_for_update().get_or_create(
                teacher=assignment.teacher, semester=assignment.semester, subject=assignment.subject,
                attendance_date=timezone.localdate(), defaults={"is_locked": False}
            )
            if session.is_locked:
                return Response({"message": "Attendance for this subject has already been submitted today."}, status=409)
            Attendance.objects.bulk_create([Attendance(session=session, student_id=sid, status=value) for sid, value in submitted.items()])
            session.total_students = len(submitted)
            session.total_present = sum(v == "Present" for v in submitted.values())
            session.total_absent = len(submitted) - session.total_present
            session.is_locked, session.submitted_at = True, timezone.now()
            session.save()
        absent = Attendance.objects.filter(session=session, status="Absent").select_related("student__guardian")
        return Response({"success": True, "session_id": session.id, "total_present": session.total_present,
                         "total_absent": session.total_absent, "absent_students": [{"student_id": a.student_id,
                         "registration_number": a.student.registration_number, "full_name": a.student.full_name,
                         "guardian_name": a.student.guardian.guardian_name, "guardian_phone": a.student.guardian.phone} for a in absent]})


class GuardianNotificationView(APIView):
    permission_classes = [IsTeacherRole]

    def post(self, request):
        session_id = request.data.get("session_id")
        message = (request.data.get("message") or "Your student is absent.").strip()
        session = AttendanceSession.objects.filter(pk=session_id, teacher__user=request.user, is_locked=True).first()
        if not session:
            return Response({"message": "Submitted attendance session not found."}, status=404)
        absent = Attendance.objects.filter(session=session, status="Absent").select_related("student__guardian")
        notifications = []
        for record in absent:
            delivery_status = _send_sms(record.student.guardian.phone, message)
            history = SmsHistory.objects.create(student=record.student, attendance=record, guardian_phone=record.student.guardian.phone, message=message, status=delivery_status)
            notifications.append({"student_id": record.student_id, "guardian_phone": history.guardian_phone, "status": history.status})
        return Response({"success": True, "sent": sum(n["status"] == "Sent" for n in notifications), "notifications": notifications})


class AdminAttendanceHistoryView(APIView):
    """Admin can inspect attendance from any past or current date and semester."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        sessions = AttendanceSession.objects.select_related("semester", "subject", "teacher").prefetch_related("records__student")
        semester_id = request.query_params.get("semester_id")
        attendance_date = request.query_params.get("date")
        subject_id = request.query_params.get("subject_id")
        if semester_id:
            sessions = sessions.filter(semester_id=semester_id)
        if attendance_date:
            sessions = sessions.filter(attendance_date=attendance_date)
        if subject_id:
            sessions = sessions.filter(subject_id=subject_id)
        return Response({"sessions": [{"id": s.id, "date": s.attendance_date, "semester_id": s.semester_id,
            "semester": s.semester.semester_name, "subject": s.subject.subject_name, "teacher": s.teacher.teacher_name,
            "total_students": s.total_students, "present": s.total_present, "absent": s.total_absent,
            "records": [{"student_id": r.student_id, "registration_number": r.student.registration_number, "full_name": r.student.full_name, "status": r.status} for r in s.records.all()]} for s in sessions.order_by("-attendance_date", "semester__semester_number", "subject__subject_name")]})
