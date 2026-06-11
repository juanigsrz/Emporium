"""
trades/tests.py

F5 X-to-Y Trades test suite.

Tests:
    1.  1-to-1 wish: OfferGroup{one listing} max_give=1 → WantGroup{3 BOARD_GAME
        targets} min_receive=1 — creates ok, X=1 Y=1 persisted.
    2.  M-to-N wish: max_give=2 → min_receive=2 — creates ok, X=2 Y=2 persisted.
    3.  Offer item not owned by user → 400.
    4.  Want item with neither board_game nor event_listing → 400.
    5.  Want item with both targets set → 400.
    6.  Want-group PATCH bulk-replaces items (wants are binary — no tier/rank).
    7.  Cross-event listing in offer group → 400.
    8.  Cross-event listing in want group → 400.
    9.  TradeWish with offer_group belonging to another user → 400.
    10. TradeWish with want_group belonging to another user → 400.
    11. Non-owner PATCH/DELETE offer-group → 403.
    12. Non-owner PATCH/DELETE want-group → 403.
    13. Non-owner PATCH/DELETE wish → 403.
    14. Offer-group PATCH replaces items.
    15. OfferGroupItem serializer fields present (listing_code, board_game_name).
    16. WantGroupItem with target_type=LISTING: listing_code and board_game_name populated.
    17. TradeWish serializer includes offer_group_name, want_group_name, max_give, min_receive.
    18. Want group items returned in insertion order in response.
    19. DELETE offer-group returns 204.
    20. DELETE want-group returns 204.
    21. DELETE wish returns 204.
"""

import csv
import os
import tempfile

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv
from copies.models import Copy
from events.models import EventListing, TradeEvent, WANTLIST_LOCKED_STATUSES

User = get_user_model()


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

EVENTS_URL = "/api/events/"


def offer_groups_url(slug):
    return f"/api/events/{slug}/offer-groups/"


def offer_group_url(slug, pk):
    return f"/api/events/{slug}/offer-groups/{pk}/"


def want_groups_url(slug):
    return f"/api/events/{slug}/want-groups/"


def want_group_url(slug, pk):
    return f"/api/events/{slug}/want-groups/{pk}/"


def wishes_url(slug):
    return f"/api/events/{slug}/wishes/"


def wish_url(slug, pk):
    return f"/api/events/{slug}/wishes/{pk}/"


def listings_url(slug):
    return f"/api/events/{slug}/listings/"


# ---------------------------------------------------------------------------
# CSV helper (4 games so tests have variety)
# ---------------------------------------------------------------------------

