"""
matching/test_external_solver.py

Tests for the external Pareto (gurobi) bridge
(matching/external_solver.py) and the export / upload endpoints.

Covers:
    Export — JSON wishes (n/m), give/take codes, block filtering, money directives.
    Parsers — gurobi solution JSON (trades/combos, cash, summary, settlement).
    Upload — gurobi JSON stdout -> DONE run + TradeAssignment rows; component grouping;
      schema parity; error handling (unknown code, perms, status).
"""

import json

from rest_framework import status

from events.models import TradeEvent
from matching.models import MatchRun, TradeAssignment
from matching import external_solver
from matching.tests import MatchingTestBase


def export_url(slug):
    return f"/api/events/{slug}/wants-export/"


def upload_url(slug):
    return f"/api/events/{slug}/matches/upload/"


def _wants(event, **kw):
    """Parsed solver-input document produced by build_wants."""
    return json.loads(external_solver.build_wants(event, **kw))


def _sol(trades=None, combos=None, cash_purchases=None,
         cash_summary=None, settlement=None, version="1.0.0"):
    """Serialize a solver-output JSON document as the upload endpoint expects.
    Real solver output always carries a `version` meta; pass version=None to omit."""
    doc = {
        "trades": trades or [],
        "combos": combos or [],
        "cash_purchases": cash_purchases or [],
        "cash_summary": cash_summary or [],
        "settlement": settlement or [],
    }
    if version is not None:
        doc["version"] = version
    return json.dumps(doc)


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
        self.assertIn("application/json", resp["Content-Type"])
        self.assertIn("attachment", resp["Content-Disposition"])
        # body is valid JSON with the expected top-level keys
        doc = json.loads(resp.content.decode())
        for key in ("wishes", "items", "bids", "budgets",
                    "takecaps", "givecaps", "locations"):
            self.assertIn(key, doc)

    def test_wish_entries_carry_n_and_m(self):
        doc = _wants(self.event)
        self.assertEqual(len(doc["wishes"]), 2)  # one per wish
        for w in doc["wishes"]:
            self.assertEqual((w["n"], w["m"]), (1, 1))
            self.assertTrue(w["give"] and w["take"])

    def test_give_and_take_codes(self):
        doc = _wants(self.event)
        w = next(w for w in doc["wishes"]
                 if self.copy_a1.listing_code in w["give"])
        self.assertIn(self.copy_a1.listing_code, w["give"])
        self.assertIn(self.copy_b1.listing_code, w["take"])  # bob terra
        self.assertIn(self.copy_c2.listing_code, w["take"])  # carol terra

    def test_export_kpi_distance_includes_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,distance"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        doc = json.loads(resp.content.decode())
        self.assertIn(
            {"user": self.user_a.username, "lat": 40.7128, "lng": -74.006},
            doc["locations"],
        )

    def test_export_kpi_without_distance_has_no_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,users"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(json.loads(resp.content.decode())["locations"], [])

    def test_export_default_kpi_has_no_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug))  # no kpi param
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(json.loads(resp.content.decode())["locations"], [])

    def test_export_invalid_kpi_400(self):
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,foo"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_export_duplicate_kpi_400(self):
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,trades"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_xtoy_money_directives(self):
        """XTOY with money_enabled emits real budget/item/bid entries."""
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

        doc = _wants(self.event)

        self.assertIn(
            {"user": self.user_a.username, "budget": 5000}, doc["budgets"])
        self.assertIn(
            {"name": self.copy_a1.listing_code, "owner": self.user_a.username,
             "ask": 2000},
            doc["items"])
        # bid entries: alice bids on bob's terra and carol's terra (expanded from game_terra)
        self.assertIn(
            {"user": self.user_a.username, "item": self.copy_b1.listing_code,
             "max_price": 3000},
            doc["bids"])
        self.assertIn(
            {"user": self.user_a.username, "item": self.copy_c2.listing_code,
             "max_price": 3000},
            doc["bids"])

        # Clean up (avoid polluting other tests)
        self.event.money_enabled = False
        self.event.save(update_fields=["money_enabled"])


# ---------------------------------------------------------------------------
# Location export (distance objective)
# ---------------------------------------------------------------------------

class LocationExportTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    @classmethod
    def _set_coords(cls, user, lat, lng):
        from accounts.models import Profile
        Profile.objects.filter(user=user).update(latitude=lat, longitude=lng)

    def test_no_location_entries_by_default(self):
        self.assertEqual(_wants(self.event)["locations"], [])

    def test_locations_included_for_users_with_coords(self):
        self._set_coords(self.user_a, 40.7128, -74.006)
        self._set_coords(self.user_b, 34.0522, -118.2437)
        locs = _wants(self.event, include_locations=True)["locations"]
        self.assertIn(
            {"user": self.user_a.username, "lat": 40.7128, "lng": -74.006}, locs)
        self.assertIn(
            {"user": self.user_b.username, "lat": 34.0522, "lng": -118.2437}, locs)

    def test_user_without_coords_skipped(self):
        self._set_coords(self.user_a, 40.7128, -74.006)
        # user_b has no coords (Profile lat/lng null) -> no entry
        locs = _wants(self.event, include_locations=True)["locations"]
        names = {e["user"] for e in locs}
        self.assertIn(self.user_a.username, names)
        self.assertNotIn(self.user_b.username, names)

    def test_wants_doc_has_no_trade_edges(self):
        # The wants document carries no `trades`/`combos`, so the solution parser
        # (which reads only those keys) yields no edges from it.
        doc = _wants(self.event, include_locations=True)
        self.assertEqual(external_solver.parse_gurobi(doc), [])


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

