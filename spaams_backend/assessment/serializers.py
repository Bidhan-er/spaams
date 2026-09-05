from rest_framework import serializers

from .models import AssessmentType, BoardMarks, StudentMarks


class AssessmentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentType
        fields = ["id", "assessment_name", "maximum_marks", "weightage"]


class StudentMarksSerializer(serializers.ModelSerializer):
    assessment_name = serializers.CharField(source="assessment.assessment_name", read_only=True)

    class Meta:
        model = StudentMarks
        fields = ["id", "student", "subject", "assessment", "assessment_name", "academic_year", "marks_obtained"]


class BoardMarksSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardMarks
        fields = ["id", "student", "subject", "academic_year", "marks_obtained", "maximum_marks"]