SAMPLE_ROWS = [
    {"id": "224517", "name": "Brass: Birmingham",   "yearpublished": "2018", "rank": "1",
     "bayesaverage": "8.39", "average": "8.56", "usersrated": "58000", "is_expansion": "0"},
    {"id": "342942", "name": "Ark Nova",            "yearpublished": "2021", "rank": "2",
     "bayesaverage": "8.35", "average": "8.54", "usersrated": "61000", "is_expansion": "0"},
    {"id": "167791", "name": "Terraforming Mars",   "yearpublished": "2016", "rank": "5",
     "bayesaverage": "8.10", "average": "8.40", "usersrated": "120000", "is_expansion": "0"},
    {"id": "220308", "name": "Gaia Project",        "yearpublished": "2017", "rank": "6",
     "bayesaverage": "8.10", "average": "8.45", "usersrated": "50000", "is_expansion": "0"},
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
# Base: two users, 4 games, 2 copies per user, 1 shared event, listings added
# ---------------------------------------------------------------------------

class TradeTestBase(APITestCase):
    """
    setUpTestData creates:
        user1 (alice), user2 (bob)
        4 games: game_brass, game_ark, game_terra, game_gaia
        user1: copy1a (brass), copy1b (ark)
        user2: copy2a (terra), copy2b (gaia)
        event (owned by user1, slug stored in cls.slug)
        el1a, el1b: user1's listings in event
        el2a, el2b: user2's listings in event
    """

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

        cls.game_brass = BoardGame.objects.get(bgg_id=224517)
        cls.game_ark   = BoardGame.objects.get(bgg_id=342942)
        cls.game_terra = BoardGame.objects.get(bgg_id=167791)
        cls.game_gaia  = BoardGame.objects.get(bgg_id=220308)

        cls.copy1a = Copy.objects.create(owner=cls.user1, board_game=cls.game_brass)
        cls.copy1b = Copy.objects.create(owner=cls.user1, board_game=cls.game_ark)
        cls.copy2a = Copy.objects.create(owner=cls.user2, board_game=cls.game_terra)
        cls.copy2b = Copy.objects.create(owner=cls.user2, board_game=cls.game_gaia)

        # Create and open the event so listings can be added
        cls.event = TradeEvent.objects.create(
            name="Test Trade 2026",
            organizer=cls.user1,
            status="WANTLIST_OPEN",
        )
        cls.slug = cls.event.slug

        cls.el1a = EventListing.objects.create(event=cls.event, copy=cls.copy1a)
        cls.el1b = EventListing.objects.create(event=cls.event, copy=cls.copy1b)
        cls.el2a = EventListing.objects.create(event=cls.event, copy=cls.copy2a)
        cls.el2b = EventListing.objects.create(event=cls.event, copy=cls.copy2b)

    def setUp(self):
        self.client.force_authenticate(user=self.user1)


# ---------------------------------------------------------------------------
# 1. 1-to-1 Wish
# ---------------------------------------------------------------------------

class OneToOneWishTests(TradeTestBase):

    def test_create_1_to_1_wish_ok(self):
        """OfferGroup{one listing} max_give=1 → WantGroup{3 board_game targets} min_receive=1."""
        # Create offer group with user1's single listing
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "My Brass",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        self.assertEqual(og_resp.status_code, status.HTTP_201_CREATED, og_resp.data)
        og_id = og_resp.data["id"]
        self.assertEqual(og_resp.data["max_give"], 1)
        self.assertEqual(len(og_resp.data["items"]), 1)

        # Create want group with 3 board-game targets
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Want Any One",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        self.assertEqual(wg_resp.status_code, status.HTTP_201_CREATED, wg_resp.data)
        wg_id = wg_resp.data["id"]
        self.assertEqual(wg_resp.data["min_receive"], 1)
        self.assertEqual(len(wg_resp.data["items"]), 3)

        # Create the wish
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_id,
            "want_group": wg_id,
            "active": True,
        }, format="json")
        self.assertEqual(wish_resp.status_code, status.HTTP_201_CREATED, wish_resp.data)
        self.assertEqual(wish_resp.data["max_give"], 1)
        self.assertEqual(wish_resp.data["min_receive"], 1)
        self.assertEqual(wish_resp.data["active"], True)

    def test_1_to_1_wish_x_y_persisted_in_db(self):
        """Verify X=max_give=1 and Y=min_receive=1 are actually stored."""
        from trades.models import OfferGroup, WantGroup, TradeWish

        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "DB Check OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "DB Check WG",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_resp.data["id"],
            "want_group": wg_resp.data["id"],
        }, format="json")

        wish = TradeWish.objects.get(pk=wish_resp.data["id"])
        self.assertEqual(wish.offer_group.max_give, 1)
        self.assertEqual(wish.want_group.min_receive, 1)


# ---------------------------------------------------------------------------
# 2. M-to-N Wish
# ---------------------------------------------------------------------------

