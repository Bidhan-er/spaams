from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DashboardSummaryView,
    FacultyViewSet,
    SemesterViewSet,
    StudentPerformanceView,
    SubjectViewSet,
    TeacherAssignmentViewSet,
)

router = DefaultRouter()
router.register("faculties", FacultyViewSet, basename="faculty")
router.register("semesters", SemesterViewSet, basename="semester")
router.register("subjects", SubjectViewSet, basename="subject")
router.register("teacher-assignments", TeacherAssignmentViewSet, basename="teacher-assignment")

urlpatterns = [
    path("admin/dashboard-summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path(
        "admin/students/<int:student_id>/performance/",
        StudentPerformanceView.as_view(),
        name="student-performance",
    ),
    path("admin/", include(router.urls)),
]
