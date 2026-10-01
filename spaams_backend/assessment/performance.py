"""Authoritative 100-mark performance calculation shared by assessment APIs."""
from decimal import Decimal

from django.db.models import Count, Q

from attendance.models import Attendance
from .models import AssessmentType, StudentMarks

CATEGORY_TOTALS = {"Assignments": Decimal("10"), "Unit Tests": Decimal("10"), "Attendance": Decimal("15"), "Grooming": Decimal("5"), "Midterm": Decimal("20"), "Lab Reports": Decimal("5"), "Overall Activities": Decimal("5"), "Preboard": Decimal("30")}
# Marks are entered out of 60 for these examinations, then converted to
# their contribution in the 100-mark performance formula.
ENTRY_FULL_MARKS = {**CATEGORY_TOTALS, "Midterm": Decimal("60"), "Preboard": Decimal("60")}
FLEXIBLE_CATEGORIES = {"Assignments", "Unit Tests", "Lab Reports"}
FIXED_ASSESSMENT_CATEGORIES = {"Grooming", "Midterm", "Overall Activities", "Preboard"}


def canonical_category(value):
    value = (value or "").strip().lower()
    return {"unit test": "Unit Tests", "unit tests": "Unit Tests", "preboards": "Preboard", "preboard": "Preboard"}.get(value, value.title() if value else "Other")


def attendance_contribution(student_id, subject_id, semester_id):
    # New attendance is one whole-class record per semester/date.  Retain a
    # subject-scoped fallback only for historical records.
    rows = Attendance.objects.filter(student_id=student_id, session__subject__isnull=True, session__semester_id=semester_id, session__is_locked=True)
    if not rows.exists():
        rows = Attendance.objects.filter(student_id=student_id, session__subject_id=subject_id, session__semester_id=semester_id, session__is_locked=True)
    totals = rows.aggregate(total=Count("id"), present=Count("id", filter=Q(status="Present")))
    if not totals["total"]: return None, None
    rate = Decimal(totals["present"]) * Decimal("100") / Decimal(totals["total"])
    return (rate * CATEGORY_TOTALS["Attendance"] / Decimal("100")).quantize(Decimal("0.01")), rate.quantize(Decimal("0.01"))


def student_performance(student_id, subject_id, academic_year, semester_id):
    columns = list(AssessmentType.objects.filter(subject_id=subject_id))
    marks = {row.assessment_id: row for row in StudentMarks.objects.filter(student_id=student_id, subject_id=subject_id, academic_year=academic_year)}
    values = {name: [] for name in CATEGORY_TOTALS}
    for column in columns:
        category = canonical_category(column.category)
        if category in values and category != "Attendance":
            mark = marks.get(column.id)
            values[category].append((Decimal(column.maximum_marks), None if not mark or mark.marks_obtained is None else Decimal(mark.marks_obtained)))
    breakdown, total, entered_max = {}, Decimal("0"), Decimal("0")
    for category, full in CATEGORY_TOTALS.items():
        if category == "Attendance": obtained, rate = attendance_contribution(student_id, subject_id, semester_id)
        else:
            category_items = values[category]
            # A blank assessment is provisional full marks until a teacher
            # enters its actual mark (useful for late lab reports).
            if category_items:
                raw_full = ENTRY_FULL_MARKS[category] if category in {"Midterm", "Preboard"} else sum((item_full for item_full, _ in category_items), Decimal("0"))
                raw_score = sum((
                    score if score is not None else (ENTRY_FULL_MARKS[category] / len(category_items) if category in {"Midterm", "Preboard"} else item_full)
                    for item_full, score in category_items
                ), Decimal("0"))
                obtained = (raw_score * full / raw_full) if category in {"Midterm", "Preboard"} and raw_full else raw_score
            else:
                obtained = full
            rate = None
        assumed_full = category != "Attendance" and any(score is None for _, score in values[category]) if category != "Attendance" else False
        # Keep the provisional calculation separate from what is shown to a
        # user.  A blank mark can contribute its full value to the current
        # projection, but must still be displayed as a dash until entered.
        entered_scores = [score for _, score in values[category]] if category != "Attendance" else []
        display_obtained = obtained if category == "Attendance" else (sum((score for score in entered_scores if score is not None), Decimal("0")) if entered_scores and all(score is not None for score in entered_scores) else None)
        # display_contribution is the student-facing value.  Unlike the
        # provisional calculation above, it never turns a blank mark into a
        # full score.  Exams are entered out of 60 and displayed on their
        # fixed 20/30-point contribution scale.
        if category == "Attendance":
            display_contribution = obtained
        elif display_obtained is None:
            display_contribution = None
        elif category in {"Midterm", "Preboard"}:
            display_contribution = display_obtained * full / ENTRY_FULL_MARKS[category]
        else:
            display_contribution = display_obtained
        breakdown[category] = {"obtained": float(obtained) if obtained is not None else None, "display_obtained": float(display_obtained) if display_obtained is not None else None, "display_contribution": float(display_contribution) if display_contribution is not None else None, "full_marks": float(full), "input_full_marks": float(ENTRY_FULL_MARKS[category]), "status": "Assumed Full" if assumed_full else ("Entered" if obtained is not None else "Not Entered")}
        if rate is not None: breakdown[category]["attendance_rate"] = float(rate)
        if obtained is not None: total += obtained; entered_max += full
    total = total.quantize(Decimal("0.01"))
    return {"total_obtained": float(total), "performance_percent": float(total), "entered_full_marks": float(entered_max), "is_complete": entered_max == Decimal("100"), "basis": "all assessments" if entered_max == Decimal("100") else "unrecorded assessment marks are currently assumed full", "categories": breakdown}
