"""
matching/test_external_solver.py

Tests for the external FastTradeMaximizer (gurobi) bridge
(matching/external_solver.py) and the export / upload endpoints.

Covers:
    Export — `(NforM)` header, give/take codes, block filtering, money directives.
    Parsers — gurobi (give->take, cash, summary, settlement).
    Upload — gurobi stdout -> DONE run + TradeAssignment rows; component grouping;
      schema parity; error handling (unknown code, perms, status).
"""

from rest_framework import status

from events.models import TradeEvent
from matching.models import MatchRun, TradeAssignment
from matching import external_solver
from matching.tests import MatchingTestBase


def export_url(slug):
    return f"/api/events/{slug}/wants-export/"


def upload_url(slug):
    return f"/api/events/{slug}/matches/upload/"


# ---------------------------------------------------------------------------
# Export (gurobi)
# ---------------------------------------------------------------------------

class ExportXToYTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

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

    def test_nforM_lines(self):
        text = external_solver.build_wants(self.event)
        lines = [l for l in text.splitlines() if l and not l.startswith("#")]
        self.assertEqual(len(lines), 2)  # one per wish
        for line in lines:
            self.assertRegex(line, r"^\S+ : \(1for1\) ")
            self.assertIn(" -> ", line)

    def test_give_and_take_codes(self):
        text = external_solver.build_wants(self.event)
        line = next(l for l in text.splitlines() if self.copy_a1.listing_code in l.split("->")[0])
        give, take = line.split("->")
        self.assertIn(self.copy_a1.listing_code, give)
        self.assertIn(self.copy_b1.listing_code, take)  # bob terra
        self.assertIn(self.copy_c2.listing_code, take)  # carol terra

    def test_xtoy_money_directives(self):
        """XTOY with money_enabled emits real user/item/bid lines, not #! MONEY-* comments."""
        from events.models import EventParticipation
        self.event.money_enabled = True
        self.event.max_money_per_user = 100
        self.event.save(update_fields=["money_enabled", "max_money_per_user"])
        # alice has a per-participant budget
        EventParticipation.objects.get_or_create(
            event=self.event, user=self.user_a, defaults={"max_spend": 50}
        )
        from trades.models import UserGamePrice
        # Sell ask: per-copy override on alice's offered listing (el_a1 = brass copy)
        self.el_a1.sell_price = 20   # $20.00 -> 2000 cents
        self.el_a1.save(update_fields=["sell_price"])
        # Buy bid: alice's per-game default for terra = $30.00 -> 3000 cents
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=30
        )

        text = external_solver.build_wants(self.event)

        # Real directives must appear
        self.assertIn(f"user {self.user_a.username} budget 5000", text)
        self.assertIn(f"item {self.copy_a1.listing_code} owner {self.user_a.username} ask 2000", text)
        # bid line: alice bids on bob's terra and carol's terra (expanded from game_terra)
        self.assertIn(f"bid {self.user_a.username} {self.copy_b1.listing_code} 3000", text)
        self.assertIn(f"bid {self.user_a.username} {self.copy_c2.listing_code} 3000", text)
        # No old-style comment money lines
        self.assertNotIn("#! MONEY-WANT", text)
        self.assertNotIn("#! MONEY-OFFER", text)
        self.assertNotIn("#! MONEY-ENABLED", text)
        self.assertNotIn("#! BUDGET", text)

        # Clean up (avoid polluting other tests)
        self.event.money_enabled = False
        self.event.save(update_fields=["money_enabled"])


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

class ParserTests(MatchingTestBase):

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

    def test_parse_gurobi_ignores_cash_section(self):
        # Cash lines also contain '->' — they must NOT be parsed as swap edges.
        out = (
            "Trade Results:\nC-A -> C-B\n"
            "\nCash Purchases:\nC-C: carol -> bob  (bob pays carol $5)\n"
            "\nCash Summary:\n  bob: spent $5, earned $0, net $5 (cap $inf)\n"
        )
        edges = external_solver.parse_gurobi(out)
        self.assertEqual(edges, [("C-B", "C-A", None)])

    def test_parse_gurobi_cash_extracts_moves(self):
        out = (
            "Cash Purchases:\n"
            "C-C: carol -> bob  (bob pays carol $500)\n"
            "C-D: dave -> eve  (eve pays dave $700)\n"
            "\nCash Summary:\n  bob: spent $500, earned $0, net $500 (cap $inf)\n"
        )
        moves = external_solver.parse_gurobi_cash(out)
        self.assertEqual(moves, [("C-C", "bob", 500), ("C-D", "eve", 700)])

    def test_trade_assignment_has_cash_amount_field(self):
        from matching.models import TradeAssignment
        f = TradeAssignment._meta.get_field("cash_amount")
        self.assertTrue(f.null)
        self.assertEqual(f.decimal_places, 2)

    def test_trade_assignment_has_item_value_field(self):
        from matching.models import TradeAssignment
        f = TradeAssignment._meta.get_field("item_value")
        self.assertTrue(f.null)
        self.assertEqual(f.max_digits, 10)
        self.assertEqual(f.decimal_places, 2)

    def test_mine_includes_cash_amount(self):
        from matching.serializers import TradeAssignmentSerializer
        self.assertIn("cash_amount", TradeAssignmentSerializer().fields)


