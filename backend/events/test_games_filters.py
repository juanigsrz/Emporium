"""
events/test_games_filters.py

Tests for F1: wishlisted / min_rating / is_expansion filters on the
event-scoped game catalog: GET /api/events/{slug}/games/
"""

import csv
import os
import tempfile

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import GameRating, Wishlist
from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()

SAMPLE_ROWS = [
    {
        "id": "224517",
        "name": "Brass: Birmingham",
        "yearpublished": "2018",
        "rank": "1",
        "bayesaverage": "8.39",
        "average": "8.6",
        "usersrated": "58000",
        "is_expansion": "0",
    },
    {
        "id": "13",
        "name": "Catan",
        "yearpublished": "1995",
        "rank": "500",
        "bayesaverage": "6.9",
        "average": "7.2",
        "usersrated": "100000",
        "is_expansion": "0",
    },
]


def _make_csv(rows):
    header = [
        "id", "name", "yearpublished", "rank", "bayesaverage", "average",
        "usersrated", "is_expansion",
        "abstracts_rank", "cgs_rank", "childrensgames_rank", "familygames_rank",
        "partygames_rank", "strategygames_rank", "thematic_rank", "wargames_rank",
    ]
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        for row in rows:
            full = {k: "" for k in header}
            full.update(row)
            writer.writerow(full)
    return path


class GamesFiltersTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=csv_path)
        os.unlink(csv_path)

        cls.user = User.objects.create_user(
            username="filteruser", password="pass1234", email="filteruser@example.com"
        )
        cls.owner = User.objects.create_user(
            username="copyowner", password="pass1234", email="copyowner@example.com"
        )

        cls.game_a = BoardGame.objects.get(bgg_id=224517)  # average 8.6
        cls.game_b = BoardGame.objects.get(bgg_id=13)      # average 7.2

        # Complexity lives in metadata.average_weight (BGG weight). Seed distinct
        # values so the min_weight/max_weight filters can be exercised.
        cls.game_a.metadata = {**(cls.game_a.metadata or {}), "average_weight": 4.0}
        cls.game_a.save(update_fields=["metadata"])
        cls.game_b.metadata = {**(cls.game_b.metadata or {}), "average_weight": 2.0}
        cls.game_b.save(update_fields=["metadata"])

        cls.copy_a = Copy.objects.create(owner=cls.owner, board_game=cls.game_a)
        cls.copy_b = Copy.objects.create(owner=cls.owner, board_game=cls.game_b)

        cls.event = TradeEvent.objects.create(
            name="Filter Test Event 2026", organizer=cls.owner
        )
        cls.slug = cls.event.slug

        EventListing.objects.create(event=cls.event, copy=cls.copy_a)
        EventListing.objects.create(event=cls.event, copy=cls.copy_b)

        # Personal ratings for filteruser: game_a rated high, game_b rated low.
        # This seeds the personal-rating filter; BGG averages are irrelevant.
        GameRating.objects.create(user=cls.user, board_game=cls.game_a, value=9)
        GameRating.objects.create(user=cls.user, board_game=cls.game_b, value=6)

    def setUp(self):
        self.client.force_authenticate(user=self.user)
        # Fresh wishlist each test: add game A only
        Wishlist.objects.filter(user=self.user).delete()
        Wishlist.objects.create(user=self.user, board_game_bgg_id=224517)

    def test_wishlisted_filter_returns_only_wishlisted_games(self):
        r = self.client.get(f"/api/events/{self.slug}/games/?wishlisted=true")
        self.assertEqual(r.status_code, 200)
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {224517})

    def test_min_rating_filter_excludes_below_threshold(self):
        # min_rating filters by the user's personal GameRating, not BGG average.
        # filteruser rated game_a=9, game_b=6; threshold 8 → only game_a qualifies.
        r2 = self.client.get(f"/api/events/{self.slug}/games/?min_rating=8")
        self.assertEqual(r2.status_code, 200)
        self.assertIn(224517, {g["bgg_id"] for g in r2.data["results"]})
        self.assertNotIn(13, {g["bgg_id"] for g in r2.data["results"]})

    def test_average_field_present_in_response(self):
        r = self.client.get(f"/api/events/{self.slug}/games/")
        self.assertEqual(r.status_code, 200)
        for game in r.data["results"]:
            self.assertIn("average", game)

    def test_is_expansion_filter_false(self):
        r = self.client.get(f"/api/events/{self.slug}/games/?is_expansion=false")
        self.assertEqual(r.status_code, 200)
        ids = {g["bgg_id"] for g in r.data["results"]}
        # Both games are non-expansions, both should appear
        self.assertIn(224517, ids)
        self.assertIn(13, ids)

    def test_no_filter_returns_both_games(self):
        r = self.client.get(f"/api/events/{self.slug}/games/")
        self.assertEqual(r.status_code, 200)
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertIn(224517, ids)
        self.assertIn(13, ids)

    # -- F5: year / rank / complexity filters ------------------------------

    def test_year_from_excludes_older_games(self):
        # game_a=2018, game_b=1995 → year_from=2000 keeps only game_a.
        r = self.client.get(f"/api/events/{self.slug}/games/?year_from=2000")
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {224517})

    def test_year_to_excludes_newer_games(self):
        r = self.client.get(f"/api/events/{self.slug}/games/?year_to=2000")
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {13})

    def test_rank_max_keeps_only_top_ranked(self):
        # game_a rank=1, game_b rank=500 → rank_max=100 keeps only game_a.
        r = self.client.get(f"/api/events/{self.slug}/games/?rank_max=100")
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {224517})

    def test_min_weight_excludes_lighter_games(self):
        # weights: game_a=4.0, game_b=2.0 → min_weight=3 keeps only game_a.
        r = self.client.get(f"/api/events/{self.slug}/games/?min_weight=3")
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {224517})

    def test_max_weight_excludes_heavier_games(self):
        r = self.client.get(f"/api/events/{self.slug}/games/?max_weight=3")
        ids = {g["bgg_id"] for g in r.data["results"]}
        self.assertEqual(ids, {13})
