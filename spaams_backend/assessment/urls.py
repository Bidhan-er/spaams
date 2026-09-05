from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AssessmentTypeListView, BoardMarksViewSet, TeacherMarksView

router = DefaultRouter()
router.register("admin/board-marks", BoardMarksViewSet, basename="board-marks")

urlpatterns = [
    path("teacher/marks/", TeacherMarksView.as_view(), name="teacher-marks"),
    path("teacher/assessment-types/", AssessmentTypeListView.as_view(), name="assessment-types"),
    path("", include(router.urls)),
]
