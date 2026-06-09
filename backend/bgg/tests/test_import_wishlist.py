from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Wishlist
from bgg.client import CollectionRow
from bgg.models import ImportJob
from bgg.tasks import process_import_job
from catalog.models import BoardGame

User = get_user_model()


class WishlistImportTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.u.profile.bgg_username = "juaniisuar"
        self.u.profile.save()
        BoardGame.objects.create(bgg_id=224517, name="Brass: Birmingham")
        # 167791 deliberately NOT in catalog → must be skipped

    def test_imports_in_catalog_skips_rest(self):
        rows = [
            CollectionRow(bgg_id=224517, name="Brass: Birmingham", wishlist_comment="deluxe"),
            CollectionRow(bgg_id=167791, name="Terraforming Mars"),
        ]
        job = ImportJob.objects.create(user=self.u, kind="WISHLIST")
        with patch("bgg.importers.BggClient.fetch_collection", return_value=rows):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "DONE")
        self.assertEqual(job.summary["matched"], 1)
        self.assertEqual(job.summary["skipped"], 1)
        self.assertTrue(Wishlist.objects.filter(user=self.u, board_game_bgg_id=224517).exists())
        w = Wishlist.objects.get(user=self.u, board_game_bgg_id=224517)
        self.assertEqual(w.note, "deluxe")
