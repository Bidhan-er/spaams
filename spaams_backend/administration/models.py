"""administration/models.py — maps onto: csv_upload_history"""

from django.db import models


class CsvUploadHistory(models.Model):
    id = models.AutoField(primary_key=True, db_column="upload_id")
    uploaded_by = models.ForeignKey("accounts.Admin", on_delete=models.PROTECT, db_column="uploaded_by")
    file_name = models.CharField(max_length=255)
    upload_date = models.DateTimeField(auto_now_add=True)
    total_records = models.PositiveIntegerField(default=0)
    success_records = models.PositiveIntegerField(default=0)
    failed_records = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "csv_upload_history"
        managed = False

    def __str__(self):
        return f"{self.file_name} ({self.success_records}/{self.total_records})"
