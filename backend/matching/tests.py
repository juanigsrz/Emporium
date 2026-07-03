"""
matching/tests.py

F6 Matching test suite covering DESIGN §7 scenarios.

Tests:
    1.  Simple 2-cycle: A gives g1 → B, B gives g2 → A; both matched.
    2.  3-cycle: A → B → C → A; all three matched.
    3.  M-to-N partial: offer max_give=2 but only 1 matched — respects "up to X".
    4.  Unmatched wish reported (no viable counterpart).
    5.  BLOCKED users never paired in a cycle.
    6.  Result JSON conforms to schema keys (algorithm, generated_at, cycles, unmatched, stats).
    7.  Assignments created with correct cycle_id, giver, receiver, listing_code.
    8.  X/Y bounds respected (given_count ≤ max_give; matched only if received ≥ min_receive).
    9.  /matches/ list returns newest-first; POST returns {id, status}.
    10. /matches/{id}/ detail returns status/summary/log.
    11. /matches/{id}/result/ returns full result JSON (400 if not DONE).
    12. /matches/{id}/mine/ returns only requesting user's assignments with display companions.
    13. POST /matches/ by non-organizer → 403.
    14. POST /matches/ when event not in MATCHING status → 400.
"""

import csv
import os
import tempfile

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import UserBlock
from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv
from copies.models import Copy
from events.models import EventListing, TradeEvent
from trades.models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish
from matching.models import MatchRun, TradeAssignment

User = get_user_model()


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def matches_url(slug):
    return f"/api/events/{slug}/matches/"


def match_url(slug, run_id):
    return f"/api/events/{slug}/matches/{run_id}/"


def match_result_url(slug, run_id):
    return f"/api/events/{slug}/matches/{run_id}/result/"


def match_mine_url(slug, run_id):
    return f"/api/events/{slug}/matches/{run_id}/mine/"


# ---------------------------------------------------------------------------
# CSV helper
# ---------------------------------------------------------------------------

