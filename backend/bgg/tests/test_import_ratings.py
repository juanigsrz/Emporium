from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import GameRating
from bgg.client import CollectionRow
from bgg.models import ImportJob
from bgg.tasks import process_import_job
from catalog.models import BoardGame

User = get_user_model()


class RatingsImportTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.u.profile.bgg_username = "juaniisuar"
        self.u.profile.save()
        BoardGame.objects.create(bgg_id=224517, name="Brass")
        # 167791 NOT in catalog → skipped

    def test_imports_ratings_skips_out_of_catalog_and_unrated(self):
        rows = [
            CollectionRow(bgg_id=224517, name="Brass", my_rating=Decimal("8.5")),
            CollectionRow(bgg_id=167791, name="TM", my_rating=Decimal("7")),  # not in catalog
            CollectionRow(bgg_id=224517, name="dup-unrated", my_rating=None),  # but this row has no rating
        ]
        job = ImportJob.objects.create(user=self.u, kind="RATINGS")
        with patch("bgg.importers.BggClient.fetch_collection", return_value=rows):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "DONE")
        self.assertEqual(GameRating.objects.get(user=self.u, board_game_id=224517).value, Decimal("8.5"))
        self.assertEqual(job.summary["matched"], 1)
        # 167791 (not in catalog) + the None-rating row → 2 skipped
        self.assertEqual(job.summary["skipped"], 2)
