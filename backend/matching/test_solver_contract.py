"""
Solver-contract hardening on upload (see docs/SOLVER_INTEGRATION.md,
"Verification on upload"):

  - the vendored pareto_io reproduces Pareto's own input_checksum (pinned value);
  - an uploaded solution's input_checksum must match the event's CURRENT state;
  - result_checksum must match the uploaded body (tamper / truncation guard);
  - documents without checksums (hand-built seeds, old outputs) still load;
  - a document of the wrong shape is a 400, never a 500 with a RUNNING run left;
  - settlement parties must exist and the plan must discharge the cash nets;
  - shipment / payment status can't regress (RECEIVED -> SENT, CONFIRMED -> PAID).
"""
import json

from django.test import SimpleTestCase
from rest_framework import status

from matching import pareto_io
from matching.external_solver import build_wants
from matching.models import MatchRun, SettlementPayment, Shipment, TradeAssignment
from matching.services import ensure_payments
from matching.test_external_solver import _sol, upload_url
from matching.tests import MatchingTestBase

META = ("version", "gurobi_version", "input_checksum", "result_checksum")


def _stamp(doc_json, input_checksum=None, version="1.1.0"):
    """Add Pareto-style meta to a serialized solver document: a genuine
    result_checksum over the body, plus the given input_checksum."""
    doc = json.loads(doc_json)
    doc["version"] = version
    doc["gurobi_version"] = "13.0.2"
    if input_checksum is not None:
        doc["input_checksum"] = input_checksum
    body = {k: v for k, v in doc.items() if k not in META}
    doc["result_checksum"] = pareto_io.checksum(body)
    return json.dumps(doc)


class ParetoIoParityTests(SimpleTestCase):
    def test_normalize_instance_reproduces_the_solvers_checksum(self):
        # Pinned from `python main.py testcases/1for1.txt --format json` (pareto 1.1.0;
        # identical under 1.0.0). If this fails, the vendored pareto_io.py drifted.
        doc = {"wishes": [{"user": "alice", "give": ["A"], "take": ["B"]},
                          {"user": "bob", "give": ["B"], "take": ["A"]}]}
        self.assertEqual(
            pareto_io.checksum(pareto_io.normalize_instance(doc)),
            "sha256:a36f3b882e164bc92101e152501c28be330fbac44b4e309d29ddd3ca3ef5b164",
        )

    def test_key_and_list_order_do_not_change_the_checksum(self):
        a = {"wishes": [{"user": "alice", "give": ["A"], "take": ["B", "C"]}],
             "items": [{"name": "Z", "owner": "zed", "ask": 5}]}
        b = {"items": [{"ask": 5, "owner": "zed", "name": "Z"}],
             "wishes": [{"take": ["C", "B"], "give": ["A"], "user": "alice", "n": 1, "m": 2}]}
        self.assertEqual(pareto_io.checksum(pareto_io.normalize_instance(a)),
                         pareto_io.checksum(pareto_io.normalize_instance(b)))

    def test_semantic_change_changes_the_checksum(self):
        a = {"wishes": [{"user": "alice", "give": ["A"], "take": ["B"]}]}
        b = {"wishes": [{"user": "alice", "give": ["A"], "take": ["B"], "m": 0}]}
        self.assertNotEqual(pareto_io.checksum(pareto_io.normalize_instance(a)),
                            pareto_io.checksum(pareto_io.normalize_instance(b)))


