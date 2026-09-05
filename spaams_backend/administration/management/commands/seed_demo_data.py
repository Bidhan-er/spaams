"""
administration/management/commands/seed_demo_data.py

Seeds the database with realistic Tribhuvan University BCA demo
data — same spirit as the earlier seed_data.sql, but built through
the Django ORM this time, so it's the SAME database the API
actually serves (not a separate raw-SQL database the app can't see).

Run:  python manage.py seed_demo_data
"""

import random

from django.core.management.base import BaseCommand
from django.db import transaction

from academics.models import Faculty, Guardian, Semester, StudentEnrollment, Subject, TeacherAssignment
from accounts.models import Admin, Student, Teacher, UserLogin
from assessment.models import AssessmentType, StudentMarks, BoardMarks
from attendance.models import Attendance, AttendanceSession, SmsHistory


TU_BCA_SUBJECTS = {
    1: [("CACS101", "Introduction to Information Technology"), ("CACS102", "English I"),
        ("CACS103", "Computer Programming (C Language)"), ("CACS104", "Mathematics I"),
        ("CACS105", "Society and Technology")],
    2: [("CACS151", "Digital Logic"), ("CACS152", "English II"),
        ("CACS153", "C++ Programming"), ("CACS154", "Financial Accounting"),
        ("CACS155", "Mathematics II")],
    3: [("CACS201", "Data Structures and Algorithms"), ("CACS202", "Object Oriented Programming using Java"),
        ("CACS203", "Microprocessor and Computer Architecture"), ("CACS204", "Statistics I"),
        ("CACS205", "Software Engineering")],
    4: [("CACS251", "Database Management System"), ("CACS252", "System Analysis and Design"),
        ("CACS253", "Applied Economics"), ("CACS254", "Statistics II"),
        ("CACS255", "Web Technology")],
    5: [("CACS301", "Operating System"), ("CACS302", "Numerical Method"),
        ("CACS303", "Computer Networking"), ("CACS304", "E-Governance"),
        ("CACS305", "Project Management")],
    6: [("CACS351", "Distributed System"), ("CACS352", "Advanced Java Programming"),
        ("CACS353", "Management Information System"), ("CACS354", "Cyber Law and Professional Ethics"),
        ("CACS355", "Cloud Computing")],
    7: [("CACS401", "Artificial Intelligence"), ("CACS402", "Advanced Database System"),
        ("CACS403", "Internship"), ("CACS404", "Knowledge Engineering")],
    8: [("CACS451", "Mobile Programming"), ("CACS452", "Scripting Language (Python)"),
        ("CACS453", "E-Commerce"), ("CACS454", "Project (Thesis)")],
}

MALE_FIRST = ["Bidhan","Sujal","Aayush","Prabin","Bikash","Rajesh","Nabin","Suman","Rohit","Krishna",
              "Hari","Ram","Anish","Sagar","Nischal","Prakash","Dipesh","Sandip","Manoj","Bishal"]
FEMALE_FIRST = ["Simran","Sanaya","Nisha","Kusma","Sushmita","Anisha","Sunita","Sabina","Puja","Kritika",
                "Manisha","Alisha","Sita","Gita","Devi","Sarita","Rina","Sabnam","Pratima","Sunayana"]
SURNAMES = ["Shrestha","Gautam","Tamang","Rana","Chaulagain","Shah","Karki","Thapa","Rai","Lama",
            "Gurung","Magar","Adhikari","Poudel","Basnet","Ghimire","Khadka","Bhattarai","Neupane","Dahal"]

BATCH_BY_SEMESTER = {1: 2025, 2: 2024, 3: 2024, 4: 2023, 5: 2023, 6: 2022, 7: 2022, 8: 2021}


