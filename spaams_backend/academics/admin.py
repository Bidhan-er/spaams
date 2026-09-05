from django.contrib import admin

from .models import Faculty, Guardian, Semester, StudentEnrollment, Subject, TeacherAssignment

admin.site.register(Faculty)
admin.site.register(Semester)
admin.site.register(Subject)
admin.site.register(Guardian)
admin.site.register(StudentEnrollment)
admin.site.register(TeacherAssignment)
