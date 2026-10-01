"""
assessment/models.py

Maps onto: assessment_type, student_marks, board_marks

Both StudentMarks and BoardMarks carry academic_year — this is
the fix identified while building the frontend: without it, a
student REPEATING a subject (or semester) would collide with the
UNIQUE constraint from their first attempt. Verified against a
live database before this was written (see schema.sql notes).
"""

from django.db import models

from academics.models import Subject


class AssessmentType(models.Model):
    """assessment_type table — Unit Test, Assignment, Preboard, Lab, etc."""
    id = models.AutoField(primary_key=True, db_column="assessment_id")
    # A column belongs to one subject. This prevents a teacher changing
    # Database's assessment columns from altering every other subject.
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, blank=True, null=True, db_column="subject_id", related_name="assessment_types")
    assessment_name = models.CharField(max_length=50)
    # Decimal is required when a 10- or 5-mark flexible category is split
    # into a number of equal assessment items (for example 10 / 3).
    maximum_marks = models.DecimalField(max_digits=6, decimal_places=2)
    category = models.CharField(max_length=30, default="Other")
    pass_marks = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    weightage = models.DecimalField(max_digits=5, decimal_places=2, blank=True, null=True)

    class Meta:
        db_table = "assessment_type"
        managed = False

    def __str__(self):
        return f"{self.subject_id or 'legacy'}: {self.assessment_name}"


class StudentMarks(models.Model):
    """
    student_marks table — teacher-entered marks. Board marks are
    a SEPARATE table (below), entered by Admin only — enforced at
    the view/permission layer, not the model.
    """

    id = models.AutoField(primary_key=True, db_column="student_marks_id")
    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT, related_name="marks")
    # Admin may enter marks before a teacher is assigned to a subject.
    teacher = models.ForeignKey("accounts.Teacher", on_delete=models.PROTECT, blank=True, null=True)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    assessment = models.ForeignKey(AssessmentType, on_delete=models.PROTECT)
    academic_year = models.PositiveIntegerField()
    marks_obtained = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)
    MARK_STATUS_CHOICES = [
        ("Entered", "Entered"),
        ("Not Entered", "Not Entered"),
        ("Absent", "Absent"),
        ("Not Submitted", "Not Submitted"),
    ]
    mark_status = models.CharField(max_length=20, choices=MARK_STATUS_CHOICES, default="Entered")
    entered_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_marks"
        managed = False
        unique_together = ("student", "subject", "assessment", "academic_year")

    def __str__(self):
        return f"{self.student} - {self.subject} - {self.assessment} ({self.academic_year})"


class BoardMarks(models.Model):
    """board_marks table — Admin-entered only."""
    id = models.AutoField(primary_key=True, db_column="board_mark_id")

    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT, related_name="board_marks")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    admin = models.ForeignKey("accounts.Admin", on_delete=models.PROTECT)
    academic_year = models.PositiveIntegerField()
    marks_obtained = models.DecimalField(max_digits=6, decimal_places=2)
    maximum_marks = models.DecimalField(max_digits=6, decimal_places=2)
    entered_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "board_marks"
        managed = False
        unique_together = ("student", "subject", "academic_year")

    def __str__(self):
        return f"{self.student} - {self.subject} board marks ({self.academic_year})"
