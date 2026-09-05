# SPAAMS Django Backend — Admin Panel (first pass)

## Setup
    pip install -r requirements.txt
    python manage.py migrate
    python manage.py createsuperuser   # optional, for the built-in /admin/ site
    python manage.py runserver

## Endpoints built so far
Auth (used by every role):
    POST /api/auth/login/
    POST /api/auth/change-password/
    POST /api/auth/logout/

Admin panel (Admin role only — enforced server-side):
    GET/POST         /api/admin/students/
    GET/PUT/DELETE    /api/admin/students/<id>/
    GET/POST         /api/admin/teachers/
    GET/PUT/DELETE    /api/admin/teachers/<id>/
    GET/POST         /api/admin/faculties/
    GET/POST         /api/admin/semesters/
    GET/POST         /api/admin/subjects/
    GET              /api/admin/dashboard-summary/

Django's own built-in admin site (for you to inspect the DB while
developing): http://127.0.0.1:8000/admin/

## Not built yet (next steps)
- Teacher panel endpoints (attendance, marks entry)
- Student panel endpoints (read-only own data)
- Semester promotion / archive-on-passout
- CSV bulk import
- SMS notification trigger