class ParserTests(MatchingTestBase):

    def test_parse_gurobi_edges(self):
        doc = {"trades": [{"give": "C-A1", "take": "C-B1"},
                          {"give": "C-B1", "take": "C-A1"}]}
        edges = external_solver.parse_gurobi(doc)
        self.assertEqual(edges, [("C-B1", "C-A1", None), ("C-A1", "C-B1", None)])

    def test_parse_gurobi_combos_multi_take(self):
        doc = {
            "trades": [{"give": "C-C", "take": "C-B"}],
            "combos": [{"sent": ["C-X", "C-Y"], "taken": ["C-A"]},
                       {"sent": ["C-A", "C-B"], "taken": ["C-C"]}],
        }
        edges = external_solver.parse_gurobi(doc)
        # one moved item per take token across trades + combos
        self.assertEqual({e[0] for e in edges}, {"C-A", "C-B", "C-C"})
        self.assertEqual(len(edges), 3)
        self.assertTrue(all(e[2] is None for e in edges))

    def test_parse_gurobi_ignores_cash_section(self):
        # Cash purchases live in their own array; parse_gurobi reads only swaps.
        doc = {"trades": [{"give": "C-A", "take": "C-B"}],
               "cash_purchases": [
                   {"item": "C-C", "from": "carol", "to": "bob", "price": 500}]}
        edges = external_solver.parse_gurobi(doc)
        self.assertEqual(edges, [("C-B", "C-A", None)])

    def test_parse_gurobi_cash_extracts_moves(self):
        doc = {"cash_purchases": [
            {"item": "C-C", "from": "carol", "to": "bob", "price": 500},
            {"item": "C-D", "from": "dave", "to": "eve", "price": 700}]}
        moves = external_solver.parse_gurobi_cash(doc)
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
        return _sol(trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}])

    def _solution_no_version(self):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        return _sol(trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}],
                    version=None)

    def test_upload_with_cash_purchase_creates_assignment(self):
        from decimal import Decimal
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        c1 = self.copy_c1.listing_code
        out = _sol(
            trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}],
            cash_purchases=[{"item": c1, "from": "carol", "to": "bob", "price": 1000}],
            cash_summary=[{"user": "bob", "spent": 1000, "earned": 0,
                           "net": 1000, "cap": None}],
        )
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
        # algorithm reflects the solver's version meta ("pareto <version>")
        self.assertEqual(run.algorithm, "pareto 1.0.0")

        assignments = TradeAssignment.objects.filter(match_run=run)
        self.assertEqual(assignments.count(), 2)
        # moved a1 (alice's brass) -> received by bob; moved b1 -> received by alice
        a1_row = assignments.get(event_listing=self.el_a1)
        self.assertEqual(a1_row.giver, self.user_a)
        self.assertEqual(a1_row.receiver, self.user_b)
        b1_row = assignments.get(event_listing=self.el_b1)
        self.assertEqual(b1_row.giver, self.user_b)
        self.assertEqual(b1_row.receiver, self.user_a)

    def test_upload_without_version_keeps_default_algorithm(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._solution_no_version(),
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.algorithm, "gurobi-xy")

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
            data=_sol(trades=[{"give": "C-NOPEAA", "take": "C-NOPEBB"}]),
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_upload_invalid_json_400(self):
        resp = self.client.post(
            upload_url(self.slug), data="not json at all", content_type="text/plain"
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
            upload_url(draft.slug), data=_sol(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Duplicate protection via takecap (n=1) directives
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

    def _dupcaps(self, doc, username):
        """takecaps (n=1) belonging to `username` — the JSON form of a dupcap."""
        return [c for c in doc["takecaps"]
                if c["user"] == username and c["n"] == 1]

    def test_multi_copy_game_emits_takecap(self):
        doc = _wants(self.event)
        # wish lists the real terra copies (no dummy indirection)
        main = next(
            w for w in doc["wishes"]
            if w["user"] == self.user_a.username
            and self.copy_a1.listing_code in w["give"]
        )
        self.assertIn(self.copy_b1.listing_code, main["take"])
        self.assertIn(self.copy_c2.listing_code, main["take"])
        # a takecap (n=1) caps alice over both terra copies
        caps = self._dupcaps(doc, self.user_a.username)
        self.assertEqual(len(caps), 1)
        self.assertIn(self.copy_b1.listing_code, caps[0]["items"])
        self.assertIn(self.copy_c2.listing_code, caps[0]["items"])

    def test_single_copy_game_no_takecap(self):
        # alice offers ark (el_a2), wants brass -> carol's brass only (1 copy)
        wish = self._make_wish(self.user_a, self.el_a2, want_game=self.game_brass)
        wish.want_group.duplicate_protection = True
        wish.want_group.save(update_fields=["duplicate_protection"])
        doc = _wants(self.event)
        # no takecap mentions the single brass copy
        self.assertFalse(
            any(self.copy_c1.listing_code in c["items"] for c in doc["takecaps"])
        )
        # the real copy still appears on a wish's take side
        w = next(
            w for w in doc["wishes"]
            if w["user"] == self.user_a.username
            and self.copy_a2.listing_code in w["give"]
        )
        self.assertIn(self.copy_c1.listing_code, w["take"])

    def test_takecap_unions_across_want_groups_same_game(self):
        # a second dup-protected want group for terra, same user (offers ark)
        wish2 = self._make_wish(self.user_a, self.el_a2, want_game=self.game_terra)
        wish2.want_group.duplicate_protection = True
        wish2.want_group.save(update_fields=["duplicate_protection"])
        doc = _wants(self.event)
        caps = self._dupcaps(doc, self.user_a.username)
        # exactly one takecap for alice (terra), unioning both copies
        self.assertEqual(len(caps), 1)
        self.assertIn(self.copy_b1.listing_code, caps[0]["items"])
        self.assertIn(self.copy_c2.listing_code, caps[0]["items"])

    def test_no_takecap_when_disabled(self):
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        self.assertEqual(_wants(self.event)["takecaps"], [])


# ---------------------------------------------------------------------------
# Money parsers — cash summary / settlement
# ---------------------------------------------------------------------------

class MoneyParserTests(MatchingTestBase):

    def test_parse_cash_summary_signed_nets(self):
        doc = {"cash_summary": [
            {"user": "alice", "spent": 3000, "earned": 2000, "net": 1000, "cap": None},
            {"user": "bob", "spent": 2000, "earned": 3000, "net": -1000, "cap": None}]}
        self.assertEqual(external_solver.parse_gurobi_cash_summary(doc),
                         {"alice": 1000, "bob": -1000})

    def test_parse_cash_summary_absent_section(self):
        self.assertEqual(external_solver.parse_gurobi_cash_summary({}), {})

    def test_parse_settlement_transfers(self):
        doc = {"settlement": [
            {"from": "alice", "to": "bob", "amount": 700},
            {"from": "alice", "to": "carol", "amount": 300}]}
        self.assertEqual(
            external_solver.parse_gurobi_settlement(doc),
            [("alice", "bob", 700), ("alice", "carol", 300)],
        )

    def test_parse_settlement_absent_section(self):
        self.assertEqual(external_solver.parse_gurobi_settlement({}), [])


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

    def _barter_solution(self):
        # Pure barter swap a1<->b1. No money moves, so the Cash Summary nets are $0
        # even though both copies carry an ask -- the ask is only the cash sale price.
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        au, bu = self.user_a.username, self.user_b.username
        return _sol(
            trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}],
            cash_summary=[
                {"user": au, "spent": 0, "earned": 0, "net": 0, "cap": None},
                {"user": bu, "spent": 0, "earned": 0, "net": 0, "cap": None}],
        )

    def _cash_solution(self, alice_net=1000):
        # Cross cash purchases: alice buys bob's terra ($30), bob buys alice's brass
        # ($20). Net: alice +3000-2000 = 1000c owed, bob the mirror. Only cash legs
        # move money, so the reconstruction must equal these nets.
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        au, bu = self.user_a.username, self.user_b.username
        return _sol(
            cash_purchases=[
                {"item": b1, "from": bu, "to": au, "price": 3000},
                {"item": a1, "from": au, "to": bu, "price": 2000}],
            cash_summary=[
                {"user": au, "spent": 3000, "earned": 2000, "net": alice_net, "cap": None},
                {"user": bu, "spent": 2000, "earned": 3000, "net": -alice_net, "cap": None}],
            settlement=[{"from": au, "to": bu, "amount": 1000}],
        )

    def test_item_value_set_on_swap_legs(self):
        from decimal import Decimal
        resp = self.client.post(
            upload_url(self.slug), data=self._barter_solution(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        a1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_a1)
        b1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_b1)
        self.assertEqual(a1_row.item_value, Decimal("20.00"))
        self.assertEqual(b1_row.item_value, Decimal("30.00"))

    def test_settlement_in_result(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._cash_solution(), content_type="text/plain"
        )
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(
            run.result["settlement"],
            [{"from_user": self.user_a.username, "to_user": self.user_b.username, "amount": "10.00"}],
        )

    def test_reconstruction_mismatch_rejected(self):
        # Cash Summary claims alice owes $99.99 but the cash legs reconstruct to $10 -> 400.
        resp = self.client.post(
            upload_url(self.slug), data=self._cash_solution(alice_net=9999),
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MatchRun.objects.filter(status=MatchRun.Status.DONE).count(), 0)

    def test_serializer_exposes_item_value(self):
        from matching.serializers import TradeAssignmentSerializer
        self.assertIn("item_value", TradeAssignmentSerializer().fields)