SAMPLE_ROWS = [
    {"id": "224517", "name": "Brass: Birmingham",  "yearpublished": "2018", "rank": "1",
     "bayesaverage": "8.39", "average": "8.56", "usersrated": "58000", "is_expansion": "0"},
    {"id": "342942", "name": "Ark Nova",           "yearpublished": "2021", "rank": "2",
     "bayesaverage": "8.35", "average": "8.54", "usersrated": "61000", "is_expansion": "0"},
    {"id": "167791", "name": "Terraforming Mars",  "yearpublished": "2016", "rank": "5",
     "bayesaverage": "8.10", "average": "8.40", "usersrated": "120000", "is_expansion": "0"},
    {"id": "220308", "name": "Gaia Project",       "yearpublished": "2017", "rank": "6",
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
# Base: setup users, games, copies, event
# ---------------------------------------------------------------------------

class MatchingTestBase(APITestCase):
    """
    Creates:
        user_a (alice, organizer), user_b (bob), user_c (carol)
        4 games: brass, ark, terra, gaia
        Each user has 2 copies. All listed in a MATCHING-status event.
    """

    @classmethod
    def setUpTestData(cls):
        csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=csv_path)
        os.unlink(csv_path)

        cls.user_a = User.objects.create_user("alice", "alice@example.com", "pass1234")
        cls.user_b = User.objects.create_user("bob",   "bob@example.com",   "pass1234")
        cls.user_c = User.objects.create_user("carol", "carol@example.com", "pass1234")

        cls.game_brass = BoardGame.objects.get(bgg_id=224517)
        cls.game_ark   = BoardGame.objects.get(bgg_id=342942)
        cls.game_terra = BoardGame.objects.get(bgg_id=167791)
        cls.game_gaia  = BoardGame.objects.get(bgg_id=220308)

        # alice: brass + ark
        cls.copy_a1 = Copy.objects.create(owner=cls.user_a, board_game=cls.game_brass)
        cls.copy_a2 = Copy.objects.create(owner=cls.user_a, board_game=cls.game_ark)
        # bob: terra + gaia
        cls.copy_b1 = Copy.objects.create(owner=cls.user_b, board_game=cls.game_terra)
        cls.copy_b2 = Copy.objects.create(owner=cls.user_b, board_game=cls.game_gaia)
        # carol: brass copy 2 + terra copy 2
        cls.copy_c1 = Copy.objects.create(owner=cls.user_c, board_game=cls.game_brass)
        cls.copy_c2 = Copy.objects.create(owner=cls.user_c, board_game=cls.game_terra)

        cls.event = TradeEvent.objects.create(
            name="Match Test Event 2026",
            organizer=cls.user_a,
            status=TradeEvent.Status.MATCHING,
        )
        cls.slug = cls.event.slug

        cls.el_a1 = EventListing.objects.create(event=cls.event, copy=cls.copy_a1)  # alice's brass
        cls.el_a2 = EventListing.objects.create(event=cls.event, copy=cls.copy_a2)  # alice's ark
        cls.el_b1 = EventListing.objects.create(event=cls.event, copy=cls.copy_b1)  # bob's terra
        cls.el_b2 = EventListing.objects.create(event=cls.event, copy=cls.copy_b2)  # bob's gaia
        cls.el_c1 = EventListing.objects.create(event=cls.event, copy=cls.copy_c1)  # carol's brass
        cls.el_c2 = EventListing.objects.create(event=cls.event, copy=cls.copy_c2)  # carol's terra

    def setUp(self):
        self.client.force_authenticate(user=self.user_a)

    # -----------------------------------------------------------------------
    # Convenience: build a simple 1-to-1 TradeWish for a user
    # -----------------------------------------------------------------------

    @classmethod
    def _make_wish(cls, user, offer_listing, want_game=None, want_listing=None,
                   max_give=1, min_receive=1):
        """Create an OfferGroup + WantGroup + TradeWish. Returns the TradeWish."""
        og = OfferGroup.objects.create(
            event=cls.event, user=user, name=f"OG-{user.username}-{offer_listing.pk}",
            max_give=max_give,
        )
        OfferGroupItem.objects.create(offer_group=og, event_listing=offer_listing)

        wg = WantGroup.objects.create(
            event=cls.event, user=user, name=f"WG-{user.username}",
            min_receive=min_receive,
        )
        if want_game:
            # "Want any copy of game" → every other-owned listing of that game.
            for el in EventListing.objects.filter(
                event=cls.event, copy__board_game=want_game
            ).exclude(copy__owner=user):
                WantGroupItem.objects.create(want_group=wg, event_listing=el)
        elif want_listing:
            WantGroupItem.objects.create(want_group=wg, event_listing=want_listing)

        return TradeWish.objects.create(
            event=cls.event, user=user, offer_group=og, want_group=wg, active=True
        )

    @classmethod
    def _make_wish_multi_offer(cls, user, offer_listings, want_games,
                               max_give=2, min_receive=1):
        """Create a wish with multiple offer items and multiple want targets."""
        og = OfferGroup.objects.create(
            event=cls.event, user=user, name=f"OG-multi-{user.username}",
            max_give=max_give,
        )
        for el in offer_listings:
            OfferGroupItem.objects.create(offer_group=og, event_listing=el)

        wg = WantGroup.objects.create(
            event=cls.event, user=user, name=f"WG-multi-{user.username}",
            min_receive=min_receive,
        )
        for game in want_games:
            for el in EventListing.objects.filter(
                event=cls.event, copy__board_game=game
            ).exclude(copy__owner=user):
                WantGroupItem.objects.create(want_group=wg, event_listing=el)

        return TradeWish.objects.create(
            event=cls.event, user=user, offer_group=og, want_group=wg, active=True
        )


# ---------------------------------------------------------------------------
# Helper: trigger a match run directly and return MatchRun
# ---------------------------------------------------------------------------

def _run_match_direct(event) -> MatchRun:
    """Create a MatchRun and execute it (CELERY_TASK_ALWAYS_EAGER=True → sync)."""
    run = MatchRun.objects.create(event=event, status=MatchRun.Status.PENDING)
    from matching.tasks import run_match
    run_match(run.pk)
    run.refresh_from_db()
    return run


# ---------------------------------------------------------------------------
# 1. Simple 2-cycle
# ---------------------------------------------------------------------------

class TwoCycleTest(MatchingTestBase):
    """
    alice offers brass, wants terra.
    bob offers terra, wants brass.
    → 1 cycle of length 2, both matched.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_two_cycle_creates_cycle_and_assignments(self):
        run = _run_match_direct(self.event)

        self.assertEqual(run.status, MatchRun.Status.DONE)
        result = run.result
        self.assertEqual(len(result["cycles"]), 1)
        cycle = result["cycles"][0]
        self.assertEqual(cycle["length"], 2)
        self.assertEqual(len(cycle["steps"]), 2)

        # Assignments created
        assignments = TradeAssignment.objects.filter(match_run=run)
        self.assertEqual(assignments.count(), 2)

        # alice gives to bob and receives from bob
        alice_gives = assignments.filter(giver=self.user_a).first()
        self.assertIsNotNone(alice_gives)
        self.assertEqual(alice_gives.receiver, self.user_b)

        bob_gives = assignments.filter(giver=self.user_b).first()
        self.assertIsNotNone(bob_gives)
        self.assertEqual(bob_gives.receiver, self.user_a)

    def test_two_cycle_result_schema_keys(self):
        run = _run_match_direct(self.event)
        result = run.result

        # Top-level keys
        for key in ("algorithm", "generated_at", "cycles", "unmatched", "stats"):
            self.assertIn(key, result, f"Missing top-level key: {key}")

        # Cycle keys
        cycle = result["cycles"][0]
        for key in ("id", "length", "steps"):
            self.assertIn(key, cycle, f"Missing cycle key: {key}")

        # Step keys
        step = cycle["steps"][0]
        for key in ("listing_code", "board_game", "from_user", "to_user", "wish_id"):
            self.assertIn(key, step, f"Missing step key: {key}")

        # Stats keys
        stats = result["stats"]
        for key in ("users", "listings", "matched", "cycles"):
            self.assertIn(key, stats, f"Missing stats key: {key}")

    def test_two_cycle_summary(self):
        run = _run_match_direct(self.event)
        self.assertEqual(run.summary["cycles"], 1)
        self.assertEqual(run.summary["matched_wishes"], 2)
        self.assertEqual(run.summary["unmatched"], 0)


# ---------------------------------------------------------------------------
# 2. 3-cycle
# ---------------------------------------------------------------------------

class ThreeCycleTest(MatchingTestBase):
    """
    alice offers ark (wants terra).
    bob offers gaia (wants ark).
    carol offers terra (wants gaia).
    A→B: alice gives ark to bob (bob wants ark)
    B→C: bob gives gaia to carol (carol wants gaia)
    C→A: carol gives terra to alice (alice wants terra)
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice offers ark, wants terra
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a2, want_game=cls.game_terra)
        # bob offers gaia, wants ark
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b2, want_game=cls.game_ark)
        # carol offers terra, wants gaia
        cls.wish_c = cls._make_wish(cls.user_c, cls.el_c2, want_game=cls.game_gaia)

    def test_three_cycle_created(self):
        run = _run_match_direct(self.event)

        self.assertEqual(run.status, MatchRun.Status.DONE)
        result = run.result

        # Should have 1 cycle of length 3
        self.assertEqual(len(result["cycles"]), 1)
        cycle = result["cycles"][0]
        self.assertEqual(cycle["length"], 3)
        self.assertEqual(len(cycle["steps"]), 3)

    def test_three_cycle_assignments(self):
        run = _run_match_direct(self.event)

        assignments = TradeAssignment.objects.filter(match_run=run)
        self.assertEqual(assignments.count(), 3)

        # All 3 users are givers
        givers = set(assignments.values_list("giver__username", flat=True))
        self.assertEqual(givers, {"alice", "bob", "carol"})

        # All 3 users are receivers
        receivers = set(assignments.values_list("receiver__username", flat=True))
        self.assertEqual(receivers, {"alice", "bob", "carol"})

    def test_three_cycle_summary(self):
        run = _run_match_direct(self.event)
        self.assertEqual(run.summary["cycles"], 1)
        self.assertEqual(run.summary["matched_wishes"], 3)
        self.assertEqual(run.summary["unmatched"], 0)


