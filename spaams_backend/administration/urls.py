from django.urls import path

from .views import OperationalDataResetView, StudentImportPreviewView, StudentImportView, StudentExportView, TeacherImportView, TeacherExportView

urlpatterns = [
    path("admin/students/import/", StudentImportView.as_view(), name="student-import"),
    path("admin/students/import/preview/", StudentImportPreviewView.as_view(), name="student-import-preview"),
    path("admin/students/export/", StudentExportView.as_view(), name="student-export"),
    path("admin/data/reset/", OperationalDataResetView.as_view(), name="operational-data-reset"),
    path("admin/teachers/import/", TeacherImportView.as_view(), name="teacher-import"),
    path("admin/teachers/export/", TeacherExportView.as_view(), name="teacher-export"),
]
