"""
progression/models.py

Maps onto: semester_promotion, archived_student, archive_marks,
archive_attendance

archive_marks and archive_attendance are the fix identified partway
through this project: the original design only kept a flattened
student snapshot when someone graduated/left, silently losing their
marks and attendance history. These two tables close that gap.
"""

from django.db import models

from academics.models import Semester


class SemesterPromotion(models.Model):
    id = models.AutoField(primary_key=True, db_column="promotion_id")
    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT)
    from_semester = models.ForeignKey(Semester, on_delete=models.PROTECT, related_name="promotions_from")
    to_semester = models.ForeignKey(Semester, on_delete=models.PROTECT, related_name="promotions_to")
    promoted_by = models.ForeignKey("accounts.Admin", on_delete=models.PROTECT, db_column="promoted_by")
    promotion_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "semester_promotion"
        managed = False

    def __str__(self):
        return f"{self.student}: {self.from_semester} -> {self.to_semester}"


class ArchivedStudent(models.Model):
    """Flattened snapshot of a passed-out/dropped student."""

    id = models.AutoField(primary_key=True, db_column="archive_id")

    GENDER_CHOICES = [("Male", "Male"), ("Female", "Female"), ("Other", "Other")]

    original_student_id = models.PositiveIntegerField()
    registration_number = models.CharField(max_length=30)
    symbol_number = models.CharField(max_length=30, blank=True, null=True)
    full_name = models.CharField(max_length=100)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    date_of_birth = models.DateField()
    phone = models.CharField(max_length=15, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    photo = models.CharField(max_length=255, blank=True, null=True)
    guardian_name = models.CharField(max_length=100, blank=True, null=True)
    guardian_phone = models.CharField(max_length=15, blank=True, null=True)
    guardian_email = models.EmailField(blank=True, null=True)
    guardian_relationship = models.CharField(max_length=30, blank=True, null=True)
    faculty_name = models.CharField(max_length=50, blank=True, null=True)
    final_semester = models.ForeignKey(Semester, on_delete=models.SET_NULL, blank=True, null=True)
    archived_date = models.DateTimeField(auto_now_add=True)
    archived_by = models.ForeignKey("accounts.Admin", on_delete=models.PROTECT, db_column="archived_by")

    class Meta:
        db_table = "archived_student"
        managed = False

    def __str__(self):
        return f"[Archived] {self.full_name} ({self.registration_number})"


class ArchiveMarks(models.Model):
    id = models.AutoField(primary_key=True, db_column="archive_marks_id")
    archived_student = models.ForeignKey(ArchivedStudent, on_delete=models.CASCADE, related_name="archived_marks", db_column="archive_id")
    subject_name = models.CharField(max_length=100)  # denormalized on purpose
    assessment_name = models.CharField(max_length=50)
    marks_obtained = models.DecimalField(max_digits=6, decimal_places=2)
    academic_year = models.PositiveIntegerField()

    class Meta:
        db_table = "archive_marks"
        managed = False


class ArchiveAttendance(models.Model):
    id = models.AutoField(primary_key=True, db_column="archive_attendance_id")
    archived_student = models.ForeignKey(ArchivedStudent, on_delete=models.CASCADE, related_name="archived_attendance", db_column="archive_id")
    subject_name = models.CharField(max_length=100)
    total_sessions = models.PositiveIntegerField()
    total_present = models.PositiveIntegerField()
    total_absent = models.PositiveIntegerField()
    academic_year = models.PositiveIntegerField()

    class Meta:
        db_table = "archive_attendance"
        managed = False
