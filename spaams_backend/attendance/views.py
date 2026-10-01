from django.conf import settings
from django.db import transaction
from django.utils import timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from datetime import date as calendar_date
import json
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import StudentEnrollment, TeacherAssignment
from accounts.views import IsAdminRole
from assessment.views import IsTeacherRole
from .models import Attendance, AttendanceSession, SmsHistory


def _teacher_assignment(request, subject_id, academic_year):
    return TeacherAssignment.objects.filter(teacher__user=request.user, subject_id=subject_id, academic_year=academic_year, status="Active").select_related("semester", "subject").first()


def _send_sms(phone, message):
    """Send a guardian absence alert through SMS Pasal from the backend only."""
    if not settings.SMS_PASAL_API_KEY or not settings.SMS_PASAL_SENDER_ID:
        return "Pending", "SMS Pasal API key or Sender ID is not configured."
    payload = {
        "key": settings.SMS_PASAL_API_KEY,
        "type": "text",
        "responsetype": "json",
        "contacts": phone,
        "senderid": settings.SMS_PASAL_SENDER_ID,
        "msg": message,
    }
    if settings.SMS_PASAL_CAMPAIGN_ID:
        payload["campaign"] = settings.SMS_PASAL_CAMPAIGN_ID
    if settings.SMS_PASAL_ROUTE_ID:
        payload["routeid"] = settings.SMS_PASAL_ROUTE_ID
    try:
        # SMS Pasal accepts POST fields.  Keeping the key in the POST body
        # means it is never placed in a browser request or exposed in URLs.
        request_body = urlencode(payload).encode("utf-8")
        request = Request(
            "https://sms.smspasal.com/smsapi/index.php",
            data=request_body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                # Identify this as a legitimate server integration.  Do not
                # impersonate a browser to circumvent provider security rules.
                "User-Agent": "SPAAMS-Attendance/1.0 (guardian-notifications)",
            },
            method="POST",
        )
        with urlopen(request, timeout=12) as response:
            body = response.read().decode("utf-8", errors="replace").strip()
            if not 200 <= response.status < 300:
                return "Failed", f"SMS Pasal returned HTTP {response.status}."
            try:
                response_data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                response_data = {}
            if response_data.get("error") is True:
                return "Failed", str(response_data.get("message") or "SMS Pasal rejected the request.")
            return "Sent", "Accepted by SMS Pasal."
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip().replace("\n", " ")
        return "Failed", f"SMS Pasal HTTP {error.code}: {detail[:180] or error.reason}"
    except URLError as error:
        return "Failed", f"Could not connect to SMS Pasal: {error.reason}"
    except Exception as error:
        return "Failed", f"SMS Pasal request error: {error}"


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
        try:
            with transaction.atomic():
                # Attendance is whole-class and the database allows only one
                # session per semester/day.  Do not attempt a second teacher
                # session for another subject, which previously raised a 500.
                session = AttendanceSession.objects.select_for_update().select_related("teacher").filter(
                    semester=assignment.semester, attendance_date=timezone.localdate()
                ).first()
                if session and session.is_locked:
                    taken_by = session.teacher.teacher_name if session.teacher_id else "an administrator"
                    return Response({"message": f"Attendance for this semester was already taken today by {taken_by}."}, status=409)
                if session is None:
                    session = AttendanceSession.objects.create(
                        teacher=assignment.teacher, semester=assignment.semester,
                        subject=assignment.subject, attendance_date=timezone.localdate(), is_locked=False
                    )
                Attendance.objects.filter(session=session).delete()
                Attendance.objects.bulk_create([Attendance(session=session, student_id=sid, status=value) for sid, value in submitted.items()])
                session.teacher = assignment.teacher
                session.subject = assignment.subject
                session.total_students = len(submitted)
                session.total_present = sum(v == "Present" for v in submitted.values())
                session.total_absent = len(submitted) - session.total_present
                session.is_locked, session.submitted_at = True, timezone.now()
                session.save()
        except Exception as error:
            return Response({"message": f"Attendance could not be submitted: {error}"}, status=500)
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
            # A successful attendance alert is final for that student and
            # session.  Never spend another credit or send a duplicate when a
            # teacher clicks the button again later in the day.
            if SmsHistory.objects.filter(attendance=record, status="Sent").exists():
                notifications.append({
                    "student_id": record.student_id,
                    "guardian_phone": record.student.guardian.phone,
                    "status": "AlreadySent",
                    "detail": "A message was already sent successfully to this guardian today.",
                })
                continue
            delivery_status, detail = _send_sms(record.student.guardian.phone, message)
            history = SmsHistory.objects.create(student=record.student, attendance=record, guardian_phone=record.student.guardian.phone, message=message, status=delivery_status)
            notifications.append({"student_id": record.student_id, "guardian_phone": history.guardian_phone, "status": history.status, "detail": detail})
        return Response({
            "success": True,
            "sent": sum(n["status"] == "Sent" for n in notifications),
            "already_sent": sum(n["status"] == "AlreadySent" for n in notifications),
            "notifications": notifications,
        })


