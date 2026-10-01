"""Small, safe bootstrap helpers for an empty SPAAMS database."""

import os

from .models import Admin, UserLogin


DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = os.environ.get("SPAAMS_DEFAULT_ADMIN_PASSWORD", "mewmew56#@")


def ensure_default_admin():
    """Create the recovery Admin only when no Admin account exists.

    This never changes or replaces an existing administrator. Once the Admin
    changes the initial password, only the new password works until a complete
    data reset creates a fresh database again.
    """
    existing = UserLogin.objects.filter(role="Admin").first()
    if existing:
        return existing, False

    # Do not promote a left-over non-admin account named ``admin``.
    UserLogin.objects.filter(username=DEFAULT_ADMIN_USERNAME).delete()
    user = UserLogin(
        username=DEFAULT_ADMIN_USERNAME,
        role="Admin",
        status="Active",
        first_login=True,
        temp_password_plain=DEFAULT_ADMIN_PASSWORD,
    )
    user.set_password(DEFAULT_ADMIN_PASSWORD)
    user.save()
    Admin.objects.create(
        user=user,
        full_name="System Administrator",
        email=None,
        phone="9842612731",
    )
    return user, True
