from rest_framework import serializers
from decimal import Decimal

from .models import AssessmentType, BoardMarks, StudentMarks


class AssessmentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentType
        fields = ["id", "subject", "assessment_name", "maximum_marks", "pass_marks", "category", "weightage"]


class StudentMarksSerializer(serializers.ModelSerializer):
    assessment_name = serializers.CharField(source="assessment.assessment_name", read_only=True)

    class Meta:
        model = StudentMarks
        fields = ["id", "student", "subject", "assessment", "assessment_name", "academic_year", "marks_obtained", "mark_status"]


class BoardMarksSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardMarks
        fields = ["id", "student", "subject", "academic_year", "marks_obtained", "maximum_marks"]

    def validate(self, attrs):
        maximum = Decimal(str(attrs.get("maximum_marks", getattr(self.instance, "maximum_marks", "4"))))
        marks = Decimal(str(attrs.get("marks_obtained", getattr(self.instance, "marks_obtained", "0"))))
        if maximum != Decimal("4"):
            raise serializers.ValidationError({"maximum_marks": "Board GPA is always out of 4.00."})
        if marks < 0 or marks > Decimal("4"):
            raise serializers.ValidationError({"marks_obtained": "Board GPA must be between 0.00 and 4.00."})
        return attrs