# ---------------------------------------------------------------------------
# Upload — XTOY
# ---------------------------------------------------------------------------

class UploadXToYTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def _solution(self):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        return f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"

    def test_upload_with_cash_purchase_creates_assignment(self):
        from decimal import Decimal
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        c1 = self.copy_c1.listing_code
        out = (f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"
               f"\nCash Purchases:\n{c1}: carol -> bob  (bob pays carol $1000)\n"
               f"\nCash Summary:\n  bob: spent $1000, earned $0, net $1000 (cap $inf)\n")
        resp = self.client.post(upload_url(self.slug), data=out, content_type="text/plain")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        cash_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_c1)
        self.assertEqual(cash_row.giver, self.user_c)
        self.assertEqual(cash_row.receiver, self.user_b)
        self.assertEqual(cash_row.cash_amount, Decimal("10.00"))
        self.assertEqual(TradeAssignment.objects.filter(match_run=run).count(), 3)

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
        )
        resp = self.client.post(
            upload_url(draft.slug), data="Trade Results:\n", content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Duplicate protection via __DUMMY nodes
# ---------------------------------------------------------------------------

class DupProtectExportTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice offers brass (el_a1), wants terra — 2 active copies exist
        # (bob's el_b1 / copy_b1, carol's el_c2 / copy_c2).
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_a.want_group.duplicate_protection = True
        cls.wish_a.want_group.save(update_fields=["duplicate_protection"])

    def _dummy_code(self, user, game):
        return f"__DUMMY_{user.username}_{game.pk}"

    def test_multi_copy_game_routed_through_dummy(self):
        text = external_solver.build_wants(self.event)
        dummy = self._dummy_code(self.user_a, self.game_terra)
        # alice's wish line (the one carrying her brass offer)
        main = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a1.listing_code in l
        )
        # take side points at the dummy, not the raw terra copies
        self.assertIn(dummy, main.split(" -> ")[1])
        self.assertNotIn(self.copy_b1.listing_code, main)
        self.assertNotIn(self.copy_c2.listing_code, main)
        # a (1for1) dummy leg lists both real terra copies
        leg = next(l for l in text.splitlines() if f"(1for1) {dummy} ->" in l)
        self.assertIn(self.copy_b1.listing_code, leg)
        self.assertIn(self.copy_c2.listing_code, leg)

    def test_dup_protect_tag_removed(self):
        text = external_solver.build_wants(self.event)
        self.assertNotIn("DUP-PROTECT", text)

    def test_single_copy_game_passes_through(self):
        # alice offers ark (el_a2), wants brass — expands to carol's brass
        # (el_c1 / copy_c1) only; alice's own brass is excluded -> 1 copy.
        wish = self._make_wish(self.user_a, self.el_a2, want_game=self.game_brass)
        wish.want_group.duplicate_protection = True
        wish.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn(self._dummy_code(self.user_a, self.game_brass), text)
        line = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a2.listing_code in l
        )
        self.assertIn(self.copy_c1.listing_code, line.split(" -> ")[1])

    def test_dummy_shared_across_want_groups_for_same_game(self):
        # alice has a SECOND, independent dup-protected want group for terra
        # (offering ark this time). Both wishes must funnel through ONE dummy so
        # she can win at most one terra across both.
        wish2 = self._make_wish(self.user_a, self.el_a2, want_game=self.game_terra)
        wish2.want_group.duplicate_protection = True
        wish2.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        dummy = self._dummy_code(self.user_a, self.game_terra)
        # both wish lines point their take side at the same dummy
        mains = [
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :") and dummy in l.split(" -> ")[1]
        ]
        self.assertEqual(len(mains), 2)
        # exactly one dummy leg for that (user, game)
        legs = [l for l in text.splitlines() if f"(1for1) {dummy} ->" in l]
        self.assertEqual(len(legs), 1)

    def test_no_dummy_when_disabled(self):
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn("__DUMMY", text)
        self.assertNotIn("DUP-PROTECT", text)

    def test_dummy_export_does_not_break_gurobi_parser(self):
        text = external_solver.build_wants(self.event)
        self.assertEqual(external_solver.parse_gurobi(text), [])


