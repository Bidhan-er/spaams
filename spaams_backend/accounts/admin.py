"""
accounts/admin.py
Registers our models with Django's built-in /admin/ site so you
can view and edit the database directly in a browser while
developing — separate from our own custom Admin Panel API.
"""

from django.contrib import admin

from .models import Admin, Student, Teacher, UserLogin

admin.site.register(UserLogin)
admin.site.register(Admin)
admin.site.register(Teacher)
admin.site.register(Student)
