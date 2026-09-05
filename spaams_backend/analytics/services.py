"""
analytics/services.py

This is where pandas, numpy, matplotlib, and plotly actually do
work — the views just call these functions and return what they
give back.

  - pandas:  pulls the queryset into a DataFrame, then GROUPS BY
             student to turn "one row per mark" into "one row per
             student" (a pivot), which is the shape both charts need.
  - numpy:   the underlying math pandas uses (mean, std, min/max) —
             called out explicitly here rather than left implicit,
             since that's exactly what was asked for.
  - matplotlib: a static PNG (base64-encoded) — cheap to generate,
             works anywhere, no JS needed on the frontend.
  - plotly:  a genuinely interactive chart (hover tooltips, zoom,
             pan) — returned as an HTML snippet the frontend can
             drop straight into a <div>.
"""

import base64
import io

import matplotlib

matplotlib.use("Agg")  # server-side rendering, no display needed
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import plotly.graph_objects as go

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


def render_matplotlib_summary_chart(summary):
    """Static PNG: class-average breakdown by assessment type."""
    pivot = summary["pivot"]
    cols = summary["assessment_cols"]
    averages = [pivot[c].mean() for c in cols]

    fig, ax = plt.subplots(figsize=(5, 3.2))
    colors = ["#4f8fff", "#4ed08a", "#f0a84e", "#b076f0", "#f0664e", "#2fb8c4"]
    ax.bar(cols, averages, color=[colors[i % len(colors)] for i in range(len(cols))])
    ax.set_ylabel("Average marks")
    ax.set_title("Class Average by Assessment Type", fontsize=10)
    ax.tick_params(axis="x", labelrotation=25, labelsize=8)
    fig.tight_layout()

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", transparent=True, dpi=140)
    plt.close(fig)
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def render_plotly_interactive_chart(summary):
    """
    Interactive chart: one bar per student, hover shows their exact
    total and a per-assessment breakdown. Returned as an HTML
    fragment (not a full page) so the frontend can embed it directly.
    """
    pivot = summary["pivot"]
    cols = summary["assessment_cols"]

    hover_text = []
    for _, row in pivot.iterrows():
        breakdown = "<br>".join(f"{c}: {row[c]:.1f}" for c in cols)
        hover_text.append(f"<b>{row['student__full_name']}</b><br>{breakdown}<br><b>Total: {row['total']:.1f}</b>")

    fig = go.Figure(
        data=[
            go.Bar(
                x=pivot["student__full_name"],
                y=pivot["total"],
                marker_color="#4f6df5",
                hovertext=hover_text,
                hoverinfo="text",
            )
        ]
    )
    fig.update_layout(
        title="Student Totals (hover for breakdown)",
        xaxis_title="Student",
        yaxis_title="Total marks",
        margin=dict(l=40, r=20, t=40, b=80),
        height=380,
        xaxis_tickangle=-35,
    )

    return fig.to_html(full_html=False, include_plotlyjs="cdn")


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
        "matplotlib_chart_base64": render_matplotlib_summary_chart(summary),
        "plotly_chart_html": render_plotly_interactive_chart(summary),
    }
