"""
copies/tests.py

F3 Copy tests:
    1.  Create copy → 201 with unique listing_code
    2.  listing_code format (starts with "C-", length <= 12)
    3.  listing_code uniqueness across multiple copies
    4.  Copy appears in GET /api/games/{bgg_id}/copies/
    5.  copies_count on game detail increments when ACTIVE copy added
    6.  copies_count on game list increments when ACTIVE copy added
    7.  Non-owner PATCH → 403
    8.  Non-owner DELETE → 403
    9.  Owner PATCH succeeds
    10. Owner DELETE succeeds
    11. ?mine=true filters to own copies only
    12. ?board_game= filter
    13. ?status= filter
    14. ?owner= filter (by user id)
    15. GET /api/games/{bgg_id}/copies/ only returns ACTIVE copies
    16. GET /api/games/{bgg_id}/copies/ ?condition= filter
    17. GET /api/games/{bgg_id}/copies/ ?language= filter (case-insensitive)
    18. Unauthenticated POST → 401
"""

import csv
import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv
from copies.models import Copy

User = get_user_model()

COPIES_URL = "/api/copies/"


def copy_url(copy_id):
    return f"/api/copies/{copy_id}/"


def game_copies_url(bgg_id):
    return f"/api/games/{bgg_id}/copies/"


def game_detail_url(bgg_id):
    return f"/api/games/{bgg_id}/"


def games_list_url():
    return "/api/games/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_ROWS = [
    {
        "id": "224517",
        "name": "Brass: Birmingham",
        "yearpublished": "2018",
        "rank": "1",
        "bayesaverage": "8.39",
        "average": "8.56",
        "usersrated": "58000",
        "is_expansion": "0",
    },
    {
        "id": "342942",
        "name": "Ark Nova",
        "yearpublished": "2021",
        "rank": "2",
        "bayesaverage": "8.35",
        "average": "8.54",
        "usersrated": "61000",
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


# ---------------------------------------------------------------------------
# Base test case — common setup
# ---------------------------------------------------------------------------

class CopyTestBase(APITestCase):
    """Shared setup: two users, two games, authenticated as user1."""

    @classmethod
    def setUpTestData(cls):
        csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=csv_path)
        os.unlink(csv_path)

        cls.user1 = User.objects.create_user(
            username="alice", password="pass1234", email="alice@example.com"
        )
        cls.user2 = User.objects.create_user(
            username="bob", password="pass1234", email="bob@example.com"
        )
        cls.game1 = BoardGame.objects.get(bgg_id=224517)  # Brass: Birmingham
        cls.game2 = BoardGame.objects.get(bgg_id=342942)  # Ark Nova

    def setUp(self):
        # Authenticate as user1 by default
        self.client.force_authenticate(user=self.user1)
        # Clear in-memory cache so cached copies_count values don't bleed between tests
        cache.clear()


# ---------------------------------------------------------------------------
# Create tests
# ---------------------------------------------------------------------------

