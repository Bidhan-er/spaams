from rest_framework import serializers

from .models import Faculty, Semester, Subject, TeacherAssignment


class FacultySerializer(serializers.ModelSerializer):
    class Meta:
        model = Faculty
        fields = ["id", "faculty_name", "university_name"]


class SemesterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Semester
        fields = ["id", "semester_name", "semester_number"]


class SubjectSerializer(serializers.ModelSerializer):
    semester_name = serializers.CharField(source="semester.semester_name", read_only=True)

    class Meta:
        model = Subject
        fields = [
            "id",
            "semester",
            "semester_name",
            "subject_code",
            "subject_name",
            "credit_hour",
        ]


class TeacherAssignmentSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.teacher_name", read_only=True)
    subject_name = serializers.CharField(source="subject.subject_name", read_only=True)
    semester_name = serializers.CharField(source="semester.semester_name", read_only=True)

    class Meta:
        model = TeacherAssignment
        fields = ["id", "teacher", "teacher_name", "subject", "subject_name", "semester", "semester_name", "academic_year", "assigned_date", "status"]