class GuardianMessageDetailsView(APIView):
    """Show a teacher the SMS history for one of their submitted sessions."""

    permission_classes = [IsTeacherRole]

    def get(self, request):
        session_id = request.query_params.get("session_id")
        session = AttendanceSession.objects.filter(
            pk=session_id, teacher__user=request.user, is_locked=True
        ).first()
        if not session:
            return Response({"message": "Submitted attendance session not found."}, status=404)

        messages = SmsHistory.objects.filter(attendance__session=session).select_related(
            "student", "student__guardian"
        ).order_by("-sent_time")
        return Response({
            "session_id": session.id,
            "messages": [{
                "student_name": item.student.full_name,
                "registration_number": item.student.registration_number,
                "guardian_name": item.student.guardian.guardian_name,
                "guardian_phone": item.guardian_phone,
                "message": item.message,
                "status": item.status,
                "sent_time": item.sent_time,
            } for item in messages],
        })


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
            "semester": s.semester.semester_name, "subject": s.subject.subject_name if s.subject else "Whole class", "teacher": s.teacher.teacher_name if s.teacher else "Admin",
            "total_students": s.total_students, "present": s.total_present, "absent": s.total_absent,
            "records": [{"student_id": r.student_id, "registration_number": r.student.registration_number, "full_name": r.student.full_name, "status": r.status} for r in s.records.all()]} for s in sessions.order_by("-attendance_date", "semester__semester_number", "subject__subject_name")]})


class AdminAttendanceRosterView(APIView):
    """Admin roster and attendance history for a selected class and date."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        semester_id = request.query_params.get("semester_id")
        academic_year = request.query_params.get("academic_year")
        attendance_date = request.query_params.get("date")
        if not semester_id or not academic_year:
            return Response({"message": "semester_id and academic_year are required."}, status=400)
        if attendance_date:
            try:
                selected_date = calendar_date.fromisoformat(attendance_date)
            except ValueError:
                return Response({"message": "Use a valid attendance date."}, status=400)
            if selected_date > timezone.localdate():
                return Response({"message": "Attendance cannot be viewed or recorded for a future date."}, status=400)
        roster = StudentEnrollment.objects.filter(
            semester_id=semester_id, academic_year=academic_year, status="Active",
            student__status="Active"
        ).select_related("student").order_by("student__full_name")
        statuses = {}
        session_count = 0
        sessions = AttendanceSession.objects.none()
        if attendance_date:
            # A teacher's submitted attendance is subject-scoped, whereas an
            # admin-created session is whole-class.  The monitoring screen
            # must show either kind when the admin picks a historical date.
            sessions = AttendanceSession.objects.filter(
                semester_id=semester_id, attendance_date=attendance_date, is_locked=True
            ).select_related("teacher").prefetch_related("records")
            session_count = sessions.count()
            per_student = {}
            for session in sessions:
                for record in session.records.all():
                    per_student.setdefault(record.student_id, []).append(record.status)
            statuses = {
                student_id: "Present" if all(value == "Present" for value in values) else "Absent"
                for student_id, values in per_student.items()
            }
        return Response({
            "total_students": roster.count(), "submitted_sessions": session_count,
            "recorded_by": ", ".join(sorted({session.teacher.teacher_name for session in sessions if session.teacher_id})) or None,
            "records": [{"student_id": item.student_id,
                         "registration_number": item.student.registration_number,
                         "full_name": item.student.full_name,
                         "status": statuses.get(item.student_id)} for item in roster],
        })

    def post(self, request):
        semester_id = request.data.get("semester_id")
        academic_year = request.data.get("academic_year")
        attendance_date = request.data.get("date")
        rows = request.data.get("records", [])
        if not semester_id or not academic_year or not attendance_date or not isinstance(rows, list):
            return Response({"message": "semester, batch, date, and attendance records are required."}, status=400)
        try:
            selected_date = calendar_date.fromisoformat(attendance_date)
        except ValueError:
            return Response({"message": "Use a valid attendance date."}, status=400)
        if selected_date > timezone.localdate():
            return Response({"message": "Attendance cannot be recorded for tomorrow or a future date."}, status=400)
        valid_students = set(StudentEnrollment.objects.filter(
            semester_id=semester_id, academic_year=academic_year, status="Active", student__status="Active"
        ).values_list("student_id", flat=True))
        submitted = {row.get("student_id"): row.get("status") for row in rows}
        if set(submitted) != valid_students or not set(submitted.values()).issubset({"Present", "Absent"}):
            return Response({"message": "Mark every enrolled student Present or Absent before saving."}, status=400)
        try:
            with transaction.atomic():
                # The database deliberately permits one attendance session for a
                # semester on a date.  A teacher may already have created it, so
                # the admin must update that session instead of attempting a
                # second whole-class session (which caused a database 500 error).
                session = AttendanceSession.objects.select_for_update().filter(
                    semester_id=semester_id, attendance_date=attendance_date
                ).first()
                if session is None:
                    session = AttendanceSession.objects.create(
                        semester_id=semester_id, teacher=None, subject=None,
                        attendance_date=attendance_date, is_locked=False
                    )
                Attendance.objects.filter(session=session).delete()
                Attendance.objects.bulk_create([Attendance(session=session, student_id=student_id, status=status) for student_id, status in submitted.items()])
                session.teacher = None
                session.subject = None
                session.total_students = len(submitted)
                session.total_present = sum(status == "Present" for status in submitted.values())
                session.total_absent = len(submitted) - session.total_present
                session.is_locked, session.submitted_at = True, timezone.now()
                session.save()
        except Exception as error:
            # Give the Admin panel a usable local-development message rather
            # than the opaque browser-only “Request failed (500)”.
            return Response({"message": f"Attendance could not be saved: {error}"}, status=500)
        return Response({"success": True, "present": session.total_present, "absent": session.total_absent})
