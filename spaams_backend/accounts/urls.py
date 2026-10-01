from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ChangePasswordView,
    AdminProfileView,
    GraduatedStudentCountView,
    CsrfTokenView,
    LoginView,
    LogoutView,
    StudentViewSet,
    TeacherViewSet,
    TeacherMeView,
    StudentMeView,
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetOtpVerifyView,
)

router = DefaultRouter()
router.register("students", StudentViewSet, basename="student")
router.register("teachers", TeacherViewSet, basename="teacher")

urlpatterns = [
    path("auth/csrf/", CsrfTokenView.as_view(), name="csrf"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("admin/profile/", AdminProfileView.as_view(), name="admin-profile"),
    path("admin/graduated-students/count/", GraduatedStudentCountView.as_view(), name="graduated-student-count"),
    path("admin/", include(router.urls)),
    path("teacher/me/", TeacherMeView.as_view(), name="teacher-me"),
    path("student/me/", StudentMeView.as_view(), name="student-me"),
    path("auth/forgot-password/", PasswordResetRequestView.as_view(), name="forgot-password"),
    path("auth/verify-reset-otp/", PasswordResetOtpVerifyView.as_view(), name="verify-reset-otp"),
    path("auth/reset-password/", PasswordResetConfirmView.as_view(), name="reset-password"),
]