# ---------------------------------------------------------------------------
# Money parsers — Cash Summary / Settlement plan
# ---------------------------------------------------------------------------

class MoneyParserTests(MatchingTestBase):

    def test_parse_cash_summary_signed_nets(self):
        out = (
            "Cash Summary:\n"
            "  alice: spent $3000, earned $2000, net $1000 (owes) (cap $inf)\n"
            "  bob: spent $2000, earned $3000, net $-1000 (receives) (cap $inf)\n"
            "\nSettlement plan:\n  alice pays bob $1000\n"
        )
        nets = external_solver.parse_gurobi_cash_summary(out)
        self.assertEqual(nets, {"alice": 1000, "bob": -1000})

    def test_parse_cash_summary_tolerates_missing_direction(self):
        # Hand-written fixtures omit the "(owes)" word; parser must not require it.
        out = "Cash Summary:\n  bob: spent $500, earned $0, net $500 (cap $inf)\n"
        self.assertEqual(external_solver.parse_gurobi_cash_summary(out), {"bob": 500})

    def test_parse_cash_summary_absent_section(self):
        self.assertEqual(
            external_solver.parse_gurobi_cash_summary("Trade Results:\nX -> Y\n"), {}
        )

    def test_parse_settlement_transfers(self):
        out = (
            "Cash Summary:\n  alice: spent $1000, earned $0, net $1000 (cap $inf)\n"
            "\nSettlement plan:\n"
            "  alice pays bob $700\n"
            "  alice pays carol $300\n"
        )
        self.assertEqual(
            external_solver.parse_gurobi_settlement(out),
            [("alice", "bob", 700), ("alice", "carol", 300)],
        )

    def test_parse_settlement_absent_section(self):
        self.assertEqual(
            external_solver.parse_gurobi_settlement("Trade Results:\nX -> Y\n"), []
        )


# ---------------------------------------------------------------------------
# Upload — XTOY money mode (item_value, settlement, reconstruction guard)
# ---------------------------------------------------------------------------

class MoneySettlementUploadTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.event.money_enabled = True
        cls.event.save(update_fields=["money_enabled"])
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)
        # alice's brass ask $20, bob's terra ask $30
        cls.el_a1.sell_price = 20
        cls.el_a1.save(update_fields=["sell_price"])
        cls.el_b1.sell_price = 30
        cls.el_b1.save(update_fields=["sell_price"])

    def _money_solution(self, alice_net=1000):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        bob_net = -alice_net
        return (
            f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"
            f"\nCash Summary:\n"
            f"  {self.user_a.username}: spent $3000, earned $2000, net ${alice_net} (cap $inf)\n"
            f"  {self.user_b.username}: spent $2000, earned $3000, net ${bob_net} (cap $inf)\n"
            f"\nSettlement plan:\n"
            f"  {self.user_a.username} pays {self.user_b.username} $1000\n"
        )

    def test_item_value_set_on_swap_legs(self):
        from decimal import Decimal
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        a1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_a1)
        b1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_b1)
        self.assertEqual(a1_row.item_value, Decimal("20.00"))
        self.assertEqual(b1_row.item_value, Decimal("30.00"))

    def test_settlement_in_result(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(), content_type="text/plain"
        )
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(
            run.result["settlement"],
            [{"from_user": self.user_a.username, "to_user": self.user_b.username, "amount": "10.00"}],
        )

    def test_reconstruction_mismatch_rejected(self):
        # Cash Summary claims alice owes $99.99 but the items reconstruct to $10 -> 400.
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(alice_net=9999),
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MatchRun.objects.filter(status=MatchRun.Status.DONE).count(), 0)

    def test_serializer_exposes_item_value(self):
        from matching.serializers import TradeAssignmentSerializer
        self.assertIn("item_value", TradeAssignmentSerializer().fields)
