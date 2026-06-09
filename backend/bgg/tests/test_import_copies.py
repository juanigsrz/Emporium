from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.client import CollectionRow
from bgg.models import ImportJob
from bgg.tasks import process_import_job
from catalog.models import BoardGame
from copies.models import Copy

User = get_user_model()


class CopyImportTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.u.profile.bgg_username = "juaniisuar"
        self.u.profile.save()
        BoardGame.objects.create(bgg_id=224517, name="Brass")

    def test_owned_creates_pending_copies_skips_out_of_catalog(self):
        rows = [CollectionRow(224517, "Brass"), CollectionRow(999999, "Unknown")]
        job = ImportJob.objects.create(user=self.u, kind="OWNED")
        # fetch_collection is called twice (OWNED + OWNED_EXPANSIONS) — return rows then empty.
        with patch("bgg.importers.BggClient.fetch_collection", side_effect=[rows, []]):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "DONE")
        self.assertEqual(job.summary["created"], 1)
        self.assertEqual(job.summary["skipped"], 1)
        c = Copy.objects.get(owner=self.u, board_game_id=224517)
        self.assertTrue(c.is_pending)
        self.assertEqual(c.import_source, "BGG_OWNED")

    def test_skip_duplicates(self):
        Copy.objects.create(owner=self.u, board_game_id=224517)
        rows = [CollectionRow(224517, "Brass")]
        job = ImportJob.objects.create(user=self.u, kind="OWNED", options={"skip_duplicates": True})
        with patch("bgg.importers.BggClient.fetch_collection", side_effect=[rows, []]):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.summary["created"], 0)
        self.assertEqual(job.summary["skipped"], 1)

    def test_geeklist_uses_source_ref(self):
        rows = [CollectionRow(224517, "Brass")]
        job = ImportJob.objects.create(user=self.u, kind="GEEKLIST", source_ref="555")
        with patch("bgg.importers.BggClient.fetch_geeklist", return_value=rows) as f:
            process_import_job(job.id)
        f.assert_called_once_with("555")
        self.assertTrue(Copy.objects.filter(owner=self.u, board_game_id=224517).exists())
