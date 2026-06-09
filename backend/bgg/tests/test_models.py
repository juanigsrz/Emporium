from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.models import ImportJob

User = get_user_model()


class ImportJobModelTest(TestCase):
    def test_defaults(self):
        u = User.objects.create_user("alice", password="x")
        job = ImportJob.objects.create(user=u, kind=ImportJob.Kind.WISHLIST)
        self.assertEqual(job.status, ImportJob.Status.PENDING)
        self.assertEqual(job.summary, {})
        self.assertEqual(job.result, {})
        self.assertEqual(job.options, {})
        self.assertEqual(job.user.bgg_imports.count(), 1)