# ---------------------------------------------------------------------------
# 3. M-to-N partial: max_give=2 but only 1 matched
# ---------------------------------------------------------------------------

class MToNPartialTest(MatchingTestBase):
    """
    alice offers [brass, ark], max_give=2, wants terra (min_receive=1).
    bob offers terra, max_give=1, wants brass.
    → Only 1 listing moves from alice to bob (not both); alice's X=2 not exceeded.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice: offers both brass and ark, max_give=2, wants terra, min_receive=1
        cls.wish_a = cls._make_wish_multi_offer(
            cls.user_a,
            offer_listings=[cls.el_a1, cls.el_a2],
            want_games=[cls.game_terra],
            max_give=2,
            min_receive=1,
        )
        # bob: offers terra, max_give=1, wants brass (game)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass, max_give=1)

    def test_partial_match_honors_max_give(self):
        run = _run_match_direct(self.event)

        self.assertEqual(run.status, MatchRun.Status.DONE)
        result = run.result

        # 1 cycle, 2 steps
        self.assertEqual(len(result["cycles"]), 1)
        cycle = result["cycles"][0]
        self.assertEqual(cycle["length"], 2)

        # alice's assignments: only 1 listing given (not both)
        alice_given = TradeAssignment.objects.filter(
            match_run=run, giver=self.user_a
        ).count()
        self.assertEqual(alice_given, 1)  # only 1 of max_give=2 was used

    def test_partial_match_wish_matched_when_y_satisfied(self):
        run = _run_match_direct(self.event)
        # alice received 1 listing and min_receive=1, so both wishes are satisfied
        self.assertEqual(run.summary["matched_wishes"], 2)


# ---------------------------------------------------------------------------
# 4. Unmatched wish reported
# ---------------------------------------------------------------------------

class UnmatchedWishTest(MatchingTestBase):
    """
    alice offers brass, wants gaia.
    Nobody offers gaia → alice is unmatched; reported in result["unmatched"].
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_gaia)
        # No one offers gaia; bob has gaia but has no wish

    def test_unmatched_wish_reported(self):
        run = _run_match_direct(self.event)

        self.assertEqual(run.status, MatchRun.Status.DONE)
        result = run.result

        self.assertEqual(len(result["cycles"]), 0)
        self.assertEqual(len(result["unmatched"]), 1)
        self.assertEqual(result["unmatched"][0]["wish_id"], self.wish_a.id)
        self.assertIn("reason", result["unmatched"][0])

    def test_unmatched_summary(self):
        run = _run_match_direct(self.event)
        self.assertEqual(run.summary["unmatched"], 1)
        self.assertEqual(run.summary["matched_wishes"], 0)
        self.assertEqual(run.summary["cycles"], 0)


