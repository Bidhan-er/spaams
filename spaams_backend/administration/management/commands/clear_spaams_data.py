"""Clear SPAAMS records while preserving the MySQL schema."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from accounts.bootstrap import ensure_default_admin


SPAAMS_TABLES = (
    "admin", "archive_attendance", "archive_marks", "archived_student",
    "assessment_type", "attendance", "attendance_session", "board_marks",
    "csv_upload_history", "faculty", "guardian", "password_reset",
    "performance_analytics", "semester", "semester_promotion", "sms_history",
    "student", "student_enrollment", "student_marks", "subject", "teacher",
    "teacher_assignment", "user_login",
)


class Command(BaseCommand):
    help = "Permanently delete all SPAAMS data rows but keep every table and column."

    def add_arguments(self, parser):
        parser.add_argument("--confirm", action="store_true", help="Required safety confirmation.")

    def handle(self, *args, **options):
        if not options["confirm"]:
            raise CommandError("Pass --confirm to clear SPAAMS data.")
        if connection.settings_dict["NAME"] != "spaams":
            raise CommandError("Safety check failed: this command only clears the spaams database.")

        with connection.cursor() as cursor:
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
            try:
                for table in SPAAMS_TABLES:
                    cursor.execute(f"DELETE FROM `{table}`")
                for table in SPAAMS_TABLES:
                    try:
                        cursor.execute(f"ALTER TABLE `{table}` AUTO_INCREMENT = 1")
                    except Exception:
                        pass  # Tables without an auto-increment key need no reset.
            finally:
                cursor.execute("SET FOREIGN_KEY_CHECKS = 1")

        admin, created = ensure_default_admin()
        self.stdout.write(self.style.SUCCESS(
            f"Deleted all rows from {len(SPAAMS_TABLES)} SPAAMS tables; schema kept. "
            f"Default Admin {'created' if created else 'kept'}: {admin.username}."
        ))