class UploadChecksumTests(MatchingTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.user_a)  # organizer

    def _trades(self):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        return _sol(trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}])

    def _current_input_checksum(self):
        return pareto_io.checksum(
            pareto_io.normalize_instance(json.loads(build_wants(self.event)))
        )

    def _post(self, body):
        return self.client.post(upload_url(self.slug), data=body, content_type="text/plain")

    def test_matching_checksums_are_accepted_and_stored(self):
        ck = self._current_input_checksum()
        resp = self._post(_stamp(self._trades(), input_checksum=ck))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.status, MatchRun.Status.DONE)
        self.assertEqual(run.solver_input_checksum, ck)
        self.assertTrue(run.solver_result_checksum.startswith("sha256:"))
        self.assertEqual(run.algorithm, "pareto 1.1.0")

    def test_wrong_input_checksum_is_rejected_with_nothing_persisted(self):
        resp = self._post(_stamp(self._trades(), input_checksum="sha256:" + "0" * 64))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("input_checksum mismatch", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_state_change_between_export_and_upload_is_detected(self):
        exported = self._current_input_checksum()          # organizer exports...
        self._make_wish(self.user_c, self.el_c1, want_game=self.game_gaia)  # ...carol adds a wish
        self.assertNotEqual(exported, self._current_input_checksum())
        resp = self._post(_stamp(self._trades(), input_checksum=exported))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Re-export", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_tampered_result_is_rejected(self):
        stamped = json.loads(_stamp(self._trades(), input_checksum=self._current_input_checksum()))
        stamped["trades"] = stamped["trades"][:1]          # edit after the solver wrote it
        resp = self._post(json.dumps(stamped))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("result_checksum mismatch", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_documents_without_checksums_still_load(self):
        resp = self._post(self._trades())                  # hand-built / pre-1.0 output
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.solver_input_checksum, "")
        self.assertEqual(run.solver_result_checksum, "")

    def test_malformed_document_is_400_not_500_and_leaves_no_running_run(self):
        resp = self._post(json.dumps({"version": "1.1.0", "trades": [{"give": "C-ABCDEF"}]}))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Malformed solver document", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)


class SettlementValidationTests(MatchingTestBase):
    """Cash mode: bob buys carol's c1 for 1000c; the settlement plan must name
    real users and discharge exactly the cash_summary nets."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.user_a)

    def _doc(self, settlement):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        c1 = self.copy_c1.listing_code
        return _sol(
            trades=[{"give": a1, "take": b1}, {"give": b1, "take": a1}],
            cash_purchases=[{"item": c1, "from": "carol", "to": "bob", "price": 1000}],
            cash_summary=[
                {"user": "bob", "spent": 1000, "earned": 0, "net": 1000, "cap": None},
                {"user": "carol", "spent": 0, "earned": 1000, "net": -1000, "cap": None},
            ],
            settlement=settlement,
        )

    def _post(self, body):
        return self.client.post(upload_url(self.slug), data=body, content_type="text/plain")

    def test_consistent_settlement_is_accepted(self):
        resp = self._post(self._doc([{"from": "bob", "to": "carol", "amount": 1000}]))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(run.result["settlement"],
                         [{"from_user": "bob", "to_user": "carol", "amount": "10.00"}])

    def test_unknown_settlement_user_is_rejected(self):
        resp = self._post(self._doc([{"from": "bob", "to": "ghost", "amount": 1000}]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Unknown user(s) in settlement plan: ghost", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)

    def test_settlement_that_does_not_discharge_the_nets_is_rejected(self):
        resp = self._post(self._doc([{"from": "bob", "to": "carol", "amount": 500}]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not discharge 'bob'", resp.data["detail"])
        self.assertEqual(MatchRun.objects.filter(event=self.event).count(), 0)


class FulfilmentRegressionTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"
        self.event.save(update_fields=["status"])

    def test_received_shipment_cannot_go_back_to_sent(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(match_run=run, event_listing=self.el_a1,
                                           giver=self.user_a, receiver=self.user_b, cycle_id=1)
        s = Shipment.objects.create(assignment=a, status=Shipment.Status.RECEIVED)
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(f"/api/events/{self.slug}/shipping/{s.id}/",
                              {"status": "SENT"}, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        s.refresh_from_db()
        self.assertEqual(s.status, Shipment.Status.RECEIVED)

    def test_confirmed_payment_cannot_go_back_to_paid(self):
        run = MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE,
            result={"settlement": [{"from_user": "bob", "to_user": "alice", "amount": "5.00"}]},
        )
        ensure_payments(run)
        p = SettlementPayment.objects.get(match_run=run)
        p.status = SettlementPayment.Status.CONFIRMED
        p.note = "confirmed by alice"
        p.save(update_fields=["status", "note"])
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(f"/api/events/{self.slug}/payments/{p.id}/",
                              {"status": "PAID", "note": "overwrite?"}, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        p.refresh_from_db()
        self.assertEqual(p.status, SettlementPayment.Status.CONFIRMED)
        self.assertEqual(p.note, "confirmed by alice")
