from django.db import migrations


class Migration(migrations.Migration):
    """Extend the manually created MySQL assessment_type table."""

    dependencies = [("assessment", "0001_initial")]

    operations = [
        migrations.RunSQL(
            sql=("ALTER TABLE assessment_type "
                 "ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'Other', "
                 "ADD COLUMN pass_marks DECIMAL(6,2) NOT NULL DEFAULT 0"),
            reverse_sql="ALTER TABLE assessment_type DROP COLUMN category, DROP COLUMN pass_marks",
        ),
    ]
