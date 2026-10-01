from django.db import migrations


class Migration(migrations.Migration):
    """Allow an administrator to enter marks before a teacher is assigned."""
    dependencies = [("assessment", "0002_assessment_category_and_pass_marks")]
    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE student_marks MODIFY COLUMN teacher_id INT NULL",
            reverse_sql="ALTER TABLE student_marks MODIFY COLUMN teacher_id INT NOT NULL",
        ),
    ]
