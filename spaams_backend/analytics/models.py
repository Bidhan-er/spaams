"""
analytics/models.py — maps onto: performance_analytics

A cache/derived table, recalculated from student_marks +
attendance using pandas/numpy (see analytics/services.py).
weak_subject / strong_subject are real FKs to Subject — the
original design used free text here, which was fixed once we
started building the Admin panel and needed to link back to a
subject's detail page.
"""

from django.db import models

from academics.models import Semester, Subject


class PerformanceAnalytics(models.Model):
    id = models.AutoField(primary_key=True, db_column="analytics_id")
    LEVEL_CHOICES = [
        ("Excellent", "Excellent"),
        ("Good", "Good"),
        ("Average", "Average"),
        ("At Risk", "At Risk"),
    ]

    student = models.ForeignKey("accounts.Student", on_delete=models.CASCADE, related_name="analytics")
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    attendance_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    average_marks = models.DecimalField(max_digits=5, decimal_places=2)
    performance_level = models.CharField(max_length=10, choices=LEVEL_CHOICES)
    weak_subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, blank=True, null=True, related_name="weak_for")
    strong_subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, blank=True, null=True, related_name="strong_for")
    prediction = models.CharField(max_length=255, blank=True, null=True)
    remarks = models.TextField(blank=True, null=True)
    calculated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "performance_analytics"
        managed = False
        unique_together = ("student", "semester")
        verbose_name_plural = "performance analytics"

    def __str__(self):
        return f"{self.student} - {self.semester} analytics"
