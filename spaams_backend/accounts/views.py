"""
accounts/views.py

Endpoints this file provides:

  POST /api/auth/login/            -> log in, returns role + first_login flag
  POST /api/auth/change-password/  -> force/normal password change
  POST /api/auth/logout/           -> destroy session

  GET  /api/admin/students/        -> list all students   (Admin panel)
  POST /api/admin/students/        -> create a new student (Admin panel)
  GET  /api/admin/students/<id>/   -> one student's detail
  PUT  /api/admin/students/<id>/   -> edit a student
  DELETE /api/admin/students/<id>/ -> remove a student

  GET  /api/admin/teachers/        -> list all teachers
  POST /api/admin/teachers/        -> create a new teacher
  (same detail pattern as students)

Every Admin endpoint below is protected: the caller must be
logged in AND have role == 'Admin'. This is the backend
enforcement your project doc calls for in section 19 ("This is
enforced by the backend, not just by hiding UI buttons.")
"""

import logging
import secrets
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.middleware.csrf import get_token
from django.utils import timezone
from datetime import timedelta
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Admin, PasswordReset, Student, Teacher, UserLogin
from .bootstrap import DEFAULT_ADMIN_USERNAME, ensure_default_admin
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    StudentSerializer,
    TeacherSerializer,
)
from academics.models import StudentEnrollment, TeacherAssignment


logger = logging.getLogger(__name__)


class IsAdminRole(permissions.BasePermission):
    """
    Custom permission: only lets the request through if the logged-in
    user's Profile.role == 'Admin'. This is the backend equivalent of
    your role-based access control diagram (section 25 of the doc).
    """

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role == "Admin"
        )


class AdminProfileView(APIView):
    """The signed-in admin may view and change only their displayed name."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        profile = Admin.objects.get(user=request.user)
        return Response({"full_name": profile.full_name})

    def patch(self, request):
        full_name = str(request.data.get("full_name", "")).strip()
        if not full_name:
            return Response({"message": "Enter an admin name."}, status=status.HTTP_400_BAD_REQUEST)
        if len(full_name) > 100:
            return Response({"message": "Admin name must be 100 characters or fewer."}, status=status.HTTP_400_BAD_REQUEST)
        profile = Admin.objects.get(user=request.user)
        profile.full_name = full_name
        profile.save(update_fields=["full_name"])
        return Response({"full_name": profile.full_name})


class GraduatedStudentCountView(APIView):
    """Count graduates without adding them back to the active student roster."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        graduated_count = (
            Student.objects.filter(enrollments__status="Graduated")
            .exclude(enrollments__status="Active")
            .distinct()
            .count()
        )
        return Response({"count": graduated_count})


class IsTeacherRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "Teacher"


class IsStudentRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "Student"