class Command(BaseCommand):
    help = "Seeds realistic Tribhuvan University BCA demo data (students, teachers, subjects, marks)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--students-per-semester", type=int, default=30,
            help="How many demo students to create per semester (default 30; 240 students across eight semesters).",
        )
        parser.add_argument(
            "--include-marks", action="store_true",
            help="Create generated marks too. Disabled by default so teachers/admin enter real marks.",
        )

    def handle(self, *args, **options):
        n_per_sem = options["students_per_semester"]
        random.seed(42)
        used_names = set()

        def make_name(gender):
            pool = MALE_FIRST if gender == "Male" else FEMALE_FIRST
            for _ in range(200):
                name = f"{random.choice(pool)} {random.choice(SURNAMES)}"
                if name not in used_names:
                    used_names.add(name)
                    return name
            return f"{random.choice(pool)} {random.choice(SURNAMES)} {random.randint(2,99)}"

        with transaction.atomic():
            self.stdout.write("Clearing any existing demo data...")
            # Attendance is linked to students through protected foreign keys,
            # so remove dependent demo records before replacing the roster.
            SmsHistory.objects.all().delete()
            Attendance.objects.all().delete()
            AttendanceSession.objects.all().delete()
            StudentMarks.objects.all().delete()
            BoardMarks.objects.all().delete()
            TeacherAssignment.objects.all().delete()
            StudentEnrollment.objects.all().delete()
            Student.objects.all().delete()
            Teacher.objects.all().delete()
            Admin.objects.all().delete()
            Guardian.objects.all().delete()
            Subject.objects.all().delete()
            Semester.objects.all().delete()
            Faculty.objects.all().delete()
            UserLogin.objects.all().delete()

            # ---- Faculty, Semesters, Subjects ----
            faculty = Faculty.objects.create(faculty_name="BCA", university_name="Tribhuvan University")
            semesters = {}
            for i in range(1, 9):
                semesters[i] = Semester.objects.create(semester_name=f"{['I','II','III','IV','V','VI','VII','VIII'][i-1]} Semester", semester_number=i)

            subjects_by_sem = {}
            for sem_num, subs in TU_BCA_SUBJECTS.items():
                subjects_by_sem[sem_num] = []
                for code, name in subs:
                    subj = Subject.objects.create(semester=semesters[sem_num], subject_code=code, subject_name=name, credit_hour=3)
                    subjects_by_sem[sem_num].append(subj)
            self.stdout.write(self.style.SUCCESS(f"Created {sum(len(v) for v in subjects_by_sem.values())} subjects across 8 semesters."))

            # ---- Admin ----
            admin_user = UserLogin(username="admin01", role="Admin", first_login=False, status="Active")
            admin_user.set_password("Admin@123")
            admin_user.save()
            admin = Admin.objects.create(user=admin_user, full_name="Rajendra Shrestha", email="admin01@spaams.edu.np", phone="9800000001")

            # ---- Assessment types ----
            assessment_defs = [
                ("Unit Test", 20), ("Assignment", 10), ("Preboard", 40),
                ("Lab", 20), ("Grooming", 10), ("Overall Activities", 10),
            ]
            assessments = [AssessmentType.objects.get_or_create(assessment_name=n, defaults={"maximum_marks": m})[0] for n, m in assessment_defs]

            # ---- Teachers (8, rotating across subjects) ----
            teacher_people = [
                ("Ram Bahadur Sharma", "M.Sc. Computer Science"), ("Sita Koirala", "M.Sc. IT"),
                ("Krishna Prasad Dahal", "MCA"), ("Devi Maya Tamang", "M.Sc. Computer Science"),
                ("Suresh Adhikari", "M.Sc. Mathematics"), ("Gita Poudel", "MBA (IT)"),
                ("Bishnu Prasad Rijal", "M.Sc. Computer Engineering"), ("Kamala Devi Bastola", "M.Sc. IT"),
            ]
            teachers = []
            for i, (name, qual) in enumerate(teacher_people, start=1):
                used_names.add(name)
                u = UserLogin(username=f"teacher{i:02d}", role="Teacher", first_login=False, status="Active")
                u.set_password("Teacher@123")
                u.save()
                t = Teacher.objects.create(user=u, teacher_name=name, email=f"teacher{i:02d}@spaams.edu.np", phone=f"98{random.randint(10000000,99999999)}", qualification=qual)
                teachers.append(t)

            # ---- Teacher assignments ----
            assignment_count = 0
            for sem_num, subs in subjects_by_sem.items():
                year = BATCH_BY_SEMESTER[sem_num]
                for idx, subj in enumerate(subs):
                    teacher = teachers[subj.id % len(teachers)]
                    TeacherAssignment.objects.create(teacher=teacher, subject=subj, semester=semesters[sem_num], academic_year=year)
                    assignment_count += 1
            self.stdout.write(self.style.SUCCESS(f"Created {len(teachers)} teachers, {assignment_count} assignments."))

            # ---- Students, Guardians, Enrollment, Marks ----
            student_count = 0
            marks_count = 0
            board_marks_count = 0
            for sem_num in range(1, 9):
                year = BATCH_BY_SEMESTER[sem_num]
                for n in range(n_per_sem):
                    gender = random.choice(["Male", "Female"])
                    name = make_name(gender)
                    # Sample guardians use the student's family surname so
                    # the demo records look consistent in the student portal.
                    guardian_first = random.choice(MALE_FIRST + FEMALE_FIRST)
                    g_name = f"{guardian_first} {name.rsplit(' ', 1)[-1]}"
                    guardian = Guardian.objects.create(
                        guardian_name=g_name, phone=f"98{random.randint(10000000,99999999)}",
                        relationship=random.choice(["Father", "Mother", "Guardian"]),
                    )
                    reg_no = f"TU-BCA-{year}-{student_count+1:03d}"
                    u = UserLogin(username=reg_no, role="Student", first_login=random.random() < 0.3, status="Active")
                    u.set_password(f"{reg_no}@123")
                    u.save()
                    student = Student.objects.create(
                        user=u, guardian=guardian, registration_number=reg_no,
                        symbol_number=f"{year}-{sem_num:02d}-{student_count+1:03d}",
                        full_name=name, gender=gender,
                        date_of_birth=f"{2024-sem_num-random.randint(18,20)}-0{random.randint(1,9)}-{random.randint(10,28)}",
                        phone=f"98{random.randint(10000000,99999999)}", email=f"{reg_no.lower()}@spaams.edu.np", address="Kathmandu, Nepal",
                    )
                    StudentEnrollment.objects.create(student=student, faculty=faculty, semester=semesters[sem_num], academic_year=year)
                    student_count += 1

                    # Marks are deliberately blank by default. They must be entered
                    # by the assigned teacher or admin through SPAAMS.
                    if options["include_marks"] and sem_num >= 3:
                        for subj in subjects_by_sem[sem_num]:
                            teacher = teachers[subj.id % len(teachers)]
                            for a in assessments:
                                StudentMarks.objects.create(
                                    student=student, teacher=teacher, subject=subj, assessment=a,
                                    academic_year=year, marks_obtained=round(a.maximum_marks * random.uniform(0.55, 0.95), 1),
                                )
                                marks_count += 1
                            if sem_num <= 7:  # completed terms only
                                BoardMarks.objects.create(
                                    student=student, subject=subj, admin=admin, academic_year=year,
                                    marks_obtained=round(100 * random.uniform(0.55, 0.92), 1), maximum_marks=100,
                                )
                                board_marks_count += 1

            self.stdout.write(self.style.SUCCESS(
                f"Created {student_count} students, {marks_count} marks rows, {board_marks_count} board marks rows."
            ))
            self.stdout.write(self.style.SUCCESS("\nDemo login: admin01 / Admin@123"))
            self.stdout.write(self.style.SUCCESS("Demo login: teacher01 / Teacher@123"))
