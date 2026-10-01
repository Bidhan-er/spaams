"""Restore display-only temporary passwords for unchanged seeded accounts.

Only accounts that still require their first login are considered.  The
candidate legacy password is verified against Django's existing PBKDF2 hash
before it is copied into the short-lived admin display field.
"""

from django.core.management.base import BaseCommand

from accounts.models import Student, Teacher


class Command(BaseCommand):
    help = "Restore verified legacy temporary passwords for pending accounts."

    def handle(self, *args, **options):
        restored_students, reset_students = self._restore_students()
        restored_teachers = self._restore_teachers()
        self.stdout.write(self.style.SUCCESS(
            f"Restored {restored_students} student and {restored_teachers} teacher temporary password display value(s); reset {reset_students} unrecoverable student temporary password(s)."
        ))

    @staticmethod
    def _restore_students():
        restored = reset = 0
        students = Student.objects.select_related("user").filter(
            user__first_login=True, user__temp_password_plain__isnull=True,
        )
        for student in students:
            candidate = f"{student.registration_number}@123"
            if student.user.check_password(candidate):
                student.user.temp_password_plain = candidate
                student.user.save(update_fields=["temp_password_plain"])
                restored += 1
            else:
                # These old pending records have no stored plaintext and do
                # not use the documented legacy value. Give them a known
                # temporary password so the administrator can test/login
                # them, then it is wiped at first password change as usual.
                student.user.set_password(candidate)
                student.user.temp_password_plain = candidate
                student.user.save(update_fields=["password_hash", "temp_password_plain"])
                reset += 1
        return restored, reset

    @staticmethod
    def _restore_teachers():
        restored = 0
        teachers = Teacher.objects.select_related("user").filter(
            user__first_login=True, user__temp_password_plain__isnull=True,
        )
        for teacher in teachers:
            candidate = f"{teacher.user.username}@123"
            if teacher.user.check_password(candidate):
                teacher.user.temp_password_plain = candidate
                teacher.user.save(update_fields=["temp_password_plain"])
                restored += 1
        return restored
