from accounts.views import IsAdminRole
from assessment.views import IsTeacherRole
from academics.models import TeacherAssignment, Subject
from academics.models import StudentEnrollment
from attendance.models import Attendance
from assessment.models import StudentMarks
from assessment.performance import CATEGORY_TOTALS, ENTRY_FULL_MARKS, student_performance
import numpy as np
import pandas as pd
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import compute_class_performance


class ClassPerformanceAnalyticsView(APIView):
    """
    GET /api/analytics/class-performance/?subject_id=<id>&academic_year=<year>

    Powers the Semester-wise Dashboard with fresh pandas/numpy data.
    Chart.js renders the responsive charts in the browser.
    """

    permission_classes = [IsAdminRole | IsTeacherRole]

    def get(self, request):
        subject_id = request.query_params.get("subject_id")
        academic_year = request.query_params.get("academic_year")

        if not subject_id or not academic_year:
            return Response({"error": "subject_id and academic_year are required."}, status=400)

        if request.user.role == "Teacher" and not TeacherAssignment.objects.filter(
            teacher__user=request.user, subject_id=subject_id, academic_year=academic_year, status="Active"
        ).exists():
            return Response({"error": "You are not assigned to this subject."}, status=403)

        data = compute_class_performance(int(subject_id), int(academic_year))
        return Response(data)


class SemesterAnalyticsView(APIView):
    """Semester metrics. Teachers see only subjects assigned to them."""
    permission_classes = [IsAdminRole | IsTeacherRole]

    def get(self, request):
        semester_id = request.query_params.get("semester_id")
        academic_year = request.query_params.get("academic_year")
        if not semester_id or not academic_year:
            return Response({"message": "semester_id and academic_year are required."}, status=400)
        students = StudentEnrollment.objects.filter(semester_id=semester_id, academic_year=academic_year, status="Active").select_related("student")
        subjects_query = Subject.objects.filter(semester_id=semester_id)
        if request.user.role == "Teacher":
            assigned_subject_ids = TeacherAssignment.objects.filter(
                teacher__user=request.user, academic_year=academic_year,
                semester_id=semester_id, status="Active",
            ).values_list("subject_id", flat=True)
            subjects_query = subjects_query.filter(id__in=assigned_subject_ids)
        subjects = list(subjects_query.order_by("subject_name"))
        rows = []
        for enrollment in students:
            subject_data = {str(subject.id): student_performance(enrollment.student_id, subject.id, int(academic_year), int(semester_id)) for subject in subjects}
            entered = [item["performance_percent"] for item in subject_data.values() if item["entered_full_marks"]]
            attendance_rates = [item["categories"]["Attendance"].get("attendance_rate") for item in subject_data.values() if item["categories"]["Attendance"].get("attendance_rate") is not None]
            overall_performance = round(sum(entered) / len(entered), 2) if entered else None
            rows.append({"student_id": enrollment.student_id, "registration_number": enrollment.student.registration_number, "full_name": enrollment.student.full_name,
                         # Every subject has equal weight in the semester.
                         # For example, 5 subjects contribute 20% each and 2
                         # subjects contribute 50% each to this 100% result.
                         "average_marks": overall_performance, "overall_performance": overall_performance,
                         "attendance_percent": round(sum(attendance_rates) / len(attendance_rates), 2) if attendance_rates else None,
                         "subjects": subject_data})
        percentages = np.array([row["average_marks"] for row in rows if row["average_marks"] is not None], dtype=float)
        attendance_percentages = [row["attendance_percent"] for row in rows if row["attendance_percent"] is not None]
        return Response({"semester_id": int(semester_id), "academic_year": int(academic_year),
            "summary": {"total_students": len(rows), "average_marks": round(float(np.mean(percentages)), 2) if len(percentages) else 0,
                        "highest_marks": round(float(np.max(percentages)), 2) if len(percentages) else 0,
                        "lowest_marks": round(float(np.min(percentages)), 2) if len(percentages) else 0,
                        "pass_count": sum((row["average_marks"] or 0) >= 40 for row in rows if row["average_marks"] is not None), "fail_count": sum((row["average_marks"] or 0) < 40 for row in rows if row["average_marks"] is not None),
                        "average_attendance": round(float(np.mean(attendance_percentages)), 2) if attendance_percentages else None},
            "subjects": [{"id": subject.id, "name": subject.subject_name} for subject in subjects],
            "categories": [{"name": name, "full_marks": float(full), "input_full_marks": float(ENTRY_FULL_MARKS[name])} for name, full in CATEGORY_TOTALS.items()],
            "low_attendance": [row for row in rows if row["attendance_percent"] is not None and row["attendance_percent"] < 75], "students": rows})