class CsrfTokenView(APIView):
    """
    GET /api/auth/csrf/

    Django only WRITES the csrftoken cookie when something in the
    request explicitly asks for it — a plain JSON API never does
    that on its own. The frontend calls this once on page load
    (before any POST), then reads the cookie and sends it back as
    the X-CSRFToken header on every unsafe request from then on.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        get_token(request)  # this is what actually sets the cookie
        return Response({"detail": "CSRF cookie set."})


class LoginView(APIView):
    """
    POST { "username": "...", "password": "...", "role": "Admin" }

    Mirrors what js/script.js's mockLoginCheck() currently fakes in
    the browser. Once this is live, script.js's fetch() call points
    here instead of reading the mock array.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Recover exactly one account after a database is manually emptied.
        # Existing Admin accounts, including changed passwords, are untouched.
        if data["role"] == "Admin" and data["username"] == DEFAULT_ADMIN_USERNAME:
            ensure_default_admin()

        user = UserLogin.objects.filter(username=data["username"]).first()

        if user is None:
            return Response(
                {"success": False, "message": "Invalid username or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if user.role != data["role"] or not user.check_password(data["password"]):
            return Response(
                {"success": False, "message": "Invalid username or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if user.status == "Disabled":
            return Response(
                {"success": False, "message": "Your account is disabled. Please consult the admin (Bidhan) to enable it. Contact: 9842612731."},
                status=status.HTTP_403_FORBIDDEN,
            )

        request.session["spaams_login_id"] = user.pk
        full_name = self._get_full_name(user, user.role)

        return Response(
            {
                "success": True,
                "role": user.role,
                "first_login": user.first_login,
                "full_name": full_name,
            }
        )

    @staticmethod
    def _get_full_name(user, role):
        if role == "Admin" and hasattr(user, "admin_profile"):
            return user.admin_profile.full_name
        if role == "Teacher" and hasattr(user, "teacher_profile"):
            return user.teacher_profile.teacher_name
        if role == "Student" and hasattr(user, "student_profile"):
            return user.student_profile.full_name
        return user.username


class ChangePasswordView(APIView):
    """
    POST { "old_password": "...", "new_password": "...", "confirm_password": "..." }
    Must be logged in. Used both for the forced first-login change
    and for a normal "change my password" action later.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        if not user.check_password(data["old_password"]):
            return Response(
                {"success": False, "message": "Current password is incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(data["new_password"])
        user.first_login = False
        user.temp_password_plain = None
        user.save(update_fields=["password_hash", "first_login", "temp_password_plain"])

        return Response({"success": True, "message": "Password updated."})


class PasswordResetRequestView(APIView):
    """Creates a short-lived OTP and sends it only to the account email."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        user = UserLogin.objects.filter(username=username).first()
        if not user:
            # Do not reveal whether an account exists.
            return Response({"success": True, "message": "If the account has a registered email address, a reset code has been sent."})

        email = self._email_for_user(user)
        if not email:
            return Response({"success": False, "message": "No registered email address is available for this account. Contact the administrator."}, status=400)

        # A new request invalidates every earlier reset code for this user.
        PasswordReset.objects.filter(user=user).delete()
        otp = f"{secrets.randbelow(1_000_000):06d}"
        expiry_minutes = settings.PASSWORD_RESET_OTP_EXPIRY_MINUTES
        reset = PasswordReset.objects.create(
            user=user,
            otp=otp,
            expiry_time=timezone.now() + timedelta(minutes=expiry_minutes),
        )
        try:
            delivered = send_mail(
                "SPAAMS password reset",
                f"Your SPAAMS reset code is {otp}. It expires in {expiry_minutes} minutes.",
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
            if delivered != 1:
                raise RuntimeError("The email provider did not accept the reset message.")
        except Exception:
            reset.delete()
            logger.exception("SPAAMS password-reset email delivery failed for login_id=%s", user.id)
            return Response({"success": False, "message": "The reset email could not be delivered. Check the SMTP settings or contact the administrator."}, status=503)

        if settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend":
            return Response({"success": True, "delivery_mode": "console", "email": email,
                             "expires_in_seconds": expiry_minutes * 60,
                             "message": f"Development mode: the reset code was printed in the backend terminal. It was not sent to {email}. Configure SMTP to deliver real email."})
        return Response({"success": True, "delivery_mode": "email", "email": email,
                         "expires_in_seconds": expiry_minutes * 60,
                         "message": f"Check your registered email address, {email}, for the six-digit reset code."})

    @staticmethod
    def _email_for_user(user):
        if user.role == "Student" and hasattr(user, "student_profile"):
            return user.student_profile.email
        if user.role == "Teacher" and hasattr(user, "teacher_profile"):
            return user.teacher_profile.email
        if user.role == "Admin" and hasattr(user, "admin_profile"):
            return user.admin_profile.email
        return None


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        otp = (request.data.get("otp") or "").strip()
        password = request.data.get("new_password") or ""
        confirm = request.data.get("confirm_password") or ""
        if password != confirm:
            return Response({"message": "Passwords do not match."}, status=400)
        try:
            validate_password(password)
        except Exception as exc:
            return Response({"message": " ".join(exc.messages)}, status=400)
        user = UserLogin.objects.filter(username=username).first()
        # The OTP must have been checked at /auth/verify-reset-otp/ first.
        reset = PasswordReset.objects.filter(user=user, otp=otp, verified=True, expiry_time__gte=timezone.now()).order_by("-created_at").first() if user else None
        if not reset:
            return Response({"message": "Verify a valid reset code before setting a new password."}, status=400)
        user.set_password(password)  # Django hashes using PBKDF2; no plaintext is stored.
        # A reset replaces the initial password too, so remove its plaintext
        # copy and prevent a later forced first-login reset.
        user.first_login = False
        user.temp_password_plain = None
        user.save(update_fields=["password_hash", "first_login", "temp_password_plain"])
        reset.delete()  # The verified OTP must not be reusable.
        return Response({"success": True, "message": "Password reset successfully."})


class PasswordResetOtpVerifyView(APIView):
    """Verifies the OTP before the browser may display password fields."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        otp = (request.data.get("otp") or "").strip()
        if not username or not otp:
            return Response({"message": "Username and the 6-digit reset code are required."}, status=400)
        user = UserLogin.objects.filter(username=username).first()
        reset = PasswordReset.objects.filter(
            user=user, otp=otp, verified=False, expiry_time__gte=timezone.now()
        ).order_by("-created_at").first() if user else None
        if not reset:
            return Response({"message": "The reset code is invalid or expired. Request a new code and try again."}, status=400)
        reset.verified = True
        reset.save(update_fields=["verified"])
        return Response({"success": True, "message": "Code verified. Choose a new password."})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        request.session.flush()
        return Response({"success": True})


class TeacherMeView(APIView):
    """The logged-in teacher's real assignments; never accepts a teacher id from the browser."""
    permission_classes = [IsTeacherRole]

    def get(self, request):
        teacher = Teacher.objects.get(user=request.user)
        assignments = TeacherAssignment.objects.filter(teacher=teacher, status="Active").select_related("subject", "semester").order_by("semester__semester_number", "subject__subject_name")
        return Response({"id": teacher.id, "full_name": teacher.teacher_name, "gender": teacher.gender,
                         "assignments": [{"id": a.id, "subject_id": a.subject_id, "subject_name": a.subject.subject_name,
                                           "semester_id": a.semester_id, "semester_number": a.semester.semester_number,
                                           "academic_year": a.academic_year,
                                           "student_count": StudentEnrollment.objects.filter(
                                               semester=a.semester, academic_year=a.academic_year,
                                               status="Active", student__status="Active"
                                           ).count()} for a in assignments]})


class StudentMeView(APIView):
    """Read-only dashboard data for the logged-in student, calculated from ORM records."""
    permission_classes = [IsStudentRole]

    def get(self, request):
        from academics.models import StudentEnrollment
        from assessment.models import BoardMarks, StudentMarks
        from assessment.performance import student_performance
        from academics.models import Subject
        from attendance.models import Attendance

        student = Student.objects.select_related("guardian", "user").get(user=request.user)
        enrollments = StudentEnrollment.objects.filter(student=student).select_related("semester", "faculty").order_by("semester__semester_number")
        attendance = Attendance.objects.filter(student=student).select_related("session__semester")
        marks = StudentMarks.objects.filter(student=student).select_related("subject", "assessment")
        board_marks = BoardMarks.objects.filter(student=student).select_related("subject")
        attendance_by_semester = {}
        for row in attendance:
            bucket = attendance_by_semester.setdefault(row.session.semester_id, {"present": 0, "total": 0})
            bucket["total"] += 1
            bucket["present"] += row.status == "Present"
        board_by_semester = {}
        for row in board_marks:
            bucket = board_by_semester.setdefault(row.subject.semester_id, [0.0, 0.0])
            bucket[0] += float(row.marks_obtained)
            bucket[1] += 1
        semester_summary, class_performance = {}, {}
        for enrollment in enrollments:
            sem = enrollment.semester
            att = attendance_by_semester.get(sem.id, {"present": 0, "total": 0})
            board = board_by_semester.get(sem.id)
            semester_summary[sem.semester_number] = {"present": att["present"], "total": att["total"],
                "boardMarks": round(board[0] / board[1], 2) if board and board[1] else None, "cgpa": None}
            subject_rows = []
            for subject in Subject.objects.filter(semester=sem).order_by("subject_name"):
                performance = student_performance(student.id, subject.id, enrollment.academic_year, sem.id)
                categories = performance["categories"]
                # Student-facing values are only marks actually entered by an
                # Admin/Teacher.  They use the same permanent 100-point
                # breakdown as the Admin and Teacher panels.
                displayed = {name: categories[name].get("display_contribution") for name in categories}
                entered_values = [value for value in displayed.values() if value is not None]
                subject_rows.append({
                    "subject": subject.subject_name,
                    "assignment": displayed["Assignments"],
                    "unitTest": displayed["Unit Tests"],
                    "attendance": displayed["Attendance"],
                    "grooming": displayed["Grooming"],
                    "midterm": displayed["Midterm"],
                    "lab": displayed["Lab Reports"],
                    "overall": displayed["Overall Activities"],
                    "preboard": displayed["Preboard"],
                    "total": round(sum(entered_values), 2) if entered_values else None,
                    "has_entered_marks": bool(entered_values),
                })
            class_performance[sem.semester_number] = subject_rows
        # Board GPA is the average of the Board GPA values entered by Admin
        # for that semester. CGPA is the cumulative average across semesters
        # that have a Board GPA; it does not alter the 100-mark performance.
        completed_gpas = []
        for semester_number in sorted(semester_summary):
            board_gpa = semester_summary[semester_number]["boardMarks"]
            if board_gpa is not None:
                completed_gpas.append(board_gpa)
            semester_summary[semester_number]["cgpa"] = round(sum(completed_gpas) / len(completed_gpas), 2) if completed_gpas else None
        notifications = []
        active_enrollment = enrollments.last()
        if active_enrollment:
            # Notification 1: alert only when the current-semester
            # attendance falls below the required 75% threshold.
            active_attendance = attendance_by_semester.get(active_enrollment.semester_id, {"present": 0, "total": 0})
            if active_attendance["total"]:
                attendance_percent = active_attendance["present"] * 100 / active_attendance["total"]
                if attendance_percent < 75:
                    notifications.append({"text": f"Low attendance: {attendance_percent:.1f}%. Please attend classes regularly.", "type": "attendance"})
            peer_ids = StudentEnrollment.objects.filter(semester=active_enrollment.semester, academic_year=active_enrollment.academic_year, status="Active").values_list("student_id", flat=True)
            totals = {}
            for row in StudentMarks.objects.filter(student_id__in=peer_ids, subject__semester=active_enrollment.semester, academic_year=active_enrollment.academic_year).values("student_id", "marks_obtained"):
                totals[row["student_id"]] = totals.get(row["student_id"], 0) + float(row["marks_obtained"])
            if student.id in totals:
                rank = sorted(totals, key=lambda sid: totals[sid], reverse=True).index(student.id) + 1
                if rank <= 5:
                    notifications.append({"text": f"Congratulations! You are in the top 5 (rank {rank}).", "type": "rank"})
        return Response({"profile": {"full_name": student.full_name, "student_id": student.registration_number,
            "reg_no": student.registration_number, "program": "BCA Program", "academic_year": str(enrollments.last().academic_year) if enrollments else "",
            "dob": student.date_of_birth.isoformat(), "address": student.address, "phone": student.phone, "email": student.email,
            "guardian_name": student.guardian.guardian_name, "guardian_phone": student.guardian.phone},
            "semester_summary": semester_summary, "class_performance": class_performance, "notifications": notifications})


class StudentViewSet(viewsets.ModelViewSet):
    """
    Powers the Admin panel's Manage Students screen:
    list / create / retrieve / update / delete, all at once,
    via DRF's router (see accounts/urls.py).
    """

    serializer_class = StudentSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        # The current-student dashboard must not mix graduated or archived
        # students into active class, attendance, and marks workflows.
        return (
            Student.objects.select_related("guardian", "user")
            .filter(enrollments__status="Active")
            .distinct()
        )


class TeacherViewSet(viewsets.ModelViewSet):
    """Powers the Admin panel's Manage Teachers screen."""

    queryset = Teacher.objects.select_related("user").all()
    serializer_class = TeacherSerializer
    permission_classes = [IsAdminRole]
