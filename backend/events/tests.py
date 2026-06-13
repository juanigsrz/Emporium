"""
events/tests.py

F4 Trade Events test suite.

Tests:
    1.  Create event → DRAFT, organizer set to request.user, slug auto-generated
    2.  Slug is unique (two events with same name get distinct slugs)
    3.  Non-organizer PATCH → 403
    4.  Non-organizer DELETE → 403
    5.  Non-organizer cannot transition → 403
    6.  Invalid transition DRAFT → ARCHIVED → 400
    7.  Valid transition DRAFT → SUBMISSIONS_OPEN → 200; status updated
    8.  allowed_transitions updates after a transition
    9.  Join creates EventParticipation → 201; join again → 200 (idempotent)
    10. Leave removes participation → 204; leave when not joined → 400
    11. Add own copy as listing → 201
    12. Cannot add another user's copy → 403
    13. Duplicate listing rejected → 400
    14. Remove own listing → 204
    15. Cannot remove another user's listing → 403
    16. GET /participants/ lists participations
    17. GET /listings/ with ?user= and ?board_game= filters
    18. Event list ?status= filter
    19. Event list ?search= filter
    20. Unauthenticated create → 401
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
from events.models import ALLOWED_TRANSITIONS, EventListing, EventParticipation, TradeEvent

User = get_user_model()

EVENTS_URL = "/api/events/"


def event_url(slug):
    return f"/api/events/{slug}/"


def transition_url(slug):
    return f"/api/events/{slug}/transition/"


def participants_url(slug):
    return f"/api/events/{slug}/participants/"


def join_url(slug):
    return f"/api/events/{slug}/join/"


def leave_url(slug):
    return f"/api/events/{slug}/leave/"


def listings_url(slug):
    return f"/api/events/{slug}/listings/"


def listing_detail_url(slug, listing_id):
    return f"/api/events/{slug}/listings/{listing_id}/"


def games_url(slug):
    return f"/api/events/{slug}/games/"


# ---------------------------------------------------------------------------
# Sample CSV helper (reused from copies tests pattern)
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
# Base: two users, two games, a copy per user
# ---------------------------------------------------------------------------

class EventTestBase(APITestCase):

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
        cls.game1 = BoardGame.objects.get(bgg_id=224517)
        cls.game2 = BoardGame.objects.get(bgg_id=342942)
        cls.copy1 = Copy.objects.create(owner=cls.user1, board_game=cls.game1)
        cls.copy2 = Copy.objects.create(owner=cls.user2, board_game=cls.game2)

    def setUp(self):
        self.client.force_authenticate(user=self.user1)


# ---------------------------------------------------------------------------
# 1–2: Create + slug
# ---------------------------------------------------------------------------

class EventCreateTests(EventTestBase):

    def test_create_event_draft_status(self):
        resp = self.client.post(EVENTS_URL, {"name": "Summer Trade 2026"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], "DRAFT")

    def test_create_sets_organizer_to_request_user(self):
        resp = self.client.post(EVENTS_URL, {"name": "Summer Trade 2026"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["organizer"], self.user1.pk)

    def test_create_generates_slug(self):
        resp = self.client.post(EVENTS_URL, {"name": "Summer Trade 2026"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["slug"], "summer-trade-2026")

    def test_slug_uniqueness_suffix(self):
        """Two events with the same name get distinct slugs."""
        resp1 = self.client.post(EVENTS_URL, {"name": "Duplicate Slug"})
        resp2 = self.client.post(EVENTS_URL, {"name": "Duplicate Slug"})
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp2.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(resp1.data["slug"], resp2.data["slug"])

    def test_unauthenticated_create_returns_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(EVENTS_URL, {"name": "No Auth"})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_missing_name_returns_400(self):
        resp = self.client.post(EVENTS_URL, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# 3–4: Organizer-only write
# ---------------------------------------------------------------------------

class EventPermissionTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Perm Test Event"})
        self.slug = resp.data["slug"]

    def test_non_organizer_patch_returns_403(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(event_url(self.slug), {"name": "Hacked"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_organizer_delete_returns_403(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(event_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_organizer_patch_succeeds(self):
        resp = self.client.patch(event_url(self.slug), {"description": "Updated"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["description"], "Updated")

    def test_organizer_delete_succeeds(self):
        resp = self.client.delete(event_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TradeEvent.objects.filter(slug=self.slug).exists())


# ---------------------------------------------------------------------------
# 5–8: State machine / transitions
# ---------------------------------------------------------------------------

class EventTransitionTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Lifecycle Test"})
        self.slug = resp.data["slug"]

    def test_non_organizer_cannot_transition_403(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(
            transition_url(self.slug), {"to": "SUBMISSIONS_OPEN"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_transition_draft_to_archived_returns_400(self):
        resp = self.client.post(transition_url(self.slug), {"to": "ARCHIVED"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_transition_to_unknown_status_400(self):
        resp = self.client.post(transition_url(self.slug), {"to": "INVALID_STATUS"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_valid_transition_draft_to_submissions_open(self):
        resp = self.client.post(
            transition_url(self.slug), {"to": "SUBMISSIONS_OPEN"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "SUBMISSIONS_OPEN")

    def test_allowed_transitions_updates_after_transition(self):
        # From DRAFT the only allowed transition is SUBMISSIONS_OPEN
        resp = self.client.get(event_url(self.slug))
        self.assertEqual(resp.data["allowed_transitions"], ["SUBMISSIONS_OPEN"])

        # After transitioning to SUBMISSIONS_OPEN, next allowed differ
        self.client.post(transition_url(self.slug), {"to": "SUBMISSIONS_OPEN"})
        resp2 = self.client.get(event_url(self.slug))
        self.assertIn("WANTLIST_OPEN", resp2.data["allowed_transitions"])

    def test_full_happy_path_forward_transitions(self):
        """DRAFT → SUBMISSIONS_OPEN → WANTLIST_OPEN → MATCHING → MATCH_REVIEW → FINALIZATION → SHIPPING → ARCHIVED"""
        path = [
            "SUBMISSIONS_OPEN",
            "WANTLIST_OPEN",
            "MATCHING",
            "MATCH_REVIEW",
            "FINALIZATION",
            "SHIPPING",
            "ARCHIVED",
        ]
        for target in path:
            resp = self.client.post(transition_url(self.slug), {"to": target})
            self.assertEqual(
                resp.status_code,
                status.HTTP_200_OK,
                msg=f"Failed to transition to {target}: {resp.data}",
            )
            self.assertEqual(resp.data["status"], target)

        # ARCHIVED is terminal
        resp = self.client.get(event_url(self.slug))
        self.assertEqual(resp.data["allowed_transitions"], [])

    def test_allowed_transitions_dict_coverage(self):
        """Every status key in ALLOWED_TRANSITIONS is a valid Status choice."""
        valid_statuses = {s.value for s in TradeEvent.Status}
        for key, nexts in ALLOWED_TRANSITIONS.items():
            self.assertIn(key, valid_statuses, f"Key {key} not a valid status")
            for n in nexts:
                self.assertIn(n, valid_statuses, f"Next {n} not a valid status")


# ---------------------------------------------------------------------------
# 9–10: Join / leave
# ---------------------------------------------------------------------------

class EventJoinLeaveTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Join Leave Event"})
        self.slug = resp.data["slug"]

    def test_join_creates_participation_201(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(join_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            EventParticipation.objects.filter(
                event__slug=self.slug, user=self.user2
            ).exists()
        )

    def test_join_idempotent_returns_200_on_repeat(self):
        self.client.force_authenticate(user=self.user2)
        self.client.post(join_url(self.slug))
        resp2 = self.client.post(join_url(self.slug))
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)

    def test_leave_removes_participation_200(self):
        self.client.force_authenticate(user=self.user2)
        self.client.post(join_url(self.slug))
        resp = self.client.delete(leave_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(
            EventParticipation.objects.filter(
                event__slug=self.slug, user=self.user2
            ).exists()
        )

    def test_leave_when_not_joined_returns_400(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(leave_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_participants_list(self):
        self.client.force_authenticate(user=self.user2)
        self.client.post(join_url(self.slug))
        resp = self.client.get(participants_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        usernames = [p["username"] for p in resp.data["results"]]
        self.assertIn("bob", usernames)

    def test_participants_count_in_event_serializer(self):
        initial = self.client.get(event_url(self.slug)).data["participants_count"]
        self.client.force_authenticate(user=self.user2)
        self.client.post(join_url(self.slug))
        resp = self.client.get(event_url(self.slug))
        self.assertEqual(resp.data["participants_count"], initial + 1)

    def test_organizer_can_join_own_event(self):
        # user1 is the organizer (created the event in setUp). They may also trade.
        resp = self.client.post(join_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        ev = self.client.get(event_url(self.slug)).data
        self.assertTrue(ev["is_organizer"])
        self.assertTrue(ev["is_participant"])
        # and can leave again
        resp = self.client.delete(leave_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# 11–15: Listings
# ---------------------------------------------------------------------------

class EventListingTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Listing Test Event"})
        self.slug = resp.data["slug"]

    def test_add_own_copy_as_listing_201(self):
        resp = self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            EventListing.objects.filter(
                event__slug=self.slug, copy=self.copy1
            ).exists()
        )

    def test_cannot_add_other_users_copy_403(self):
        # user1 tries to add user2's copy
        resp = self.client.post(listings_url(self.slug), {"copy": self.copy2.pk})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_duplicate_listing_rejected_400(self):
        self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        resp = self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_remove_own_listing_204(self):
        add_resp = self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        listing_id = add_resp.data["id"]
        resp = self.client.delete(listing_detail_url(self.slug, listing_id))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(EventListing.objects.filter(pk=listing_id).exists())

    def test_cannot_remove_other_users_listing_403(self):
        # user2 adds their own copy
        self.client.force_authenticate(user=self.user2)
        add_resp = self.client.post(listings_url(self.slug), {"copy": self.copy2.pk})
        listing_id = add_resp.data["id"]
        # user1 tries to delete it
        self.client.force_authenticate(user=self.user1)
        resp = self.client.delete(listing_detail_url(self.slug, listing_id))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listings_list_returns_items(self):
        self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        resp = self.client.get(listings_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(resp.data["results"]), 1)

    def test_listings_filter_by_user(self):
        self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        self.client.force_authenticate(user=self.user2)
        self.client.post(listings_url(self.slug), {"copy": self.copy2.pk})

        # Filter by user2's id — should only return user2's listing
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(
            listings_url(self.slug), {"user": self.user2.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for item in resp.data["results"]:
            self.assertEqual(item["copy_owner_id"], self.user2.pk)

    def test_listings_filter_by_board_game(self):
        self.client.post(listings_url(self.slug), {"copy": self.copy1.pk})
        resp = self.client.get(
            listings_url(self.slug), {"board_game": self.game1.bgg_id}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for item in resp.data["results"]:
            self.assertEqual(item["board_game_id"], self.game1.bgg_id)

    def test_missing_copy_field_returns_400(self):
        resp = self.client.post(listings_url(self.slug), {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Serializer extra fields
# ---------------------------------------------------------------------------

class EventSerializerFieldTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Serializer Fields Test"})
        self.slug = resp.data["slug"]

    def test_is_organizer_true_for_organizer(self):
        resp = self.client.get(event_url(self.slug))
        self.assertTrue(resp.data["is_organizer"])

    def test_is_organizer_false_for_other_user(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.get(event_url(self.slug))
        self.assertFalse(resp.data["is_organizer"])

    def test_is_participant_false_before_join(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.get(event_url(self.slug))
        self.assertFalse(resp.data["is_participant"])

    def test_is_participant_true_after_join(self):
        self.client.force_authenticate(user=self.user2)
        self.client.post(join_url(self.slug))
        resp = self.client.get(event_url(self.slug))
        self.assertTrue(resp.data["is_participant"])

    def test_allowed_transitions_present_in_response(self):
        resp = self.client.get(event_url(self.slug))
        self.assertIn("allowed_transitions", resp.data)
        self.assertIsInstance(resp.data["allowed_transitions"], list)


# ---------------------------------------------------------------------------
# List filters
# ---------------------------------------------------------------------------

class EventListFilterTests(EventTestBase):

    def setUp(self):
        super().setUp()
        # user1 creates a DRAFT event
        resp = self.client.post(EVENTS_URL, {"name": "Filter Test Draft"})
        self.draft_slug = resp.data["slug"]
        # transition to SUBMISSIONS_OPEN
        self.client.post(transition_url(self.draft_slug), {"to": "SUBMISSIONS_OPEN"})
        # user2 creates another event
        self.client.force_authenticate(user=self.user2)
        resp2 = self.client.post(EVENTS_URL, {"name": "Bob Event"})
        self.bob_slug = resp2.data["slug"]
        self.client.force_authenticate(user=self.user1)

    def test_status_filter(self):
        resp = self.client.get(EVENTS_URL, {"status": "SUBMISSIONS_OPEN"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for event in resp.data["results"]:
            self.assertEqual(event["status"], "SUBMISSIONS_OPEN")

    def test_organizer_filter_by_username(self):
        resp = self.client.get(EVENTS_URL, {"organizer": "bob"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for event in resp.data["results"]:
            self.assertEqual(event["organizer_username"], "bob")

    def test_search_filter(self):
        resp = self.client.get(EVENTS_URL, {"search": "Bob"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        slugs = [e["slug"] for e in resp.data["results"]]
        self.assertIn(self.bob_slug, slugs)
        self.assertNotIn(self.draft_slug, slugs)


# ---------------------------------------------------------------------------
# Event-scoped catalog: GET /api/events/{slug}/games/
# ---------------------------------------------------------------------------

class EventGamesEndpointTests(EventTestBase):
    """Only games with active copies in THIS event are returned (event-scoped)."""

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {"name": "Games Endpoint Event"})
        self.slug = resp.data["slug"]
        event = TradeEvent.objects.get(slug=self.slug)
        # user2 owns a second copy of game1; game1 ends with 2 copies, game2 with 1.
        self.copy1b = Copy.objects.create(owner=self.user2, board_game=self.game1)
        EventListing.objects.create(event=event, copy=self.copy1)
        EventListing.objects.create(event=event, copy=self.copy1b)
        EventListing.objects.create(event=event, copy=self.copy2)

    def test_lists_only_games_with_copies_in_event(self):
        resp = self.client.get(games_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {g["bgg_id"] for g in resp.data["results"]}
        self.assertEqual(ids, {self.game1.bgg_id, self.game2.bgg_id})

    def test_copies_count_per_game(self):
        resp = self.client.get(games_url(self.slug))
        by_id = {g["bgg_id"]: g["copies_count"] for g in resp.data["results"]}
        self.assertEqual(by_id[self.game1.bgg_id], 2)
        self.assertEqual(by_id[self.game2.bgg_id], 1)

    def test_inactive_listing_excluded(self):
        EventListing.objects.filter(event__slug=self.slug, copy=self.copy2).update(active=False)
        resp = self.client.get(games_url(self.slug))
        ids = {g["bgg_id"] for g in resp.data["results"]}
        self.assertNotIn(self.game2.bgg_id, ids)

    def test_search_filters_and_does_not_404_event(self):
        # Regression: ?search= must filter games, NOT the event lookup (which the
        # viewset's list filter would 404).
        resp = self.client.get(games_url(self.slug), {"search": self.game1.name[:5]})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {g["bgg_id"] for g in resp.data["results"]}
        self.assertIn(self.game1.bgg_id, ids)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(games_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ---------------------------------------------------------------------------
# Money trading config (event flags + participant budget)
# ---------------------------------------------------------------------------

class MoneyConfigTests(EventTestBase):

    def setUp(self):
        super().setUp()
        resp = self.client.post(EVENTS_URL, {
            "name": "Money Event",
            "money_enabled": True,
            "max_money_per_user": "50.00",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.slug = resp.data["slug"]

    def test_create_persists_money_config(self):
        resp = self.client.get(event_url(self.slug))
        self.assertTrue(resp.data["money_enabled"])
        self.assertEqual(resp.data["max_money_per_user"], "50.00")

    def test_money_defaults_off(self):
        resp = self.client.post(EVENTS_URL, {"name": "Plain Event"})
        self.assertFalse(resp.data["money_enabled"])
        self.assertIsNone(resp.data["max_money_per_user"])

    def test_negative_cap_rejected(self):
        resp = self.client.post(EVENTS_URL, {
            "name": "Bad Cap", "money_enabled": True, "max_money_per_user": "-5",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_join_sets_max_spend(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(join_url(self.slug), {"max_spend": "30.00"}, format="json")
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED))
        self.assertEqual(resp.data["max_spend"], "30.00")
        p = EventParticipation.objects.get(event__slug=self.slug, user=self.user2)
        self.assertEqual(str(p.max_spend), "30.00")

    def test_max_spend_capped(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(join_url(self.slug), {"max_spend": "999"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_max_spend_ignored_when_money_disabled(self):
        resp = self.client.post(EVENTS_URL, {"name": "No Money"})
        slug = resp.data["slug"]
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(join_url(slug), {"max_spend": "30"}, format="json")
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED))
        self.assertEqual(str(resp.data["max_spend"]), "0.00")
