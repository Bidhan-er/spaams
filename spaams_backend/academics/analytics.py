"""
academics/analytics.py

This is the "python code for calculation" part of the Admin
Panel's Student Detail -> Academic Details screen.

Why these libraries, in plain terms (good to say in an interview):
  - pandas: holds a student's raw records (marks per subject,
    attendance per session) as a small table (DataFrame) so we can
    group/average them the same way you would in Excel, but in code.
  - numpy: does the actual number-crunching (percentages, means)
    underneath pandas.
  - Chart.js: draws the responsive chart in the browser from these
    calculated values, including hover labels and automatic resizing.

Once real StudentMarks / Attendance tables exist, replace the
`_get_raw_records()` mock function with a real queryset -> DataFrame
conversion. Everything below it does not need to change.
"""

import numpy as np
import pandas as pd


def _get_raw_records(student_id):
    """
    STAND-IN for real data. In production this becomes:

        marks_qs = StudentMarks.objects.filter(student_id=student_id)
        attendance_qs = Attendance.objects.filter(student_id=student_id)
        df = pd.DataFrame(list(marks_qs.values(...)))

    For now we return fixed numbers so the endpoint is fully
    testable before the Marks/Attendance apps exist.
    """
    from assessment.models import StudentMarks
    from attendance.models import Attendance

    marks = pd.DataFrame.from_records(StudentMarks.objects.filter(student_id=student_id).values(
        "marks_obtained", "assessment__assessment_name", "assessment__maximum_marks"
    ))
    records = pd.DataFrame.from_records(Attendance.objects.filter(student_id=student_id).values("status"))

    def marks_percent(keyword):
        if marks.empty:
            return 0.0
        selected = marks[marks["assessment__assessment_name"].str.contains(keyword, case=False, na=False)]
        if selected.empty:
            return 0.0
        obtained = pd.to_numeric(selected["marks_obtained"], errors="coerce").fillna(0)
        maximum = pd.to_numeric(selected["assessment__maximum_marks"], errors="coerce").fillna(0)
        return float(obtained.sum() / maximum.sum() * 100) if maximum.sum() else 0.0

    attendance_percent = float((records["status"] == "Present").mean() * 100) if not records.empty else 0.0
    if marks.empty:
        result_percent = 0.0
    else:
        obtained = pd.to_numeric(marks["marks_obtained"], errors="coerce").fillna(0)
        maximum = pd.to_numeric(marks["assessment__maximum_marks"], errors="coerce").fillna(0)
        result_percent = float(obtained.sum() / maximum.sum() * 100) if maximum.sum() else 0.0
    return {"attendance_percent": attendance_percent, "assignments_percent": marks_percent("assignment"),
            "lab_percent": marks_percent("lab"), "result_percent": result_percent,
            "overall_activities_percent": marks_percent("overall|activity")}


def compute_student_performance(student_id):
    """
    Returns a dict with:
      - stats: the raw percentages (used for the small numbers/labels)
      - stats: percentage values which Chart.js renders in the browser
    """
    raw = _get_raw_records(student_id)
    # No invented zero-value pie chart. A chart exists only when a
    # teacher/admin has actually entered marks or attendance.
    if not any(raw.values()):
        return {
            "stats": {**raw, "overall_average": 0},
            "has_data": False,
        }

    # pandas: put the record into a one-row table, just like your
    # `performance_analytics` SQL table would hold it.
    df = pd.DataFrame([raw])

    # numpy: compute the overall average across the 5 categories.
    values = df.iloc[0].to_numpy(dtype=float)
    labels = ["Attendance", "Assignments", "Lab", "Result", "Overall activities"]
    overall_average = float(np.mean(values))

    return {
        "stats": {
            "attendance_percent": raw["attendance_percent"],
            "assignments_percent": raw["assignments_percent"],
            "lab_percent": raw["lab_percent"],
            "result_percent": raw["result_percent"],
            "overall_activities_percent": raw["overall_activities_percent"],
            "overall_average": round(overall_average, 1),
        },
        "has_data": True,
    }
