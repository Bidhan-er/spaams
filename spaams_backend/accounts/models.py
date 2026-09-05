"""
accounts/models.py

Maps onto your SQL:  user_login -> admin / teacher / student

Design decision (worth being able to explain in your interview):
Instead of hand-rolling a user_login table with our own password
hashing, we use Django's built-in `User` model. Django already:
  - hashes passwords (PBKDF2 by default; bcrypt/Argon2 can be
    swapped in via settings.PASSWORD_HASHERS)
  - handles login sessions / tokens
  - is battle-tested and what real companies use

We then attach a `Profile` (one-to-one with User) to hold the
extra columns your schema needs that Django's User doesn't have:
role, first_login, status. This Profile is the equivalent of your
`user_login` table's extra columns.

Admin / Teacher / Student are then one-to-one with User, exactly
like your schema's admin/teacher/student tables referencing
login_id.
"""

from django.contrib.auth.hashers import check_password, make_password
from django.db import models

from academics.models import Guardian


class UserLogin(models.Model):
    """Maps directly to the manually created `user_login` table."""
    id = models.AutoField(primary_key=True, db_column="login_id")
    username = models.CharField(max_length=50, unique=True)
    password_hash = models.CharField(max_length=255, db_column="password_hash")
    role = models.CharField(max_length=10)
    first_login = models.BooleanField(default=True)
    status = models.CharField(max_length=10, default="Active")
    last_login = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_login"
        managed = False

    @property
    def is_authenticated(self):
        return True

    @property
    def is_active(self):
        return self.status == "Active"

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)


class Admin(models.Model):
    """admin table — one-to-one with a login that has role='Admin'."""

    id = models.AutoField(primary_key=True, db_column="admin_id")
    user = models.OneToOneField(UserLogin, on_delete=models.CASCADE, related_name="admin_profile", db_column="login_id", db_constraint=False)
    full_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=15, unique=True)

    class Meta:
        db_table = "admin"
        managed = False

    def __str__(self):
        return self.full_name


class Teacher(models.Model):
    """teacher table — one-to-one with a login that has role='Teacher'."""

    STATUS_CHOICES = [("Active", "Active"), ("Disabled", "Disabled")]
    GENDER_CHOICES = [("Male", "Male"), ("Female", "Female"), ("Other", "Other")]

    id = models.AutoField(primary_key=True, db_column="teacher_id")
    user = models.OneToOneField(UserLogin, on_delete=models.CASCADE, related_name="teacher_profile", db_column="login_id", db_constraint=False)
    teacher_name = models.CharField(max_length=100)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, default="Other")
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=15, unique=True)
    qualification = models.CharField(max_length=100, blank=True, null=True)
    joining_date = models.DateField(blank=True, null=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Active")

    class Meta:
        db_table = "teacher"
        managed = False

    def __str__(self):
        return self.teacher_name


class Student(models.Model):
    """student table — one-to-one with a login that has role='Student'."""

    GENDER_CHOICES = [("Male", "Male"), ("Female", "Female"), ("Other", "Other")]
    STATUS_CHOICES = [("Active", "Active"), ("Disabled", "Disabled")]

    id = models.AutoField(primary_key=True, db_column="student_id")
    user = models.OneToOneField(UserLogin, on_delete=models.CASCADE, related_name="student_profile", db_column="login_id", db_constraint=False)
    guardian = models.ForeignKey(Guardian, on_delete=models.PROTECT, related_name="students")
    registration_number = models.CharField(max_length=30, unique=True)
    symbol_number = models.CharField(max_length=30, unique=True, blank=True, null=True)
    full_name = models.CharField(max_length=100)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    date_of_birth = models.DateField()
    phone = models.CharField(max_length=15, unique=True)
    email = models.EmailField(blank=True, null=True)
    address = models.TextField()
    photo = models.CharField(max_length=255, blank=True, null=True)  # file path/URL
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Active")

    class Meta:
        db_table = "student"
        managed = False

    def __str__(self):
        return f"{self.registration_number} - {self.full_name}"


class PasswordReset(models.Model):
    """password_reset table — OTP-based 'forgot password' flow."""

    id = models.AutoField(primary_key=True, db_column="reset_id")
    user = models.ForeignKey(UserLogin, on_delete=models.CASCADE, related_name="password_resets", db_column="login_id", db_constraint=False)
    otp = models.CharField(max_length=10)
    expiry_time = models.DateTimeField()
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "password_reset"
        managed = False

    def __str__(self):
        return f"OTP for {self.user.username} (verified={self.verified})"
