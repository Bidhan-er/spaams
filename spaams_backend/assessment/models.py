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

    assessment_name = models.CharField(max_length=50, unique=True)
    maximum_marks = models.PositiveIntegerField()
    weightage = models.DecimalField(max_digits=5, decimal_places=2, blank=True, null=True)

    class Meta:
        db_table = "assessment_type"
        managed = False

    def __str__(self):
        return self.assessment_name


class StudentMarks(models.Model):
    """
    student_marks table — teacher-entered marks. Board marks are
    a SEPARATE table (below), entered by Admin only — enforced at
    the view/permission layer, not the model.
    """

    id = models.AutoField(primary_key=True, db_column="student_marks_id")
    student = models.ForeignKey("accounts.Student", on_delete=models.PROTECT, related_name="marks")
    teacher = models.ForeignKey("accounts.Teacher", on_delete=models.PROTECT)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    assessment = models.ForeignKey(AssessmentType, on_delete=models.PROTECT)
    academic_year = models.PositiveIntegerField()
    marks_obtained = models.DecimalField(max_digits=6, decimal_places=2)
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
