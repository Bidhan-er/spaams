from django.urls import path

from .views import ArchiveStudentListView, BatchPromotionView, PassOutStudentView, PromoteStudentView

urlpatterns = [
    path("admin/students/<int:student_id>/promote/", PromoteStudentView.as_view(), name="student-promote"),
    path("admin/students/<int:student_id>/pass-out/", PassOutStudentView.as_view(), name="student-pass-out"),
    path("admin/semester-promote-batch/", BatchPromotionView.as_view(), name="semester-promote-batch"),
    path("admin/archived-students/", ArchiveStudentListView.as_view(), name="archived-students"),
]
