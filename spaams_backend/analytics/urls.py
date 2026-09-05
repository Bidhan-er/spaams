from django.urls import path

from .views import ClassPerformanceAnalyticsView, SemesterAnalyticsView

urlpatterns = [
    path("analytics/class-performance/", ClassPerformanceAnalyticsView.as_view(), name="class-performance"),
    path("analytics/semester-summary/", SemesterAnalyticsView.as_view(), name="semester-summary"),
]
