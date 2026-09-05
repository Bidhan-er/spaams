from accounts.views import IsAdminRole
from assessment.views import IsTeacherRole
from academics.models import TeacherAssignment
from academics.models import StudentEnrollment
from attendance.models import Attendance
from assessment.models import StudentMarks
import numpy as np
import pandas as pd
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import compute_class_performance


class ClassPerformanceAnalyticsView(APIView):
    """
    GET /api/analytics/class-performance/?subject_id=<id>&academic_year=<year>

    Powers the Semester-wise Dashboard: class-wide stats (pandas +
    numpy), a static matplotlib chart, and an interactive plotly
    chart, all computed fresh from student_marks — not cached.
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
    """Admin's semester-wide metrics, rankings, low attendance, and trend-ready data."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        semester_id = request.query_params.get("semester_id")
        academic_year = request.query_params.get("academic_year")
        if not semester_id or not academic_year:
            return Response({"message": "semester_id and academic_year are required."}, status=400)
        students = StudentEnrollment.objects.filter(semester_id=semester_id, academic_year=academic_year, status="Active").select_related("student")
        student_ids = list(students.values_list("student_id", flat=True))
        marks = pd.DataFrame.from_records(StudentMarks.objects.filter(student_id__in=student_ids, subject__semester_id=semester_id, academic_year=academic_year).values("student_id", "marks_obtained", "assessment__maximum_marks"))
        attendance = pd.DataFrame.from_records(Attendance.objects.filter(student_id__in=student_ids, session__semester_id=semester_id).values("student_id", "status"))
        mark_totals = {}
        if not marks.empty:
            grouped = marks.groupby("student_id").agg(obtained=("marks_obtained", "sum"), maximum=("assessment__maximum_marks", "sum"))
            mark_totals = {int(idx): float(row.obtained) * 100 / float(row.maximum) for idx, row in grouped.iterrows() if row.maximum}
        attendance_totals = {}
        if not attendance.empty:
            grouped = attendance.groupby("student_id")["status"].agg(total="count", present=lambda values: (values == "Present").sum())
            attendance_totals = {int(idx): float(row.present) * 100 / float(row.total) for idx, row in grouped.iterrows() if row.total}
        rows = [{"student_id": e.student_id, "registration_number": e.student.registration_number, "full_name": e.student.full_name,
                 "average_marks": round(mark_totals.get(e.student_id, 0), 2), "attendance_percent": round(attendance_totals.get(e.student_id, 0), 2)} for e in students]
        ranked = sorted(rows, key=lambda row: row["average_marks"], reverse=True)
        for position, row in enumerate(ranked, 1): row["rank"] = position
        percentages = np.array([row["average_marks"] for row in rows], dtype=float)
        present = sum(1 for row in rows if row["attendance_percent"] >= 75)
        return Response({"semester_id": int(semester_id), "academic_year": int(academic_year),
            "summary": {"total_students": len(rows), "average_marks": round(float(np.mean(percentages)), 2) if len(percentages) else 0,
                        "highest_marks": round(float(np.max(percentages)), 2) if len(percentages) else 0,
                        "lowest_marks": round(float(np.min(percentages)), 2) if len(percentages) else 0,
                        "pass_count": sum(row["average_marks"] >= 40 for row in rows), "fail_count": sum(row["average_marks"] < 40 for row in rows),
                        "average_attendance": round(float(np.mean([row["attendance_percent"] for row in rows])), 2) if rows else 0},
            "top_five": ranked[:5], "top_ten": ranked[:10],
            "low_attendance": [row for row in rows if row["attendance_percent"] < 75], "students": ranked})
