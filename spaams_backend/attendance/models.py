"""
attendance/models.py

Maps onto: attendance_session, attendance, sms_history

is_locked is what enforces "one attendance submission per subject
per day" — the Teacher panel's rule. The lock itself is set by the
submit endpoint, and re-checked there (never trust the frontend's
disabled button alone for something like this).
"""

from django.db import models

from academics.models import Semester, Subject


class AttendanceSession(models.Model):
    id = models.AutoField(primary_key=True, db_column="attendance_session_id")
    teacher = models.ForeignKey("accounts.Teacher", on_delete=models.PROTECT)
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    attendance_date = models.DateField()
    submitted_at = models.DateTimeField(blank=True, null=True)
    is_locked = models.BooleanField(default=False)
    total_students = models.PositiveIntegerField(default=0)
    total_present = models.PositiveIntegerField(default=0)
    total_absent = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "attendance_session"
        managed = False
        unique_together = ("semester", "subject", "attendance_date")

    def __str__(self):
        return f"{self.subject} - {self.attendance_date}"


class Attendance(models.Model):
    id = models.AutoField(primary_key=True, db_column="attendance_id")
    STATUS_CHOICES = [("Present", "Present"), ("Absent", "Absent")]

    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name="records", db_column="attendance_session_id")
    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    remarks = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        db_table = "attendance"
        managed = False
        unique_together = ("session", "student")

    def __str__(self):
        return f"{self.student} - {self.status}"


class SmsHistory(models.Model):
    """
    Guardian notifications for absent students. Real delivery goes
    through the Sparrow SMS API on the backend — this table just
    logs what was sent, not how it was transmitted.
    """

    id = models.AutoField(primary_key=True, db_column="sms_id")
    STATUS_CHOICES = [("Sent", "Sent"), ("Failed", "Failed"), ("Pending", "Pending")]

    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT)
    attendance = models.ForeignKey(Attendance, on_delete=models.SET_NULL, blank=True, null=True)
    guardian_phone = models.CharField(max_length=15)  # snapshot at send time, intentionally
    message = models.TextField()
    sent_time = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Pending")

    class Meta:
        db_table = "sms_history"
        managed = False

    def __str__(self):
        return f"SMS to {self.guardian_phone} ({self.status})"
