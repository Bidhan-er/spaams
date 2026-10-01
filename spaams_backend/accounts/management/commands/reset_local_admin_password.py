"""Local recovery command for the SPAAMS built-in Admin account."""

from django.core.management.base import BaseCommand, CommandError

from accounts.bootstrap import DEFAULT_ADMIN_USERNAME, ensure_default_admin
from accounts.models import UserLogin


class Command(BaseCommand):
    help = "Reset the local SPAAMS Admin password without deleting any data."

    def add_arguments(self, parser):
        parser.add_argument("--password", required=True, help="New Admin password.")
        parser.add_argument("--confirm", action="store_true", help="Required safety confirmation.")

    def handle(self, *args, **options):
        if not options["confirm"]:
            raise CommandError("Pass --confirm to reset the local Admin password.")
        password = options["password"]
        if len(password) < 8:
            raise CommandError("Use a password with at least 8 characters.")

        user, _ = ensure_default_admin()
        if user.username != DEFAULT_ADMIN_USERNAME:
            user = UserLogin.objects.filter(username=DEFAULT_ADMIN_USERNAME, role="Admin").first()
        if not user:
            raise CommandError("The built-in Admin account was not found.")

        user.set_password(password)
        user.status = "Active"
        user.first_login = True
        user.temp_password_plain = password
        user.save(update_fields=["password_hash", "status", "first_login", "temp_password_plain"])
        self.stdout.write(self.style.SUCCESS("Local Admin password reset successfully. No student or teacher data was changed."))
