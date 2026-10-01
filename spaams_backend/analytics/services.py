"""
analytics/services.py

This is where pandas and numpy calculate the real class data. The
views return JSON that Chart.js turns into responsive browser charts.

  - pandas:  pulls the queryset into a DataFrame, then GROUPS BY
             student to turn "one row per mark" into "one row per
             student" (a pivot), which is the shape both charts need.
  - numpy:   the underlying math pandas uses (mean, std, min/max) —
             called out explicitly here rather than left implicit,
             since that's exactly what was asked for.
  - Chart.js: displays this calculation data in the frontend with
             responsive hover tooltips and no server-generated images.
"""

import numpy as np
import pandas as pd

from assessment.models import StudentMarks


def get_class_marks_dataframe(subject_id, academic_year):
    """
    pandas step 1: pull every StudentMarks row for this
    subject+year into a DataFrame, with the student's name
    attached (select_related avoids one query per row).
    """
    qs = (
        StudentMarks.objects.filter(subject_id=subject_id, academic_year=academic_year)
        .select_related("student", "assessment")
        .values(
            "student_id",
            "student__full_name",
            "student__registration_number",
            "assessment__assessment_name",
            "marks_obtained",
        )
    )
    df = pd.DataFrame.from_records(qs)
    return df


def build_class_summary(df):
    """
    pandas step 2: pivot from "one row per (student, assessment)"
    to "one row per student, one column per assessment" — this is
    the actual DataFrame.pivot_table() call doing real work, not
    just pandas as a fancy list.

    numpy step: mean/std/min/max on the resulting per-student
    totals — pandas calls numpy under the hood for these, but
    we're explicit about it below for the class-wide stats.
    """
    if df.empty:
        return None

    pivot = df.pivot_table(
        index=["student_id", "student__full_name", "student__registration_number"],
        columns="assessment__assessment_name",
        values="marks_obtained",
        aggfunc="sum",
    ).reset_index()

    assessment_cols = [c for c in pivot.columns if c not in ("student_id", "student__full_name", "student__registration_number")]
    pivot["total"] = pivot[assessment_cols].sum(axis=1)

    totals = pivot["total"].to_numpy(dtype=float)  # explicit numpy array

    class_stats = {
        "class_average": float(np.mean(totals)),
        "class_std_dev": float(np.std(totals)),
        "class_min": float(np.min(totals)),
        "class_max": float(np.max(totals)),
        "student_count": int(len(totals)),
    }

    return {
        "pivot": pivot,
        "assessment_cols": assessment_cols,
        "class_stats": class_stats,
    }


def compute_class_performance(subject_id, academic_year):
    """The single entry point the view calls."""
    df = get_class_marks_dataframe(subject_id, academic_year)
    summary = build_class_summary(df)

    if summary is None:
        return {"has_data": False}

    return {
        "has_data": True,
        "class_stats": summary["class_stats"],
        "students": summary["pivot"][["student__registration_number", "student__full_name", "total"]]
        .rename(columns={"student__registration_number": "registration_number", "student__full_name": "full_name"})
        .to_dict(orient="records"),
        "chart": {
            "labels": summary["assessment_cols"],
            "values": [round(float(summary["pivot"][column].mean()), 2) for column in summary["assessment_cols"]],
        },
    }
