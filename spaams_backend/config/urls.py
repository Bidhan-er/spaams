"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from django.http import JsonResponse

admin.site.site_header = "SPAAMS Admin"
admin.site.site_title = "SPAAMS Admin Portal"
admin.site.index_title = "Welcome to SPAAMS superuser Portal"


def home(request):
    return JsonResponse({
        "name": "SPAAMS API",
        "status": "running",
        "message": "Backend is running. Open the frontend with a local web server, then log in.",
        "routes": {"admin": "/admin/", "csrf": "/api/auth/csrf/", "login": "/api/auth/login/"},
    })


urlpatterns = [
    path('', home, name='home'),
    # Django's own built-in admin site (handy for you to poke at the
    # database directly while developing — not the same as our custom
    # Admin Panel API below).
    path('admin/', admin.site.urls),

    # Our custom API, used by the React/HTML+JS frontend.
    # e.g. /api/auth/login/, /api/admin/students/, /api/admin/subjects/
    path('api/', include('accounts.urls')),
    path('api/', include('academics.urls')),
    path('api/', include('analytics.urls')),
    path('api/', include('assessment.urls')),
    path('api/', include('attendance.urls')),
    path('api/', include('administration.urls')),
    path('api/', include('progression.urls')),
]
