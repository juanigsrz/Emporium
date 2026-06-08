"""
matching/test_external_solver.py

Tests for the external FastTradeMaximizer bridge (matching/external_solver.py)
and the matching-mode routing / export / upload endpoints.

Covers:
    Export ONETOONE (OLWLG) — per-listing lines, BOARD_GAME expansion, own +
      blocked exclusion, empty-wants line.
    Export XTOY — `(NforM)` header, give/take codes, block filtering.
    Parsers — ftm (loops, blank-line grouping) and gurobi (give->take).
    Upload XTOY — gurobi stdout -> DONE run + TradeAssignment rows; component
      grouping; schema parity; error handling (unknown code, perms, status).
    Online ONETOONE run — modal call mocked; routing via MATCHING_USE_ONLINE_SOLVER.
    POST /matches/ on an XTOY event -> 400.
"""

from unittest.mock import patch

from django.test import override_settings
from rest_framework import status

from accounts.models import UserBlock
from events.models import TradeEvent
from matching.models import MatchRun, TradeAssignment
from matching import external_solver
from matching.tests import MatchingTestBase


def export_url(slug):
    return f"/api/events/{slug}/wants-export/"


def upload_url(slug):
    return f"/api/events/{slug}/matches/upload/"


def matches_url(slug):
    return f"/api/events/{slug}/matches/"


# ---------------------------------------------------------------------------
# Export — ONETOONE (OLWLG)
# ---------------------------------------------------------------------------

class ExportOneToOneTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice offers brass (el_a1), wants terra; bob offers terra (el_b1), wants brass
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_header_and_per_listing_lines(self):
        text = external_solver.build_wants(self.event)
        self.assertIn("#! REQUIRE-COLONS REQUIRE-USERNAMES", text)
        # One line per active listing (6) + header
        self.assertEqual(len([l for l in text.splitlines() if l]), 7)

    def test_board_game_want_expands_to_others_copies(self):
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a1.listing_code)
        # alice wants terra -> bob's terra (el_b1) and carol's terra (el_c2)
        self.assertIn(self.copy_b1.listing_code, line)
        self.assertIn(self.copy_c2.listing_code, line)
        # never her own copy
        self.assertNotIn(self.copy_a1.listing_code, line.split(":", 1)[1])

    def test_listing_without_wants_has_empty_wishlist(self):
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a2.listing_code)  # alice's ark, no wish
        self.assertTrue(line.rstrip().endswith(":"))

    def test_block_excludes_blocked_owners_copy(self):
        UserBlock.objects.create(blocker=self.user_a, blocked=self.user_b)
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a1.listing_code)
        wishlist = line.split(":", 1)[1]
        self.assertNotIn(self.copy_b1.listing_code, wishlist)  # bob blocked
        self.assertIn(self.copy_c2.listing_code, wishlist)     # carol still ok

    def test_export_endpoint_organizer_only(self):
        self.client.force_authenticate(user=self.user_b)
        self.assertEqual(
            self.client.get(export_url(self.slug)).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("text/plain", resp["Content-Type"])
        self.assertIn("attachment", resp["Content-Disposition"])

    def _line_for(self, text, code):
        for line in text.splitlines():
            if f" {code} :" in line:
                return line
        self.fail(f"no line for {code}")


# ---------------------------------------------------------------------------
# Export — XTOY (gurobi)
# ---------------------------------------------------------------------------

class ExportXToYTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
        cls.event.save(update_fields=["matching_mode"])
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_nforM_lines(self):
        text = external_solver.build_wants(self.event)
        lines = [l for l in text.splitlines() if l]
        self.assertEqual(len(lines), 2)  # one per wish (no header)
        for line in lines:
            self.assertTrue(line.startswith("(1for1) "))
            self.assertIn(" -> ", line)

    def test_give_and_take_codes(self):
        text = external_solver.build_wants(self.event)
        line = next(l for l in text.splitlines() if self.copy_a1.listing_code in l.split("->")[0])
        give, take = line.split("->")
        self.assertIn(self.copy_a1.listing_code, give)
        self.assertIn(self.copy_b1.listing_code, take)  # bob terra
        self.assertIn(self.copy_c2.listing_code, take)  # carol terra


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

class ParserTests(MatchingTestBase):

    def test_parse_ftm_edges_and_grouping(self):
        out = (
            "FastTradeMaximizer\n"
            "TRADE LOOPS (2 total trades):\n\n"
            "(BOB) C-B1 receives (ALICE) C-A1\n"
            "(ALICE) C-A1 receives (BOB) C-B1\n\n"
            "ITEM SUMMARY (2 total trades):\n"
            "junk\n"
        )
        edges = external_solver.parse_ftm(out)
        # moved = give tag (right side); receiver anchor = recv tag (left side)
        self.assertEqual(edges, [("C-A1", "C-B1", 0), ("C-B1", "C-A1", 0)])

    def test_parse_ftm_blank_line_splits_loops(self):
        out = (
            "TRADE LOOPS (2 total trades):\n\n"
            "(B) C-B receives (A) C-A\n\n"
            "(D) C-D receives (C) C-C\n"
        )
        edges = external_solver.parse_ftm(out)
        self.assertEqual([e[2] for e in edges], [0, 1])

    def test_parse_gurobi_edges(self):
        out = "Trade Results:\nC-A1 -> C-B1\nC-B1 -> C-A1\n"
        edges = external_solver.parse_gurobi(out)
        self.assertEqual(edges, [("C-B1", "C-A1", None), ("C-A1", "C-B1", None)])

    def test_parse_gurobi_nforM_multi_take(self):
        out = "Trade Results:\nC-X C-Y -> C-A\nC-A C-B -> C-C\nC-C -> C-B\n"
        edges = external_solver.parse_gurobi(out)
        # 3 moved items (one per take token)
        self.assertEqual([e[0] for e in edges], ["C-A", "C-C", "C-B"])
        self.assertTrue(all(e[2] is None for e in edges))


# ---------------------------------------------------------------------------
# Upload — XTOY
# ---------------------------------------------------------------------------

class UploadXToYTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
        cls.event.save(update_fields=["matching_mode"])
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def _solution(self):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        return f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"

    def test_upload_creates_done_run_with_assignments(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._solution(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.status, MatchRun.Status.DONE)
        self.assertEqual(run.algorithm, "gurobi-xy")

        assignments = TradeAssignment.objects.filter(match_run=run)
        self.assertEqual(assignments.count(), 2)
        # moved a1 (alice's brass) -> received by bob; moved b1 -> received by alice
        a1_row = assignments.get(event_listing=self.el_a1)
        self.assertEqual(a1_row.giver, self.user_a)
        self.assertEqual(a1_row.receiver, self.user_b)
        b1_row = assignments.get(event_listing=self.el_b1)
        self.assertEqual(b1_row.giver, self.user_b)
        self.assertEqual(b1_row.receiver, self.user_a)

    def test_upload_groups_into_one_component(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._solution(), content_type="text/plain"
        )
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.summary["cycles"], 1)  # one connected component
        cids = set(
            TradeAssignment.objects.filter(match_run=run).values_list("cycle_id", flat=True)
        )
        self.assertEqual(cids, {1})

    def test_upload_result_schema_parity(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._solution(), content_type="text/plain"
        )
        run = MatchRun.objects.get(pk=resp.data["id"])
        for key in ("algorithm", "generated_at", "cycles", "unmatched", "stats"):
            self.assertIn(key, run.result)
        step = run.result["cycles"][0]["steps"][0]
        for key in ("listing_code", "board_game", "from_user", "to_user", "wish_id"):
            self.assertIn(key, step)

    def test_upload_unknown_code_400_and_nothing_persisted(self):
        resp = self.client.post(
            upload_url(self.slug),
            data="Trade Results:\nC-NOPEAA -> C-NOPEBB\n",
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_upload_non_organizer_403(self):
        self.client.force_authenticate(user=self.user_b)
        resp = self.client.post(
            upload_url(self.slug), data=self._solution(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_upload_wrong_status_400(self):
        draft = TradeEvent.objects.create(
            name="Draft XToY", organizer=self.user_a,
            status=TradeEvent.Status.DRAFT,
            matching_mode=TradeEvent.MatchingMode.XTOY,
        )
        resp = self.client.post(
            upload_url(draft.slug), data="Trade Results:\n", content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_matches_on_xtoy_event_400(self):
        resp = self.client.post(matches_url(self.slug), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Online ONETOONE run (modal mocked)
# ---------------------------------------------------------------------------

@override_settings(MATCHING_USE_ONLINE_SOLVER=True)
class OnlineRunTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def _ftm_output(self):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        return (
            "TRADE LOOPS (2 total trades):\n\n"
            f"({self.user_b.username}) {b1} receives ({self.user_a.username}) {a1}\n"
            f"({self.user_a.username}) {a1} receives ({self.user_b.username}) {b1}\n\n"
            "ITEM SUMMARY (2 total trades):\n"
        )

    def test_post_matches_calls_modal_and_loads(self):
        with patch.object(
            external_solver, "call_online_solver", return_value=self._ftm_output()
        ) as mocked:
            resp = self.client.post(matches_url(self.slug), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        mocked.assert_called_once()

        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.status, MatchRun.Status.DONE)
        self.assertEqual(run.algorithm, "ftm-online")
        self.assertEqual(run.summary["cycles"], 1)
        self.assertEqual(run.summary["matched_wishes"], 2)
        self.assertEqual(TradeAssignment.objects.filter(match_run=run).count(), 2)


# ---------------------------------------------------------------------------
# Money / duplicate-protection placeholder header (comments, ignored by parsers)
# ---------------------------------------------------------------------------

class PlaceholderHeaderTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        from events.models import EventParticipation
        cls.event.money_enabled = True
        cls.event.max_money_per_user = 50
        cls.event.save(update_fields=["money_enabled", "max_money_per_user"])
        EventParticipation.objects.create(
            event=cls.event, user=cls.user_a, max_spend=25
        )
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_a.want_group.duplicate_protection = True
        cls.wish_a.want_group.save(update_fields=["duplicate_protection"])
        item = cls.wish_a.want_group.items.first()
        item.money_amount = 30   # buy bid P
        item.save(update_fields=["money_amount"])
        # sell ask Q on the offered listing (el_a1)
        ogi = cls.wish_a.offer_group.items.first()
        ogi.money_amount = 20
        ogi.save(update_fields=["money_amount"])

    def test_header_has_money_budget_dup_and_money_want(self):
        text = external_solver.build_wants(self.event)
        self.assertIn("#! MONEY-ENABLED max_per_user=50.00", text)
        self.assertIn(f"#! BUDGET ({self.user_a.username}) 25.00", text)
        self.assertIn(f"#! DUP-PROTECT ({self.user_a.username}) wish={self.wish_a.id}", text)
        self.assertIn(
            f"#! MONEY-WANT ({self.user_a.username}) game={self.game_terra.bgg_id} max=30.00",
            text,
        )
        self.assertIn(
            f"#! MONEY-OFFER ({self.user_a.username}) listing={self.copy_a1.listing_code} min=20.00",
            text,
        )

    def test_header_comments_do_not_break_parsers(self):
        # ftm parser only reads after 'TRADE LOOPS'; comment lines must be ignored.
        text = external_solver.build_wants(self.event)
        self.assertEqual(external_solver.parse_ftm(text), [])
        self.assertEqual(external_solver.parse_gurobi(text), [])

    def test_no_header_when_money_disabled_and_no_dup(self):
        self.event.money_enabled = False
        self.event.save(update_fields=["money_enabled"])
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn("#!", text.replace("#! REQUIRE-COLONS REQUIRE-USERNAMES", ""))