class MToNWishTests(TradeTestBase):

    def test_create_m_to_n_wish_ok(self):
        """OfferGroup{2 listings} max_give=2 → WantGroup{3 targets} min_receive=2."""
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "My Bundle",
            "max_give": 2,
            "item_listing_ids": [self.el1a.id, self.el1b.id],
        }, format="json")
        self.assertEqual(og_resp.status_code, status.HTTP_201_CREATED, og_resp.data)
        self.assertEqual(og_resp.data["max_give"], 2)
        self.assertEqual(len(og_resp.data["items"]), 2)

        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Want Two",
            "min_receive": 2,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        self.assertEqual(wg_resp.status_code, status.HTTP_201_CREATED, wg_resp.data)
        self.assertEqual(wg_resp.data["min_receive"], 2)

        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_resp.data["id"],
            "want_group": wg_resp.data["id"],
        }, format="json")
        self.assertEqual(wish_resp.status_code, status.HTTP_201_CREATED, wish_resp.data)
        self.assertEqual(wish_resp.data["max_give"], 2)
        self.assertEqual(wish_resp.data["min_receive"], 2)

    def test_m_to_n_x_y_persisted_in_db(self):
        from trades.models import TradeWish

        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "MN OG",
            "max_give": 2,
            "item_listing_ids": [self.el1a.id, self.el1b.id],
        }, format="json")
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "MN WG",
            "min_receive": 2,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
            ],
        }, format="json")
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_resp.data["id"],
            "want_group": wg_resp.data["id"],
        }, format="json")

        wish = TradeWish.objects.get(pk=wish_resp.data["id"])
        self.assertEqual(wish.offer_group.max_give, 2)
        self.assertEqual(wish.want_group.min_receive, 2)


# ---------------------------------------------------------------------------
# 3. Offer item not owned by user → 400
# ---------------------------------------------------------------------------

class OfferItemOwnershipTests(TradeTestBase):

    def test_offer_item_not_owned_by_user_returns_400(self):
        """user1 cannot add user2's listing (el2a) to their offer group."""
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Bad Offer",
            "max_give": 1,
            "item_listing_ids": [self.el2a.id],  # user2's listing
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_offer_group_with_own_listing_succeeds(self):
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Good Offer",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


# ---------------------------------------------------------------------------
# 4–5. WantGroupItem validation: neither / both targets
# ---------------------------------------------------------------------------

class WantItemValidationTests(TradeTestBase):

    def test_want_item_neither_target_returns_400(self):
        """target_type=BOARD_GAME with no board_game → 400."""
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Bad Want",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME"},
                # missing board_game
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_want_item_listing_type_without_listing_returns_400(self):
        """target_type=LISTING with no event_listing → 400."""
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Bad Want Listing",
            "min_receive": 1,
            "items": [
                {"target_type": "LISTING"},
                # missing event_listing
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_want_item_both_targets_returns_400(self):
        """BOARD_GAME target_type with event_listing also set → 400."""
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Both Targets",
            "min_receive": 1,
            "items": [
                {
                    "target_type": "BOARD_GAME",
                    "board_game": self.game_terra.bgg_id,
                    "event_listing": self.el2a.id,
                },
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_valid_listing_target_type_succeeds(self):
        """target_type=LISTING with a valid event_listing → 201."""
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Specific Listing Want",
            "min_receive": 1,
            "items": [
                {"target_type": "LISTING", "event_listing": self.el2a.id},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


# ---------------------------------------------------------------------------
# 6. Want-group PATCH replaces items (wants are binary — no tier/rank)
# ---------------------------------------------------------------------------

class WantGroupReorderTests(TradeTestBase):

    def test_patch_replaces_items_in_insertion_order(self):
        """PATCH with a new items list replaces the set; order = insertion order."""
        # Create want group with initial items
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Reorderable",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
            ],
        }, format="json")
        wg_id = wg_resp.data["id"]

        # PATCH replaces the whole set with a new (swapped) list
        patch_resp = self.client.patch(want_group_url(self.slug, wg_id), {
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
            ],
        }, format="json")
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK, patch_resp.data)
        items = patch_resp.data["items"]
        self.assertEqual(len(items), 2)
        # Items returned in insertion order (no tier/rank concept)
        self.assertEqual(items[0]["board_game"], self.game_gaia.bgg_id)
        self.assertEqual(items[1]["board_game"], self.game_terra.bgg_id)
        self.assertNotIn("tier", items[0])
        self.assertNotIn("rank", items[0])

    def test_patch_without_items_does_not_replace_items(self):
        """PATCH that omits 'items' key should not change the items list."""
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Keep Items",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        wg_id = wg_resp.data["id"]

        patch_resp = self.client.patch(want_group_url(self.slug, wg_id), {
            "name": "Keep Items Renamed",
        }, format="json")
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK, patch_resp.data)
        self.assertEqual(patch_resp.data["name"], "Keep Items Renamed")
        self.assertEqual(len(patch_resp.data["items"]), 1)


