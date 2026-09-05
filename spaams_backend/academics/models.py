"""
academics/models.py

These models mirror the SQL schema you already designed
(faculty, semester, subject, guardian, student_enrollment,
teacher_assignment). We keep the same table shape so it's easy
to explain in an interview: "this Django model IS this SQL table."

Student and Teacher records themselves live in accounts/models.py
next to the login/auth data, because in your schema they are
directly tied to user_login (one login = one student OR one
teacher OR one admin).
"""

from django.db import models


class Faculty(models.Model):
    """faculty table — e.g. 'BCA' / 'Tribhuvan University'."""
    id = models.AutoField(primary_key=True, db_column="faculty_id")

    faculty_name = models.CharField(max_length=50, unique=True)
    university_name = models.CharField(max_length=100)

    class Meta:
        db_table = "faculty"
        managed = False

    def __str__(self):
        return self.faculty_name


class Semester(models.Model):
    """semester table — fixed Semester 1..8 for BCA."""
    id = models.AutoField(primary_key=True, db_column="semester_id")

    semester_name = models.CharField(max_length=30, unique=True)
    semester_number = models.PositiveSmallIntegerField(unique=True)

    class Meta:
        db_table = "semester"
        managed = False
        ordering = ["semester_number"]

    def __str__(self):
        return self.semester_name


class Subject(models.Model):
    """subject table — one subject belongs to exactly one semester."""
    id = models.AutoField(primary_key=True, db_column="subject_id")

    semester = models.ForeignKey(
        Semester, on_delete=models.PROTECT, related_name="subjects"
    )
    subject_code = models.CharField(max_length=20, unique=True)
    subject_name = models.CharField(max_length=100)
    credit_hour = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "subject"
        managed = False

    def __str__(self):
        return f"{self.subject_code} - {self.subject_name}"


class Guardian(models.Model):
    """guardian table — a guardian can be linked to more than one student (siblings)."""
    id = models.AutoField(primary_key=True, db_column="guardian_id")

    guardian_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=15)
    email = models.EmailField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    relationship = models.CharField(max_length=30, blank=True, null=True)

    class Meta:
        db_table = "guardian"
        managed = False

    def __str__(self):
        return self.guardian_name


class StudentEnrollment(models.Model):
    """
    student_enrollment table — which semester/faculty a student
    currently belongs to. Kept separate from `Student` (in
    accounts/models.py) because a student's enrollment changes
    every semester promotion, while their core identity doesn't.
    """

    id = models.AutoField(primary_key=True, db_column="enrollment_id")
    STATUS_CHOICES = [
        ("Active", "Active"),
        ("Graduated", "Graduated"),
        ("Dropped", "Dropped"),
    ]

    # string reference avoids a circular import between the two apps
    student = models.ForeignKey(
        "accounts.Student", on_delete=models.PROTECT, related_name="enrollments"
    )
    faculty = models.ForeignKey(Faculty, on_delete=models.PROTECT)
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    academic_year = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Active")
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_enrollment"
        managed = False
        unique_together = ("student", "semester", "academic_year")

    def __str__(self):
        return f"{self.student} - {self.semester} ({self.academic_year})"


class TeacherAssignment(models.Model):
    """
    teacher_assignment table — which teacher teaches which subject
    in which semester. This is what scopes a Teacher's dashboard
    access, and what the attendance/marks screens check against.
    """

    id = models.AutoField(primary_key=True, db_column="assignment_id")
    STATUS_CHOICES = [("Active", "Active"), ("Inactive", "Inactive")]

    teacher = models.ForeignKey(
        "accounts.Teacher", on_delete=models.PROTECT, related_name="assignments"
    )
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    academic_year = models.PositiveIntegerField()  # FIX: without this, a teacher
    # couldn't be reassigned to the same subject+semester the following year.
    assigned_date = models.DateField(blank=True, null=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Active")

    class Meta:
        db_table = "teacher_assignment"
        managed = False
        unique_together = ("teacher", "subject", "semester", "academic_year")

    def __str__(self):
        return f"{self.teacher} -> {self.subject} ({self.semester}, {self.academic_year})"
