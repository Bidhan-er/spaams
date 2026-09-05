"""
academics/views.py

  GET/POST         /api/admin/faculties/
  GET/POST         /api/admin/semesters/
  GET/POST         /api/admin/subjects/
  GET              /api/admin/dashboard-summary/   -> counts for the
                     Admin dashboard's top cards (total students,
                     teachers, subjects, semesters)
"""

from accounts.views import IsAdminRole
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Student, Teacher
from .analytics import compute_student_performance
from .models import Faculty, Semester, Subject, TeacherAssignment
from .serializers import FacultySerializer, SemesterSerializer, SubjectSerializer, TeacherAssignmentSerializer


class FacultyViewSet(viewsets.ModelViewSet):
    queryset = Faculty.objects.all()
    serializer_class = FacultySerializer
    permission_classes = [IsAdminRole]


class SemesterViewSet(viewsets.ModelViewSet):
    queryset = Semester.objects.all()
    serializer_class = SemesterSerializer
    permission_classes = [IsAdminRole]


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.select_related("semester").all()
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminRole]


class TeacherAssignmentViewSet(viewsets.ModelViewSet):
    """Only admins can define which semester/subject a teacher can access."""
    queryset = TeacherAssignment.objects.select_related("teacher", "subject", "semester").all()
    serializer_class = TeacherAssignmentSerializer
    permission_classes = [IsAdminRole]


class DashboardSummaryView(APIView):
    """
    Feeds the small stat cards at the top of the Admin dashboard,
    e.g. "Total Students: 320", "Total Teachers: 18".
    """

    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response(
            {
                "total_students": Student.objects.count(),
                "total_teachers": Teacher.objects.count(),
                "total_subjects": Subject.objects.count(),
                "total_semesters": Semester.objects.count(),
            }
        )


class StudentPerformanceView(APIView):
    """
    GET /api/admin/students/<id>/performance/

    Powers the Academic Details tab on the Student Detail screen:
    returns the percentage breakdown AND a ready-to-render pie
    chart image (base64 PNG), computed with pandas/numpy/matplotlib.
    """

    permission_classes = [IsAdminRole]

    def get(self, request, student_id):
        # Confirms the student exists; 404s naturally if not.
        Student.objects.get(pk=student_id)
        data = compute_student_performance(student_id)
        return Response(data)