class CopyCreateTests(CopyTestBase):

    def test_create_returns_201(self):
        payload = {"board_game": 224517, "condition": "GOOD", "language": "English"}
        resp = self.client.post(COPIES_URL, payload)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_create_returns_listing_code(self):
        payload = {"board_game": 224517, "condition": "NEW"}
        resp = self.client.post(COPIES_URL, payload)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("listing_code", resp.data)
        listing_code = resp.data["listing_code"]
        self.assertTrue(listing_code.startswith("C-"), f"Expected C- prefix: {listing_code}")
        self.assertLessEqual(len(listing_code), 12)

    def test_listing_code_unique_across_copies(self):
        """Creating multiple copies should give distinct listing_codes."""
        codes = set()
        for _ in range(10):
            resp = self.client.post(COPIES_URL, {"board_game": 224517})
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
            codes.add(resp.data["listing_code"])
        self.assertEqual(len(codes), 10, "listing_codes should all be unique")

    def test_create_sets_owner_to_request_user(self):
        resp = self.client.post(COPIES_URL, {"board_game": 224517})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["owner"], self.user1.pk)

    def test_create_default_status_is_active(self):
        resp = self.client.post(COPIES_URL, {"board_game": 224517})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], "ACTIVE")

    def test_unauthenticated_create_returns_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(COPIES_URL, {"board_game": 224517})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_missing_board_game_returns_400(self):
        resp = self.client.post(COPIES_URL, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Game copies sub-route + copies_count
# ---------------------------------------------------------------------------

class GameCopiesSubRouteTests(CopyTestBase):

    def test_copy_appears_in_game_copies(self):
        """After creating a copy, it must appear under /api/games/{bgg_id}/copies/."""
        resp = self.client.post(COPIES_URL, {"board_game": 224517, "condition": "GOOD"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        created_code = resp.data["listing_code"]

        resp2 = self.client.get(game_copies_url(224517))
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        codes_in_list = [c["listing_code"] for c in resp2.data["results"]]
        self.assertIn(created_code, codes_in_list)

    def test_copies_count_increments_on_detail(self):
        """copies_count on game detail should reflect the number of ACTIVE copies."""
        # Start with no copies for game2
        resp = self.client.get(game_detail_url(342942))
        initial_count = resp.data["copies_count"]

        self.client.post(COPIES_URL, {"board_game": 342942})

        # Clear the cache so the next GET hits the DB and picks up the new copy.
        cache.clear()
        resp2 = self.client.get(game_detail_url(342942))
        self.assertEqual(resp2.data["copies_count"], initial_count + 1)

    def test_copies_count_increments_on_list(self):
        """copies_count in the games list should reflect ACTIVE copies."""
        self.client.post(COPIES_URL, {"board_game": 224517})
        resp = self.client.get(games_list_url())
        game = next(g for g in resp.data["results"] if g["bgg_id"] == 224517)
        self.assertGreaterEqual(game["copies_count"], 1)

    def test_game_copies_only_active(self):
        """Non-ACTIVE copies must NOT appear in /api/games/{bgg_id}/copies/."""
        # Create a WITHDRAWN copy
        copy = Copy.objects.create(
            owner=self.user1,
            board_game=self.game1,
            status=Copy.Status.WITHDRAWN,
        )
        resp = self.client.get(game_copies_url(224517))
        codes = [c["listing_code"] for c in resp.data["results"]]
        self.assertNotIn(copy.listing_code, codes)

    def test_game_copies_condition_filter(self):
        Copy.objects.create(
            owner=self.user1, board_game=self.game1, condition="EXCELLENT"
        )
        Copy.objects.create(
            owner=self.user1, board_game=self.game1, condition="POOR"
        )
        resp = self.client.get(game_copies_url(224517), {"condition": "EXCELLENT"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for c in resp.data["results"]:
            self.assertEqual(c["condition"], "EXCELLENT")

    def test_game_copies_language_filter_case_insensitive(self):
        Copy.objects.create(
            owner=self.user1, board_game=self.game1, language="English"
        )
        Copy.objects.create(
            owner=self.user1, board_game=self.game1, language="Spanish"
        )
        resp = self.client.get(game_copies_url(224517), {"language": "english"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for c in resp.data["results"]:
            self.assertIn("english", c["language"].lower())

    def test_game_copies_404_on_missing_game(self):
        resp = self.client.get(game_copies_url(9999999))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_copies_count_does_not_count_withdrawn(self):
        """copies_count should only count ACTIVE copies, not WITHDRAWN/TRADED."""
        # Ensure at least one withdrawn copy doesn't inflate the count
        Copy.objects.create(
            owner=self.user1,
            board_game=self.game2,
            status=Copy.Status.WITHDRAWN,
        )
        active_copy = Copy.objects.create(
            owner=self.user1,
            board_game=self.game2,
            status=Copy.Status.ACTIVE,
        )
        resp = self.client.get(game_detail_url(342942))
        # copies_count should equal number of ACTIVE copies only
        active_count = Copy.objects.filter(
            board_game=self.game2, status=Copy.Status.ACTIVE
        ).count()
        self.assertEqual(resp.data["copies_count"], active_count)
        active_copy.delete()


# ---------------------------------------------------------------------------
# Permission tests
# ---------------------------------------------------------------------------

class CopyPermissionTests(CopyTestBase):

    def setUp(self):
        super().setUp()
        # Create a copy owned by user1
        self.copy = Copy.objects.create(
            owner=self.user1,
            board_game=self.game1,
            condition="GOOD",
        )

    def test_non_owner_patch_returns_403(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(copy_url(self.copy.pk), {"condition": "POOR"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_owner_delete_returns_403(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(copy_url(self.copy.pk))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_patch_succeeds(self):
        resp = self.client.patch(copy_url(self.copy.pk), {"condition": "EXCELLENT"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["condition"], "EXCELLENT")

    def test_owner_delete_succeeds(self):
        resp = self.client.delete(copy_url(self.copy.pk))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Copy.objects.filter(pk=self.copy.pk).exists())


# ---------------------------------------------------------------------------
# Filter tests
# ---------------------------------------------------------------------------

class CopyFilterTests(CopyTestBase):

    def setUp(self):
        super().setUp()
        # user1 has 2 copies; user2 has 1 copy
        self.copy_u1_g1 = Copy.objects.create(
            owner=self.user1, board_game=self.game1, status="ACTIVE"
        )
        self.copy_u1_g2 = Copy.objects.create(
            owner=self.user1, board_game=self.game2, status="WITHDRAWN"
        )
        self.copy_u2_g1 = Copy.objects.create(
            owner=self.user2, board_game=self.game1, status="ACTIVE"
        )

    def test_mine_true_returns_only_own_copies(self):
        resp = self.client.get(COPIES_URL, {"mine": "true"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        owner_ids = {c["owner"] for c in resp.data["results"]}
        self.assertEqual(owner_ids, {self.user1.pk})

    def test_mine_true_excludes_other_users_copies(self):
        resp = self.client.get(COPIES_URL, {"mine": "true"})
        pk_list = [c["id"] for c in resp.data["results"]]
        self.assertNotIn(self.copy_u2_g1.pk, pk_list)

    def test_board_game_filter(self):
        resp = self.client.get(COPIES_URL, {"board_game": 224517})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for c in resp.data["results"]:
            self.assertEqual(c["board_game"], 224517)

    def test_status_filter_active(self):
        resp = self.client.get(COPIES_URL, {"status": "ACTIVE"})
        for c in resp.data["results"]:
            self.assertEqual(c["status"], "ACTIVE")

    def test_status_filter_withdrawn(self):
        resp = self.client.get(COPIES_URL, {"status": "WITHDRAWN"})
        for c in resp.data["results"]:
            self.assertEqual(c["status"], "WITHDRAWN")

    def test_owner_filter_by_id(self):
        resp = self.client.get(COPIES_URL, {"owner": self.user2.pk})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        owner_ids = {c["owner"] for c in resp.data["results"]}
        self.assertEqual(owner_ids, {self.user2.pk})

    def test_board_game_and_status_combined(self):
        resp = self.client.get(
            COPIES_URL, {"board_game": 224517, "status": "ACTIVE"}
        )
        for c in resp.data["results"]:
            self.assertEqual(c["board_game"], 224517)
            self.assertEqual(c["status"], "ACTIVE")


# ---------------------------------------------------------------------------
# Retrieve / list tests
# ---------------------------------------------------------------------------

class CopyRetrieveTests(CopyTestBase):

    def test_retrieve_returns_all_fields(self):
        copy = Copy.objects.create(
            owner=self.user1,
            board_game=self.game1,
            condition="NEW",
            language="English",
        )
        resp = self.client.get(copy_url(copy.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for field in [
            "id", "listing_code", "owner", "owner_username", "board_game",
            "board_game_name", "condition", "language", "edition", "sleeved",
            "includes_expansions", "missing_components", "upgraded_components",
            "component_notes", "owner_notes", "trade_value_hint",
            "shipping_constraints", "pickup_available", "photo_urls",
            "status", "created", "updated",
        ]:
            self.assertIn(field, resp.data, f"Missing field: {field}")

    def test_retrieve_board_game_name_present(self):
        copy = Copy.objects.create(owner=self.user1, board_game=self.game1)
        resp = self.client.get(copy_url(copy.pk))
        self.assertEqual(resp.data["board_game_name"], "Brass: Birmingham")

    def test_list_returns_paginated(self):
        resp = self.client.get(COPIES_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("count", resp.data)
        self.assertIn("results", resp.data)
