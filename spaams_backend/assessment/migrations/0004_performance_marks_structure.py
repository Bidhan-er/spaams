from django.db import migrations


class Migration(migrations.Migration):
    """Support decimal flexible allocations and explicit missing-mark states."""

    dependencies = [("assessment", "0003_student_marks_teacher_optional")]

    operations = [
        migrations.RunSQL(
            sql=(
                "ALTER TABLE assessment_type MODIFY COLUMN maximum_marks DECIMAL(6,2) NOT NULL; "
                "ALTER TABLE student_marks MODIFY COLUMN marks_obtained DECIMAL(6,2) NULL; "
                "ALTER TABLE student_marks ADD COLUMN mark_status VARCHAR(20) NOT NULL DEFAULT 'Entered'"
            ),
            reverse_sql=(
                "ALTER TABLE student_marks DROP COLUMN mark_status; "
                "ALTER TABLE student_marks MODIFY COLUMN marks_obtained DECIMAL(6,2) NOT NULL; "
                "ALTER TABLE assessment_type MODIFY COLUMN maximum_marks INT NOT NULL"
            ),
        )
    ]
