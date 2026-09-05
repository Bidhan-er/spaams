# SPAAMS Django Backend (v2) — matches YOUR existing 'spaams' database

## Table names now match your schema exactly
Every model has an explicit `db_table` in its `Meta` class, mapped
to match the tables you already created in MySQL Workbench (`admin`,
`faculty`, `student`, `board_marks`, `archived_student`, etc.) —
verified by actually migrating into a fresh `spaams` database and
running `SHOW TABLES` to confirm every name matches, then querying
data back out with plain SQL (not just Django) to prove it's really
there.

**One deliberate exception, as agreed:** Django's built-in login
system (`auth_user`) is kept as-is, NOT renamed to your `user_login`
table. Those two have fundamentally different columns (Django's User
model is deeply tied to its own tested password-hashing and session
code), so forcing them together would mean giving up that security
for a cosmetic rename. `accounts_profile` holds the extra columns
your `user_login` table has that Django's `User` doesn't (`role`,
`first_login`) — it's the one table without a schema.sql equivalent,
for that same reason.

## Setup — connecting to your real MySQL 'spaams' database
1. **Create the database** (if you haven't already):
       CREATE DATABASE spaams;

2. **Set your MySQL credentials** before starting the server. In PowerShell:
       $env:MYSQL_PASSWORD = "your-mysql-password"
       # Optional when you use a non-default account/database:
       $env:MYSQL_USER = "root"
       $env:MYSQL_DATABASE = "spaams"

   This project uses Django 5.2 LTS because it supports MySQL 8.0 (the
   installed server version). Do not upgrade to Django 6 unless MySQL is
   upgraded to 8.4 or newer.

3. **Install and run**:
       pip install -r requirements.txt
       python manage.py runserver

The MySQL schema is already created manually, so do **not** run `migrate`
against this project. The Django models map directly to your existing table
and column names, including `user_login.login_id`, `student.student_id`, and
`attendance_session.attendance_session_id`.

For an optional local demonstration dataset, run `python manage.py
seed_demo_data`. It clears the SPAAMS data tables first, so use it only on an
empty development database—not on real student records.

### Note on the MySQL driver
`mysqlclient` (Django's usual recommendation) needs a C compiler and
MySQL header files to install — this often fails on Windows without
extra setup. This project uses **PyMySQL** instead (pure Python, no
compiler needed) with a tiny compatibility shim in `config/__init__.py`
that makes Django's `django.db.backends.mysql` engine work with it
transparently.

Server runs at http://127.0.0.1:8000/

Demo logins (printed by the seed command too):
    Admin   -> admin01 / Admin@123
    Teacher -> teacher01 / Teacher@123
    Student -> (pick any from the DB — registration_number / registration_number@123)

## What's REAL and CONNECTED right now (not mock)
- **Login, forced password change, logout** (`index.html` -> `js/script.js`
  -> `js/api.js` -> the real API)
- **Admin's Student Dashboard list** (`admin-dashboard.html` -> `admin.js`
  `fetchStudentList()` -> `/api/admin/students/`)

## Live teacher and student workflow
- `GET /api/teacher/me/` returns only the authenticated teacher's assignments.
- `GET/POST /api/teacher/marks/` reads and bulk-updates marks through Django ORM.
- `GET /api/teacher/attendance/` returns the enrolled roster and guardian contacts.
- `POST /api/teacher/attendance/submit/` locks one subject's attendance for the day and returns absent students.
- `POST /api/teacher/attendance/notify-guardians/` records each notification and sends it through Sparrow SMS when configured.
- `GET /api/student/me/` supplies the logged-in student's profile, attendance, board marks, and entered marks.

### Guardian SMS configuration
Set these variables before `runserver` to deliver messages through Sparrow SMS:
    $env:SPARROW_SMS_TOKEN = "your-sparrow-token"
    $env:SPARROW_SMS_FROM = "SPAAMS"

Without the token, the system still creates `sms_history` rows but marks them **Pending**; it never claims that an SMS was delivered when it was not.

### Password reset email configuration
Passwords are stored with Django's secure PBKDF2 hashing; the application never stores plaintext passwords. To send reset OTPs by email, configure SMTP before starting the server:
    $env:EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    $env:EMAIL_HOST = "smtp.example.com"
    $env:EMAIL_HOST_USER = "your-email@example.com"
    $env:EMAIL_HOST_PASSWORD = "your-app-password"
    $env:DEFAULT_FROM_EMAIL = "your-email@example.com"

## Apps (mirrors schema.sql's 7 modules)
    accounts        — auth (admin/teacher/student/guardian/password_reset)
    academics       — faculty/semester/subject/enrollment/teacher_assignment
    assessment      — assessment_type/student_marks/board_marks
    attendance      — attendance_session/attendance/sms_history
    progression     — semester_promotion/archived_student/archive_marks/archive_attendance
    administration  — csv_upload_history + seed_demo_data management command
    analytics       — performance_analytics + pandas/numpy/matplotlib/plotly endpoint

## Endpoints so far
Auth (all roles):
    GET  /api/auth/csrf/
    POST /api/auth/login/
    POST /api/auth/change-password/
    POST /api/auth/logout/

Admin panel:
    GET/POST/PUT/DELETE  /api/admin/students/, /api/admin/teachers/
    GET/POST             /api/admin/faculties/, /api/admin/semesters/, /api/admin/subjects/
    GET                  /api/admin/dashboard-summary/
    GET                  /api/admin/students/<id>/performance/
    GET/POST/PUT/DELETE  /api/admin/teacher-assignments/
    GET/POST/PUT/DELETE  /api/admin/board-marks/
    GET                  /api/admin/attendance/?semester_id=&date=&subject_id=
    POST                 /api/admin/students/import/  (multipart CSV)
    GET                  /api/admin/students/export/?semester_id=&academic_year=

Analytics:
    GET  /api/analytics/class-performance/?subject_id=<id>&academic_year=<year>

Teacher and student:
    GET/POST  /api/teacher/marks/
    GET       /api/teacher/me/
    GET       /api/teacher/attendance/
    POST      /api/teacher/attendance/submit/
    POST      /api/teacher/attendance/notify-guardians/
    GET       /api/student/me/
    POST      /api/auth/forgot-password/
    POST      /api/auth/reset-password/

Progression and archive:
    POST      /api/admin/students/<student_id>/promote/
    POST      /api/admin/students/<student_id>/pass-out/
    GET       /api/admin/archived-students/

### CSV format
Use a header row with:
`registration_number, full_name, gender, date_of_birth, phone, address, guardian_name, guardian_phone, guardian_email, faculty, semester_number, academic_year`.
The import creates the student account with username = registration number, temporary password = `registration_number@123`, and `first_login=True`, so Django forces a password change before dashboard access.


fuck ! leave it all,  dont do anything i dont have time my deadline got over and i got failled in my project because of you only you . fucking chatgpt, gemini is much more better than you claude fucking bastard
