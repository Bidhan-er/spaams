from rest_framework.authentication import BaseAuthentication

from .models import UserLogin


class LegacySessionAuthentication(BaseAuthentication):
    """Session authentication for the existing user_login schema."""
    def authenticate(self, request):
        login_id = request.session.get("spaams_login_id")
        if not login_id:
            return None
        user = UserLogin.objects.filter(pk=login_id, status="Active").first()
        return (user, None) if user else None
