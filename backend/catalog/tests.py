"""
catalog/tests.py

F2 Catalog tests:
    1. Small CSV import (limit=200) — count, data integrity
    2. Idempotent re-import — no duplicates
    3. Search returns expected game
    4. is_expansion filter
    5. Ordering (rank, -users_rated)
    6. Pagination shape (count/next/previous/results)
    7. Detail endpoint (all fields present, copies_count)
    8. Copies stub endpoint (empty paginated list, 404 on missing game)
    9. manage.py check passes (implicitly tested by setUp running migrations)
"""

import csv
import os
import tempfile

from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv

GAMES_URL = "/api/games/"


def game_url(bgg_id):
    return f"/api/games/{bgg_id}/"


def copies_url(bgg_id):
    return f"/api/games/{bgg_id}/copies/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_csv(rows, tmp_dir=None):
    """
    Write a temporary CSV file in the boardgames_ranks.csv format.

    rows: list of dicts with keys matching the CSV header.
    Returns the file path.
    """
    header = [
        "id", "name", "yearpublished", "rank", "bayesaverage", "average",
        "usersrated", "is_expansion",
        "abstracts_rank", "cgs_rank", "childrensgames_rank", "familygames_rank",
        "partygames_rank", "strategygames_rank", "thematic_rank", "wargames_rank",
    ]
    fd, path = tempfile.mkstemp(suffix=".csv", dir=tmp_dir)
    with os.fdopen(fd, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        for row in rows:
            full = {k: "" for k in header}
            full.update(row)
            writer.writerow(full)
    return path


SAMPLE_ROWS = [
    {
        "id": "224517",
        "name": "Brass: Birmingham",
        "yearpublished": "2018",
        "rank": "1",
        "bayesaverage": "8.39364",
        "average": "8.56425",
        "usersrated": "58687",
        "is_expansion": "0",
        "strategygames_rank": "1",
    },
    {
        "id": "342942",
        "name": "Ark Nova",
        "yearpublished": "2021",
        "rank": "2",
        "bayesaverage": "8.35401",
        "average": "8.54028",
        "usersrated": "61304",
        "is_expansion": "0",
        "strategygames_rank": "2",
    },
    {
        "id": "161936",
        "name": "Pandemic Legacy: Season 1",
        "yearpublished": "2015",
        "rank": "3",
        "bayesaverage": "8.27598",
        "average": "8.47255",
        "usersrated": "60948",
        "is_expansion": "0",
    },
    {
        "id": "99999",
        "name": "Some Expansion",
        "yearpublished": "2020",
        "rank": "",
        "bayesaverage": "",
        "average": "6.5",
        "usersrated": "500",
        "is_expansion": "1",
    },
]


# ---------------------------------------------------------------------------
# Import / model tests
# ---------------------------------------------------------------------------

class ImportTaskTests(TestCase):
    """Tests for the import_boardgames_csv Celery task."""

    def setUp(self):
        self.csv_path = _make_csv(SAMPLE_ROWS)

    def tearDown(self):
        try:
            os.unlink(self.csv_path)
        except OSError:
            pass

    def test_import_creates_rows(self):
        result = import_boardgames_csv(path=self.csv_path)
        self.assertEqual(result["imported"], len(SAMPLE_ROWS))
        self.assertEqual(BoardGame.objects.count(), len(SAMPLE_ROWS))

    def test_import_data_integrity(self):
        import_boardgames_csv(path=self.csv_path)
        brass = BoardGame.objects.get(bgg_id=224517)
        self.assertEqual(brass.name, "Brass: Birmingham")
        self.assertEqual(brass.year_published, 2018)
        self.assertEqual(brass.rank, 1)
        self.assertAlmostEqual(brass.average, 8.56425, places=3)
        self.assertEqual(brass.users_rated, 58687)
        self.assertFalse(brass.is_expansion)
        self.assertEqual(brass.category_ranks.get("strategy"), 1)

    def test_import_handles_null_rank(self):
        """Rows with blank rank should get rank=None."""
        import_boardgames_csv(path=self.csv_path)
        expansion = BoardGame.objects.get(bgg_id=99999)
        self.assertIsNone(expansion.rank)
        self.assertTrue(expansion.is_expansion)

    def test_import_idempotent(self):
        """Running import twice should not create duplicates."""
        import_boardgames_csv(path=self.csv_path)
        count_after_first = BoardGame.objects.count()
        import_boardgames_csv(path=self.csv_path)
        count_after_second = BoardGame.objects.count()
        self.assertEqual(count_after_first, count_after_second)

    def test_import_with_limit(self):
        """limit=2 should only import 2 rows."""
        result = import_boardgames_csv(path=self.csv_path, limit=2)
        self.assertEqual(result["imported"], 2)
        self.assertEqual(BoardGame.objects.count(), 2)

    def test_reimport_updates_existing(self):
        """Re-importing with updated data should update the row, not duplicate."""
        import_boardgames_csv(path=self.csv_path)

        # Create a CSV with a changed name for bgg_id=224517
        updated_rows = [r.copy() for r in SAMPLE_ROWS]
        updated_rows[0]["name"] = "Brass: Birmingham (Updated)"
        updated_path = _make_csv(updated_rows)
        try:
            import_boardgames_csv(path=updated_path)
            brass = BoardGame.objects.get(bgg_id=224517)
            self.assertEqual(brass.name, "Brass: Birmingham (Updated)")
            self.assertEqual(BoardGame.objects.count(), len(SAMPLE_ROWS))
        finally:
            os.unlink(updated_path)


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------

class GameListAPITests(APITestCase):
    """Tests for GET /api/games/."""

    @classmethod
    def setUpTestData(cls):
        cls.csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=cls.csv_path)

    def setUp(self):
        # Clear in-memory cache so copies_count is not contaminated by other tests.
        cache.clear()

    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(cls.csv_path)
        except OSError:
            pass
        super().tearDownClass()

    def test_list_returns_200(self):
        resp = self.client.get(GAMES_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_pagination_shape(self):
        resp = self.client.get(GAMES_URL)
        self.assertIn("count", resp.data)
        self.assertIn("results", resp.data)
        self.assertIn("next", resp.data)
        self.assertIn("previous", resp.data)
        self.assertEqual(resp.data["count"], len(SAMPLE_ROWS))

    def test_list_fields_present(self):
        resp = self.client.get(GAMES_URL)
        item = resp.data["results"][0]
        for field in ["bgg_id", "name", "year_published", "rank", "average",
                      "users_rated", "is_expansion", "image_url", "copies_count"]:
            self.assertIn(field, item, f"Missing field: {field}")

    def test_search_returns_brass_birmingham(self):
        resp = self.client.get(GAMES_URL, {"search": "Brass"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [r["name"] for r in resp.data["results"]]
        self.assertIn("Brass: Birmingham", names)

    def test_search_no_results(self):
        resp = self.client.get(GAMES_URL, {"search": "ZZZnotexist"})
        self.assertEqual(resp.data["count"], 0)
        self.assertEqual(resp.data["results"], [])

    def test_is_expansion_filter_false(self):
        resp = self.client.get(GAMES_URL, {"is_expansion": "false"})
        for item in resp.data["results"]:
            self.assertFalse(item["is_expansion"])

    def test_is_expansion_filter_true(self):
        resp = self.client.get(GAMES_URL, {"is_expansion": "true"})
        for item in resp.data["results"]:
            self.assertTrue(item["is_expansion"])

    def test_ordering_by_rank(self):
        resp = self.client.get(GAMES_URL, {"ordering": "rank"})
        ranks = [r["rank"] for r in resp.data["results"] if r["rank"] is not None]
        self.assertEqual(ranks, sorted(ranks))

    def test_ordering_by_minus_users_rated(self):
        resp = self.client.get(GAMES_URL, {"ordering": "-users_rated"})
        counts = [r["users_rated"] for r in resp.data["results"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_default_ordering_rank_nulls_last(self):
        """Default ordering: ranked games first, then nulls (rank=None) last."""
        resp = self.client.get(GAMES_URL)
        results = resp.data["results"]
        # Find first null-rank item
        null_index = next(
            (i for i, r in enumerate(results) if r["rank"] is None),
            None,
        )
        if null_index is not None:
            # All items before null_index should have non-null rank
            for item in results[:null_index]:
                self.assertIsNotNone(item["rank"])

    def test_copies_count_present_and_zero(self):
        resp = self.client.get(GAMES_URL)
        for item in resp.data["results"]:
            self.assertIn("copies_count", item)
            self.assertEqual(item["copies_count"], 0)


class GameDetailAPITests(APITestCase):
    """Tests for GET /api/games/{bgg_id}/."""

    @classmethod
    def setUpTestData(cls):
        cls.csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=cls.csv_path)

    def setUp(self):
        # Clear in-memory cache so copies_count is not contaminated by other tests.
        cache.clear()

    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(cls.csv_path)
        except OSError:
            pass
        super().tearDownClass()

    def test_detail_returns_200(self):
        resp = self.client.get(game_url(224517))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_detail_fields(self):
        resp = self.client.get(game_url(224517))
        data = resp.data
        for field in [
            "bgg_id", "name", "year_published", "rank", "bayes_average",
            "average", "users_rated", "is_expansion", "category_ranks",
            "image_url", "copies_count",
            # deferred placeholders
            "designers", "publishers", "mechanics", "categories",
            "min_players", "max_players", "min_playtime", "max_playtime",
            "metadata",
        ]:
            self.assertIn(field, data, f"Missing field: {field}")

    def test_detail_deferred_fields_are_empty(self):
        resp = self.client.get(game_url(224517))
        data = resp.data
        self.assertEqual(data["designers"], [])
        self.assertEqual(data["publishers"], [])
        self.assertEqual(data["mechanics"], [])
        self.assertEqual(data["categories"], [])
        self.assertIsNone(data["min_players"])
        self.assertIsNone(data["max_players"])

    def test_detail_copies_count_zero(self):
        resp = self.client.get(game_url(224517))
        self.assertEqual(resp.data["copies_count"], 0)

    def test_detail_not_found(self):
        resp = self.client.get(game_url(9999999))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_detail_category_ranks(self):
        resp = self.client.get(game_url(224517))
        self.assertIn("strategy", resp.data["category_ranks"])
        self.assertEqual(resp.data["category_ranks"]["strategy"], 1)


class GameCopiesAPITests(APITestCase):
    """Tests for GET /api/games/{bgg_id}/copies/."""

    @classmethod
    def setUpTestData(cls):
        cls.csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=cls.csv_path)

    def setUp(self):
        # Clear in-memory cache between tests.
        cache.clear()

    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(cls.csv_path)
        except OSError:
            pass
        super().tearDownClass()

    def test_copies_returns_empty_paginated(self):
        resp = self.client.get(copies_url(224517))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 0)
        self.assertEqual(resp.data["results"], [])
        self.assertIn("next", resp.data)
        self.assertIn("previous", resp.data)

    def test_copies_accepts_filter_params(self):
        """?condition=&language=&event= must not cause an error."""
        resp = self.client.get(
            copies_url(224517),
            {"condition": "LIKE_NEW", "language": "English", "event": "1"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_copies_404_on_missing_game(self):
        resp = self.client.get(copies_url(9999999))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
