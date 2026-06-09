from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.models import ImportJob
from bgg.tasks import process_import_job

User = get_user_model()


class DispatcherTest(TestCase):
    def test_unknown_kind_marks_failed(self):
        u = User.objects.create_user("alice", password="x")
        job = ImportJob.objects.create(user=u, kind="WISHLIST")
        # No importer registered yet for WISHLIST in this isolated test → FAILED.
        from bgg import importers
        importers.IMPORTERS.pop("WISHLIST", None)
        process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("No importer", job.log)
