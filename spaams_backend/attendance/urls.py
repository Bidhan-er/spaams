from django.urls import path

from .views import AdminAttendanceHistoryView, AdminAttendanceRosterView, AttendanceSubmitView, AttendanceTodayView, GuardianMessageDetailsView, GuardianNotificationView

urlpatterns = [
    path("teacher/attendance/", AttendanceTodayView.as_view(), name="teacher-attendance"),
    path("teacher/attendance/submit/", AttendanceSubmitView.as_view(), name="attendance-submit"),
    path("teacher/attendance/notify-guardians/", GuardianNotificationView.as_view(), name="guardian-notify"),
    path("teacher/attendance/message-details/", GuardianMessageDetailsView.as_view(), name="guardian-message-details"),
    path("admin/attendance/", AdminAttendanceHistoryView.as_view(), name="admin-attendance-history"),
    path("admin/attendance/roster/", AdminAttendanceRosterView.as_view(), name="admin-attendance-roster"),
]
