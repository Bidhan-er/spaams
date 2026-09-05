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
  - matplotlib: draws the pie chart as an image on the server. We
    encode that image as base64 text and send it inside the JSON
    response, so the frontend just does <img src="data:image/png..">
    with zero charting code of its own.

Once real StudentMarks / Attendance tables exist, replace the
`_get_raw_records()` mock function with a real queryset -> DataFrame
conversion. Everything below it does not need to change.
"""

import base64
import io

import matplotlib

matplotlib.use("Agg")  # server-side rendering, no GUI window needed
import matplotlib.pyplot as plt
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
        return float((selected["marks_obtained"].astype(float).sum() / selected["assessment__maximum_marks"].sum()) * 100)

    attendance_percent = float((records["status"] == "Present").mean() * 100) if not records.empty else 0.0
    result_percent = float((marks["marks_obtained"].astype(float).sum() / marks["assessment__maximum_marks"].sum()) * 100) if not marks.empty else 0.0
    return {"attendance_percent": attendance_percent, "assignments_percent": marks_percent("assignment"),
            "lab_percent": marks_percent("lab"), "result_percent": result_percent,
            "overall_activities_percent": marks_percent("overall|activity")}


def compute_student_performance(student_id):
    """
    Returns a dict with:
      - stats: the raw percentages (used for the small numbers/labels)
      - chart_base64: a ready-to-display pie chart PNG, base64-encoded
    """
    raw = _get_raw_records(student_id)
    # No invented zero-value pie chart. A chart exists only when a
    # teacher/admin has actually entered marks or attendance.
    if not any(raw.values()):
        return {
            "stats": {**raw, "overall_average": 0},
            "chart_base64": None,
            "has_data": False,
        }

    # pandas: put the record into a one-row table, just like your
    # `performance_analytics` SQL table would hold it.
    df = pd.DataFrame([raw])

    # numpy: compute the overall average across the 5 categories.
    values = df.iloc[0].to_numpy(dtype=float)
    labels = ["Attendance", "Assignments", "Lab", "Result", "Overall activities"]
    overall_average = float(np.mean(values))

    chart_base64 = _render_pie_chart(labels, values)

    return {
        "stats": {
            "attendance_percent": raw["attendance_percent"],
            "assignments_percent": raw["assignments_percent"],
            "lab_percent": raw["lab_percent"],
            "result_percent": raw["result_percent"],
            "overall_activities_percent": raw["overall_activities_percent"],
            "overall_average": round(overall_average, 1),
        },
        "chart_base64": chart_base64,
        "has_data": True,
    }


def _render_pie_chart(labels, values):
    """matplotlib draws the chart; we hand back a base64 PNG string."""

    colors = ["#4f8fff", "#4ed08a", "#f0a84e", "#b076f0", "#f0664e"]

    fig, ax = plt.subplots(figsize=(4, 4))
    ax.pie(
        values,
        labels=labels,
        autopct="%1.0f%%",
        colors=colors,
        textprops={"fontsize": 8},
    )
    ax.set_title("Performance Breakdown", fontsize=10)

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", transparent=True, bbox_inches="tight")
    plt.close(fig)  # important: frees memory, avoids leaking figures

    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("utf-8")
    return encoded