# ---------------------------------------------------------------------------
# 5. BLOCKED users never paired
# ---------------------------------------------------------------------------

class BlockedUsersTest(MatchingTestBase):
    """
    alice and bob would form a natural 2-cycle, but they have a block.
    → No cycle; both unmatched.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)
        # alice blocks bob
        UserBlock.objects.create(blocker=cls.user_a, blocked=cls.user_b)

    def test_blocked_pair_not_matched(self):
        run = _run_match_direct(self.event)

        self.assertEqual(run.status, MatchRun.Status.DONE)
        result = run.result

        # No cycle involving both alice and bob
        for cycle in result["cycles"]:
            users_in_cycle = set()
            for step in cycle["steps"]:
                users_in_cycle.add(step["from_user"])
                users_in_cycle.add(step["to_user"])
            self.assertFalse(
                "alice" in users_in_cycle and "bob" in users_in_cycle,
                "Blocked pair (alice, bob) must not appear in the same cycle"
            )

    def test_blocked_pair_reported_unmatched(self):
        run = _run_match_direct(self.event)
        result = run.result
        # Both wishes should be unmatched (no viable partner)
        unmatched_ids = {u["wish_id"] for u in result["unmatched"]}
        self.assertIn(self.wish_a.id, unmatched_ids)
        self.assertIn(self.wish_b.id, unmatched_ids)


# ---------------------------------------------------------------------------
# 6. API: list, detail, POST
# ---------------------------------------------------------------------------

class MatchRunAPITest(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_post_match_returns_id_and_status(self):
        resp = self.client.post(matches_url(self.slug), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIn("id", resp.data)
        self.assertIn("status", resp.data)

    def test_post_match_run_completes_eagerly(self):
        resp = self.client.post(matches_url(self.slug), format="json")
        run_id = resp.data["id"]
        run = MatchRun.objects.get(pk=run_id)
        # CELERY_TASK_ALWAYS_EAGER → runs synchronously → should be DONE
        self.assertEqual(run.status, MatchRun.Status.DONE)

    def test_list_returns_newest_first(self):
        r1 = _run_match_direct(self.event)
        r2 = _run_match_direct(self.event)

        resp = self.client.get(matches_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in resp.data["results"]]
        # newest first: r2 > r1
        self.assertGreater(ids[0], ids[1])

    def test_detail_has_required_fields(self):
        run = _run_match_direct(self.event)
        resp = self.client.get(match_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for field in ("id", "event", "status", "algorithm", "summary", "log",
                      "started_at", "finished_at", "created", "updated"):
            self.assertIn(field, resp.data, f"Missing field: {field}")

    def test_detail_status_done(self):
        run = _run_match_direct(self.event)
        resp = self.client.get(match_url(self.slug, run.pk))
        self.assertEqual(resp.data["status"], "DONE")


# ---------------------------------------------------------------------------
# 7. Result endpoint
# ---------------------------------------------------------------------------

class MatchRunResultAPITest(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_result_returns_schema_compliant_json(self):
        run = _run_match_direct(self.event)
        resp = self.client.get(match_result_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data
        for key in ("algorithm", "generated_at", "cycles", "unmatched", "stats"):
            self.assertIn(key, data, f"Missing key: {key}")
        self.assertEqual(data["algorithm"], "fake")

    def test_result_400_if_not_done(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.PENDING)
        resp = self.client.get(match_result_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# 8. Mine endpoint
# ---------------------------------------------------------------------------

class MatchRunMineAPITest(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_mine_returns_only_requesting_user_assignments(self):
        run = _run_match_direct(self.event)

        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(match_mine_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        for assignment in resp.data["results"]:
            involved = {assignment["giver_username"], assignment["receiver_username"]}
            self.assertIn("alice", involved, "alice should appear in every returned assignment")

    def test_mine_display_companions_present(self):
        run = _run_match_direct(self.event)

        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(match_mine_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(len(resp.data["results"]) > 0, "alice should have at least one assignment")

        assignment = resp.data["results"][0]
        for field in ("giver", "giver_username", "receiver", "receiver_username",
                      "listing_code", "board_game_name", "cycle_id"):
            self.assertIn(field, assignment, f"Missing field: {field}")

        self.assertTrue(assignment["listing_code"].startswith("C-"))

    def test_mine_bob_only_sees_his_assignments(self):
        run = _run_match_direct(self.event)

        self.client.force_authenticate(user=self.user_b)
        resp = self.client.get(match_mine_url(self.slug, run.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        for assignment in resp.data["results"]:
            involved = {assignment["giver_username"], assignment["receiver_username"]}
            self.assertIn("bob", involved)


# ---------------------------------------------------------------------------
# 9. Non-organizer POST → 403
# ---------------------------------------------------------------------------

class MatchPermissionTest(MatchingTestBase):

    def test_non_organizer_post_returns_403(self):
        self.client.force_authenticate(user=self.user_b)
        resp = self.client.post(matches_url(self.slug), format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ---------------------------------------------------------------------------
# 10. Event not in MATCHING status → 400
# ---------------------------------------------------------------------------

class MatchStatusValidationTest(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.event_draft = TradeEvent.objects.create(
            name="Draft Event For Match Test",
            organizer=cls.user_a,
            status=TradeEvent.Status.DRAFT,
        )

    def test_post_on_non_matching_event_returns_400(self):
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.post(
            matches_url(self.event_draft.slug), format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
