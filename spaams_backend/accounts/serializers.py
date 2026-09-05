"""
accounts/serializers.py

Serializers are Django REST Framework's way of converting between
Python objects <-> JSON, and validating incoming data. Think of
each serializer as "the shape of one API request or response."
"""

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Admin, Student, Teacher, UserLogin
from academics.models import Faculty, Guardian, Semester, StudentEnrollment


class LoginSerializer(serializers.Serializer):
    """Validates the shape of a login request: { username, password, role }."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True)
    role = serializers.ChoiceField(choices=["Admin", "Teacher", "Student"])


class ChangePasswordSerializer(serializers.Serializer):
    """Validates a forced/normal password change request."""

    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        # Reuses Django's built-in password strength rules
        # (min length, not too common, not all numeric, etc.)
        validate_password(value)
        return value

    def validate(self, data):
        if data["new_password"] != data["confirm_password"]:
            raise serializers.ValidationError(
                {"confirm_password": "New password and confirmation do not match."}
            )
        return data


class StudentSerializer(serializers.ModelSerializer):
    """
    Used by the Admin panel's 'Manage Students' screen — both for
    listing students and for creating a new one.
    """

    username = serializers.CharField(write_only=True, required=False)
    email = serializers.EmailField(required=False, allow_null=True, allow_blank=True)
    guardian = serializers.PrimaryKeyRelatedField(read_only=True)
    guardian_name = serializers.CharField(write_only=True, required=False)
    guardian_phone = serializers.CharField(write_only=True, required=False)
    guardian_email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    guardian_name_display = serializers.CharField(source="guardian.guardian_name", read_only=True)
    guardian_phone_display = serializers.CharField(source="guardian.phone", read_only=True)
    guardian_email_display = serializers.EmailField(source="guardian.email", read_only=True)
    semester_number = serializers.IntegerField(write_only=True, required=False, min_value=1, max_value=8)
    academic_year = serializers.IntegerField(write_only=True, required=False)
    faculty_name = serializers.CharField(write_only=True, required=False)
    semester = serializers.SerializerMethodField(read_only=True)
    faculty = serializers.SerializerMethodField(read_only=True)
    current_semester_number = serializers.SerializerMethodField(read_only=True)
    current_academic_year = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Student
        fields = [
            "id",
            "registration_number",
            "symbol_number",
            "full_name",
            "gender",
            "date_of_birth",
            "phone",
            "address",
            "photo",
            "status",
            "guardian",
            "guardian_name",
            "guardian_phone",
            "guardian_email",
            "guardian_name_display",
            "guardian_phone_display",
            "guardian_email_display",
            "username",
            "email",
            "semester_number",
            "academic_year",
            "faculty_name",
            "semester",
            "faculty",
            "current_semester_number",
            "current_academic_year",
        ]

    def get_semester(self, student):
        enrollment = student.enrollments.filter(status="Active").select_related("semester").order_by("-academic_year").first()
        return enrollment.semester.semester_name if enrollment else None

    def get_faculty(self, student):
        enrollment = student.enrollments.filter(status="Active").select_related("faculty").order_by("-academic_year").first()
        return enrollment.faculty.faculty_name if enrollment else None

    def get_current_semester_number(self, student):
        enrollment = student.enrollments.filter(status="Active").select_related("semester").order_by("-academic_year").first()
        return enrollment.semester.semester_number if enrollment else None

    def get_current_academic_year(self, student):
        enrollment = student.enrollments.filter(status="Active").order_by("-academic_year").first()
        return enrollment.academic_year if enrollment else None

    def validate_registration_number(self, value):
        query = Student.objects.filter(registration_number=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists() or UserLogin.objects.exclude(pk=self.instance.user_id if self.instance else None).filter(username=value).exists():
            raise serializers.ValidationError("This registration number already exists. Use a new registration number.")
        return value

    def create(self, validated_data):
        """
        Creating a student = creating the login account first
        (with a temporary password + first_login=True), then the
        student record itself. This mirrors your doc's rule:
        "Admin creates accounts... Students receive credentials."
        """
        username = validated_data.pop("username", None) or validated_data["registration_number"]
        guardian_name = validated_data.pop("guardian_name", "").strip()
        guardian_phone = validated_data.pop("guardian_phone", "").strip()
        guardian_email = validated_data.pop("guardian_email", "")
        semester_number = validated_data.pop("semester_number", None)
        academic_year = validated_data.pop("academic_year", None)
        faculty_name = validated_data.pop("faculty_name", "BCA")
        if not guardian_name or not guardian_phone or not semester_number or not academic_year:
            raise serializers.ValidationError("Guardian details, semester, and academic year are required.")

        # Temporary password policy — in production this could be
        # randomly generated and emailed/SMSed instead of hardcoded.
        temporary_password = f"{validated_data['registration_number']}@123"

        user = UserLogin(username=username, role="Student", first_login=True, status="Active")
        user.set_password(temporary_password)
        user.save()
        guardian = Guardian.objects.create(guardian_name=guardian_name, phone=guardian_phone, email=guardian_email or None)
        validated_data["guardian"] = guardian
        student = Student.objects.create(user=user, **validated_data)
        faculty = Faculty.objects.get(faculty_name=faculty_name)
        semester = Semester.objects.get(semester_number=semester_number)
        StudentEnrollment.objects.create(student=student, faculty=faculty, semester=semester, academic_year=academic_year, status="Active")
        return student

    def update(self, instance, validated_data):
        username = validated_data.pop("username", None)
        guardian_name = validated_data.pop("guardian_name", None)
        guardian_phone = validated_data.pop("guardian_phone", None)
        guardian_email = validated_data.pop("guardian_email", None)
        semester_number = validated_data.pop("semester_number", None)
        academic_year = validated_data.pop("academic_year", None)
        faculty_name = validated_data.pop("faculty_name", None)
        if username and username != instance.user.username:
            if UserLogin.objects.exclude(pk=instance.user_id).filter(username=username).exists():
                raise serializers.ValidationError({"username": "This username is already in use."})
            instance.user.username = username
            instance.user.save(update_fields=["username"])
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if "status" in validated_data:
            instance.user.status = "Disabled" if instance.status == "Disabled" else "Active"
            instance.user.save(update_fields=["status"])
        guardian = instance.guardian
        if guardian_name is not None:
            guardian.guardian_name = guardian_name
        if guardian_phone is not None:
            guardian.phone = guardian_phone
        if guardian_email is not None:
            guardian.email = guardian_email or None
        guardian.save()
        if semester_number or academic_year or faculty_name:
            enrollment = instance.enrollments.filter(status="Active").order_by("-academic_year").first()
            if enrollment:
                if semester_number:
                    enrollment.semester = Semester.objects.get(semester_number=semester_number)
                if academic_year:
                    enrollment.academic_year = academic_year
                if faculty_name:
                    enrollment.faculty = Faculty.objects.get(faculty_name=faculty_name)
                enrollment.save()
        return instance


class TeacherSerializer(serializers.ModelSerializer):
    """Used by the Admin panel's 'Manage Teachers' screen."""

    username = serializers.CharField(write_only=True, required=False)
    email = serializers.EmailField(required=False)
    login_id = serializers.IntegerField(source="user_id", read_only=True)
    username_display = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Teacher
        fields = [
            "id",
            "login_id",
            "username_display",
            "teacher_name",
            "gender",
            "phone",
            "qualification",
            "joining_date",
            "status",
            "username",
            "email",
        ]

    def validate_username(self, value):
        query = UserLogin.objects.filter(username=value)
        if self.instance:
            query = query.exclude(pk=self.instance.user_id)
        if query.exists():
            raise serializers.ValidationError("This username is already in use.")
        return value

    def create(self, validated_data):
        username = validated_data.pop("username", None)
        email = validated_data.pop("email", "")
        if not username:
            # simple default: first name + a running number could be nicer;
            # for now, slugify the teacher name
            username = validated_data["teacher_name"].split(" ")[0].lower()

        temporary_password = "Teacher@123"
        user = UserLogin(username=username, role="Teacher", first_login=True,
                         status="Active" if validated_data.get("status", "Active") == "Active" else "Disabled")
        user.set_password(temporary_password)
        user.save()
        validated_data["email"] = email
        teacher = Teacher.objects.create(user=user, **validated_data)
        return teacher

    def update(self, instance, validated_data):
        username = validated_data.pop("username", None)
        if username and username != instance.user.username:
            if UserLogin.objects.exclude(pk=instance.user_id).filter(username=username).exists():
                raise serializers.ValidationError({"username": "This username is already in use."})
            instance.user.username = username
            instance.user.save(update_fields=["username"])
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if "status" in validated_data:
            instance.user.status = "Active" if instance.status == "Active" else "Disabled"
            instance.user.save(update_fields=["status"])
        return instance
