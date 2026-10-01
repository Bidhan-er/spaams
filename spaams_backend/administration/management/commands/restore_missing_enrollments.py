"""Restore the semester/batch rows for SPAAMS's original 240-student dataset.

It is safe to run more than once: existing enrollments are never replaced.
No marks are created by this command.
"""
import re

from django.core.management.base import BaseCommand, CommandError

from accounts.models import Student
from academics.models import Faculty, Semester, StudentEnrollment


def semester_for_registration(registration_number):
    match = re.fullmatch(r"TU-BCA-(\d{4})-(\d{3})", registration_number)
    if not match:
        return None
    batch, sequence = int(match.group(1)), int(match.group(2))
    if batch == 2025 and 1 <= sequence <= 30:
        return 1
    if batch == 2024 and 31 <= sequence <= 60:
        return 2
    if batch == 2024 and 61 <= sequence <= 90:
        return 3
    if batch == 2023 and 91 <= sequence <= 120:
        return 4
    if batch == 2023 and 121 <= sequence <= 150:
        return 5
    if batch == 2022 and 151 <= sequence <= 180:
        return 6
    if batch == 2022 and 181 <= sequence <= 210:
        return 7
    if batch == 2021 and 211 <= sequence <= 240:
        return 8
    return None


class Command(BaseCommand):
    help = "Restore missing semester/batch enrollments for the original 240 SPAAMS students without creating marks."

    def handle(self, *args, **options):
        faculty = Faculty.objects.filter(faculty_name="BCA").first()
        if not faculty:
            raise CommandError("The BCA faculty record is missing.")
        semesters = {row.semester_number: row for row in Semester.objects.all()}
        if len(semesters) < 8:
            raise CommandError("Semesters I to VIII must exist before restoring enrollments.")

        restored, skipped = 0, 0
        for student in Student.objects.order_by("registration_number"):
            if student.enrollments.exists():
                skipped += 1
                continue
            semester_number = semester_for_registration(student.registration_number)
            if semester_number is None:
                skipped += 1
                continue
            batch = int(student.registration_number.split("-")[2])
            StudentEnrollment.objects.create(
                student=student, faculty=faculty, semester=semesters[semester_number],
                academic_year=batch, status="Active"
            )
            restored += 1
        self.stdout.write(self.style.SUCCESS(f"Restored {restored} enrollment row(s); skipped {skipped}. No marks were created."))
