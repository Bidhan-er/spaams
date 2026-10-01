from django.db import migrations


class Migration(migrations.Migration):
    """Add the short-lived admin-only temporary password field.

    user_login is a manually created legacy table (the model is managed=False),
    so this explicit SQL migration changes the real MySQL table.
    """

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE user_login ADD COLUMN temp_password_plain VARCHAR(255) NULL",
            reverse_sql="ALTER TABLE user_login DROP COLUMN temp_password_plain",
        ),
    ]