# ---------------------------------------------------------------------------
# 7–8. Cross-event listing rejection
# ---------------------------------------------------------------------------

class CrossEventValidationTests(TradeTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # Create a second event and add user1's copy1b to it
        cls.event2 = TradeEvent.objects.create(
            name="Other Event",
            organizer=cls.user1,
            status="WANTLIST_OPEN",
        )
        cls.el_other_event = EventListing.objects.create(
            event=cls.event2, copy=cls.copy1b
        )

    def test_cross_event_listing_in_offer_group_rejected_400(self):
        """Listing from event2 cannot be added to offer group in event1."""
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Cross Event Offer",
            "max_give": 1,
            "item_listing_ids": [self.el_other_event.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_cross_event_listing_in_want_group_rejected_400(self):
        """Listing from event2 cannot be used as target in want group for event1."""
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Cross Event Want",
            "min_receive": 1,
            "items": [
                {"target_type": "LISTING", "event_listing": self.el_other_event.id},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)


# ---------------------------------------------------------------------------
# 9–10. TradeWish cross-owner / cross-event group validation
# ---------------------------------------------------------------------------

class WishGroupOwnershipTests(TradeTestBase):
    """Wish must use groups belonging to the requesting user in this event."""

    def _make_offer_group(self, user, listing):
        """Create an offer group as the given user."""
        self.client.force_authenticate(user=user)
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": f"OG-{user.username}",
            "max_give": 1,
            "item_listing_ids": [listing.id],
        }, format="json")
        self.client.force_authenticate(user=self.user1)
        return resp.data["id"]

    def _make_want_group(self, user):
        self.client.force_authenticate(user=user)
        resp = self.client.post(want_groups_url(self.slug), {
            "name": f"WG-{user.username}",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        self.client.force_authenticate(user=self.user1)
        return resp.data["id"]

    def test_wish_with_other_users_offer_group_returns_400(self):
        """user1 cannot create a wish using user2's offer group."""
        bob_og_id = self._make_offer_group(self.user2, self.el2a)
        alice_wg_id = self._make_want_group(self.user1)

        # user1 tries to use user2's offer group
        resp = self.client.post(wishes_url(self.slug), {
            "offer_group": bob_og_id,
            "want_group": alice_wg_id,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_wish_with_other_users_want_group_returns_400(self):
        """user1 cannot create a wish using user2's want group."""
        alice_og_id = self._make_offer_group(self.user1, self.el1a)
        bob_wg_id = self._make_want_group(self.user2)

        # user1 tries to use user2's want group
        resp = self.client.post(wishes_url(self.slug), {
            "offer_group": alice_og_id,
            "want_group": bob_wg_id,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)


# ---------------------------------------------------------------------------
# 11–13. Non-owner write → 403
# ---------------------------------------------------------------------------

class OwnerOnlyWriteTests(TradeTestBase):

    def setUp(self):
        super().setUp()
        # user1 creates groups and a wish
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Alice OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        self.alice_og_id = og_resp.data["id"]

        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Alice WG",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
            ],
        }, format="json")
        self.alice_wg_id = wg_resp.data["id"]

        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": self.alice_og_id,
            "want_group": self.alice_wg_id,
        }, format="json")
        self.alice_wish_id = wish_resp.data["id"]

    def test_bob_cannot_patch_alices_offer_group(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(
            offer_group_url(self.slug, self.alice_og_id), {"name": "Hacked"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bob_cannot_delete_alices_offer_group(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(offer_group_url(self.slug, self.alice_og_id))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bob_cannot_patch_alices_want_group(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(
            want_group_url(self.slug, self.alice_wg_id), {"name": "Hacked"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bob_cannot_delete_alices_want_group(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(want_group_url(self.slug, self.alice_wg_id))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bob_cannot_patch_alices_wish(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(
            wish_url(self.slug, self.alice_wish_id), {"active": False}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bob_cannot_delete_alices_wish(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(wish_url(self.slug, self.alice_wish_id))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ---------------------------------------------------------------------------
# 14. Offer-group PATCH replaces items
# ---------------------------------------------------------------------------

class OfferGroupPatchTests(TradeTestBase):

    def test_patch_offer_group_replaces_items(self):
        # Create with el1a only
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Patch OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        og_id = og_resp.data["id"]
        self.assertEqual(len(og_resp.data["items"]), 1)

        # PATCH to replace with el1b only
        patch_resp = self.client.patch(offer_group_url(self.slug, og_id), {
            "item_listing_ids": [self.el1b.id],
        }, format="json")
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK, patch_resp.data)
        self.assertEqual(len(patch_resp.data["items"]), 1)
        self.assertEqual(
            patch_resp.data["items"][0]["event_listing"], self.el1b.id
        )

    def test_patch_offer_group_name_without_items_key_keeps_items(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Keep Items OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        og_id = og_resp.data["id"]

        patch_resp = self.client.patch(offer_group_url(self.slug, og_id), {
            "name": "Renamed OG",
        }, format="json")
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK, patch_resp.data)
        self.assertEqual(patch_resp.data["name"], "Renamed OG")
        self.assertEqual(len(patch_resp.data["items"]), 1)


# ---------------------------------------------------------------------------
# 15. OfferGroupItem serializer field names
# ---------------------------------------------------------------------------

class OfferGroupItemFieldTests(TradeTestBase):

    def test_offer_group_item_fields_present(self):
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Field Test OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        self.assertIn("id", item)
        self.assertIn("event_listing", item)
        self.assertIn("listing_code", item)
        self.assertIn("board_game_name", item)
        self.assertIn("board_game_id", item)
        # Values should be non-null
        self.assertEqual(item["event_listing"], self.el1a.id)
        self.assertEqual(item["board_game_name"], "Brass: Birmingham")
        self.assertEqual(item["board_game_id"], 224517)
        self.assertTrue(item["listing_code"].startswith("C-"))

    def test_offer_group_top_level_fields(self):
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Top Level OG",
            "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        for field in ["id", "event", "user", "user_username", "name", "max_give", "rules",
                      "items", "created", "updated"]:
            self.assertIn(field, resp.data, f"Missing field: {field}")
        self.assertEqual(resp.data["user_username"], "alice")


# ---------------------------------------------------------------------------
# 16. WantGroupItem with LISTING target: listing_code and board_game_name populated
# ---------------------------------------------------------------------------

class WantGroupItemListingFieldTests(TradeTestBase):

    def test_want_group_item_listing_fields_populated(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Specific Listing WG",
            "min_receive": 1,
            "items": [
                {"target_type": "LISTING", "event_listing": self.el2a.id},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        self.assertEqual(item["target_type"], "LISTING")
        self.assertEqual(item["event_listing"], self.el2a.id)
        self.assertEqual(item["listing_code"], self.copy2a.listing_code)
        self.assertEqual(item["board_game_name"], "Terraforming Mars")
        self.assertIsNone(item["board_game"])  # board_game is null for LISTING type

    def test_want_group_item_board_game_fields_populated(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "BG Target WG",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        self.assertEqual(item["target_type"], "BOARD_GAME")
        self.assertEqual(item["board_game"], self.game_terra.bgg_id)
        self.assertEqual(item["board_game_name"], "Terraforming Mars")
        self.assertIsNone(item["event_listing"])
        self.assertIsNone(item["listing_code"])


# ---------------------------------------------------------------------------
# 17. TradeWish serializer includes X/Y display fields
# ---------------------------------------------------------------------------

class TradeWishSerializerFieldTests(TradeTestBase):

    def test_wish_serializer_fields(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Wish Field OG",
            "max_give": 3,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Wish Field WG",
            "min_receive": 2,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_resp.data["id"],
            "want_group": wg_resp.data["id"],
        }, format="json")
        self.assertEqual(wish_resp.status_code, status.HTTP_201_CREATED, wish_resp.data)
        data = wish_resp.data

        # All required fields present
        for field in ["id", "event", "user", "user_username", "offer_group",
                      "offer_group_name", "max_give", "want_group", "want_group_name",
                      "min_receive", "active", "created", "updated"]:
            self.assertIn(field, data, f"Missing field: {field}")

        self.assertEqual(data["offer_group_name"], "Wish Field OG")
        self.assertEqual(data["want_group_name"], "Wish Field WG")
        self.assertEqual(data["max_give"], 3)
        self.assertEqual(data["min_receive"], 2)
        self.assertEqual(data["user_username"], "alice")


# ---------------------------------------------------------------------------
# 18. Want-group items returned in insertion order (wants are binary)
# ---------------------------------------------------------------------------

class WantGroupItemOrderingTests(TradeTestBase):

    def test_items_returned_in_insertion_order(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Ordered WG",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id},
                {"target_type": "BOARD_GAME", "board_game": self.game_gaia.bgg_id},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        items = resp.data["items"]
        self.assertEqual(items[0]["board_game"], self.game_ark.bgg_id)
        self.assertEqual(items[1]["board_game"], self.game_terra.bgg_id)
        self.assertEqual(items[2]["board_game"], self.game_gaia.bgg_id)


# ---------------------------------------------------------------------------
# 19–21. DELETE returns 204
# ---------------------------------------------------------------------------

class DeleteTests(TradeTestBase):

    def test_delete_offer_group_204(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Del OG",
            "max_give": 1,
            "item_listing_ids": [],
        }, format="json")
        resp = self.client.delete(offer_group_url(self.slug, og_resp.data["id"]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_want_group_204(self):
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Del WG",
            "min_receive": 1,
            "items": [],
        }, format="json")
        resp = self.client.delete(want_group_url(self.slug, wg_resp.data["id"]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_wish_204(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "Del Wish OG",
            "max_give": 1,
            "item_listing_ids": [],
        }, format="json")
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Del Wish WG",
            "min_receive": 1,
            "items": [
                {"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id},
            ],
        }, format="json")
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_resp.data["id"],
            "want_group": wg_resp.data["id"],
        }, format="json")
        resp = self.client.delete(wish_url(self.slug, wish_resp.data["id"]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Duplicate protection + canonical board_game_id grouping field
# ---------------------------------------------------------------------------

class MoneyAndDupProtectionTests(TradeTestBase):

    def test_want_group_duplicate_protection_defaults_false(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Plain", "min_receive": 1,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertFalse(resp.data["duplicate_protection"])

    def test_want_group_duplicate_protection_persists(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Protected", "min_receive": 1, "duplicate_protection": True,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["duplicate_protection"])

    def test_board_game_id_resolved_for_listing_target(self):
        # user1 wants user2's specific terra listing (el2a)
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "Specific", "min_receive": 1,
            "items": [{"target_type": "LISTING", "event_listing": self.el2a.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        # canonical id of the listing's game (terra) is exposed for FE grouping
        self.assertEqual(item["board_game_id"], self.game_terra.bgg_id)


# ---------------------------------------------------------------------------
# Status-lock: wants + listings blocked once event is MATCHING or later
# ---------------------------------------------------------------------------

class StatusLockTests(TradeTestBase):
    """Want-group / offer-group / wish / listing mutations 403 from MATCHING onward."""

    LOCKED_STATUSES = sorted(WANTLIST_LOCKED_STATUSES)

    def _set_status(self, s):
        self.event.status = s
        self.event.save(update_fields=["status"])

    def _reset_status(self):
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])

    # ------------------------------------------------------------------
    # Want-group create
    # ------------------------------------------------------------------

    def test_wantgroup_create_blocked_after_matching(self):
        self._set_status("MATCHING")
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "x", "min_receive": 1,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_brass.bgg_id}],
        }, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_wantgroup_create_allowed_in_wantlist_open(self):
        resp = self.client.post(want_groups_url(self.slug), {
            "name": "y", "min_receive": 1,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_brass.bgg_id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_wantgroup_create_blocked_all_locked_statuses(self):
        for s in self.LOCKED_STATUSES:
            with self.subTest(status=s):
                self._set_status(s)
                resp = self.client.post(want_groups_url(self.slug), {
                    "name": "z", "min_receive": 1,
                    "items": [{"target_type": "BOARD_GAME", "board_game": self.game_brass.bgg_id}],
                }, format="json")
                self._reset_status()
                self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, f"Expected 403 for status={s}")

    # ------------------------------------------------------------------
    # Offer-group create
    # ------------------------------------------------------------------

    def test_offergroup_create_blocked_after_matching(self):
        self._set_status("MATCHING")
        resp = self.client.post(offer_groups_url(self.slug), {
            "name": "og", "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------------------
    # Want-group patch / delete
    # ------------------------------------------------------------------

    def test_wantgroup_patch_blocked_after_matching(self):
        # Create the group while open
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Patch target", "min_receive": 1,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_ark.bgg_id}],
        }, format="json")
        wg_id = wg_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.patch(want_group_url(self.slug, wg_id), {"name": "hacked"}, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_wantgroup_delete_blocked_after_matching(self):
        wg_resp = self.client.post(want_groups_url(self.slug), {
            "name": "Del target", "min_receive": 1, "items": [],
        }, format="json")
        wg_id = wg_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.delete(want_group_url(self.slug, wg_id))
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------------------
    # Offer-group patch / delete
    # ------------------------------------------------------------------

    def test_offergroup_patch_blocked_after_matching(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "og patch", "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json")
        og_id = og_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.patch(offer_group_url(self.slug, og_id), {"name": "hacked"}, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_offergroup_delete_blocked_after_matching(self):
        og_resp = self.client.post(offer_groups_url(self.slug), {
            "name": "og del", "max_give": 1,
            "item_listing_ids": [],
        }, format="json")
        og_id = og_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.delete(offer_group_url(self.slug, og_id))
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------------------
    # Wish create / patch / delete
    # ------------------------------------------------------------------

    def _make_og_and_wg(self):
        """Helper: create offer + want group while event is open."""
        og = self.client.post(offer_groups_url(self.slug), {
            "name": "og wish", "max_give": 1,
            "item_listing_ids": [self.el1a.id],
        }, format="json").data
        wg = self.client.post(want_groups_url(self.slug), {
            "name": "wg wish", "min_receive": 1,
            "items": [{"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id}],
        }, format="json").data
        return og["id"], wg["id"]

    def test_wish_create_blocked_after_matching(self):
        og_id, wg_id = self._make_og_and_wg()
        self._set_status("MATCHING")
        resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_id, "want_group": wg_id,
        }, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_wish_patch_blocked_after_matching(self):
        og_id, wg_id = self._make_og_and_wg()
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_id, "want_group": wg_id,
        }, format="json")
        wish_id = wish_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.patch(wish_url(self.slug, wish_id), {"active": False}, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_wish_delete_blocked_after_matching(self):
        og_id, wg_id = self._make_og_and_wg()
        wish_resp = self.client.post(wishes_url(self.slug), {
            "offer_group": og_id, "want_group": wg_id,
        }, format="json")
        wish_id = wish_resp.data["id"]

        self._set_status("MATCHING")
        resp = self.client.delete(wish_url(self.slug, wish_id))
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------------------
    # Listing create / delete (events/views.py)
    # ------------------------------------------------------------------

    def test_listing_create_blocked_after_matching(self):
        # First remove el1a so we can add it again later
        self._set_status("MATCHING")
        resp = self.client.post(listings_url(self.slug), {"copy": self.copy1a.id}, format="json")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_delete_blocked_after_matching(self):
        self._set_status("MATCHING")
        resp = self.client.delete(f"{listings_url(self.slug)}{self.el1a.id}/")
        self._reset_status()
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
