"""
matching/test_shipping.py

Shipping feature test suite (B1–B4).
"""

from matching.tests import MatchingTestBase
from matching.models import MatchRun, TradeAssignment, Shipment


# ---------------------------------------------------------------------------
# B1 — Shipment model
# ---------------------------------------------------------------------------

class ShipmentModelTests(MatchingTestBase):
    def test_shipment_defaults_pending(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(match_run=run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1)
        s = Shipment.objects.create(assignment=a)
        self.assertEqual(s.status, Shipment.Status.PENDING)
        self.assertEqual(s.shipping_info, "")


# ---------------------------------------------------------------------------
# B2 — ShipmentSerializer
# ---------------------------------------------------------------------------

class ShipmentSerializerTests(MatchingTestBase):
    def test_shipment_serializer_fields(self):
        from matching.serializers import ShipmentSerializer
        fields = set(ShipmentSerializer().fields)
        self.assertTrue({"id", "status", "shipping_info", "listing_code", "board_game_name",
            "giver_username", "receiver_username", "my_role", "sent_at", "received_at"}.issubset(fields))


# ---------------------------------------------------------------------------
# B3 — GET /api/events/{slug}/shipping/
# ---------------------------------------------------------------------------

class ShippingListTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"; self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        TradeAssignment.objects.create(match_run=self.run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1)

    def test_list_lazily_creates_pending_shipments_for_me(self):
        self.client.force_authenticate(self.user_a)
        r = self.client.get(f"/api/events/{self.slug}/shipping/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["status"], "PENDING")
        self.assertEqual(r.data[0]["my_role"], "sender")

    def test_list_excludes_others(self):
        self.client.force_authenticate(self.user_c)
        r = self.client.get(f"/api/events/{self.slug}/shipping/")
        self.assertEqual(r.data, [])


# ---------------------------------------------------------------------------
# B4 — PATCH /api/events/{slug}/shipping/{pk}/
# ---------------------------------------------------------------------------

class ShippingPatchTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"; self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        self.a = TradeAssignment.objects.create(match_run=self.run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1)
        self.s = Shipment.objects.create(assignment=self.a)

    def _url(self): return f"/api/events/{self.slug}/shipping/{self.s.id}/"

    def test_giver_marks_sent_with_info(self):
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._url(), {"status": "SENT", "shipping_info": "UPS 1Z999"}, format="json")
        self.assertEqual(r.status_code, 200, r.data); self.s.refresh_from_db()
        self.assertEqual(self.s.status, "SENT"); self.assertEqual(self.s.shipping_info, "UPS 1Z999")
        self.assertIsNotNone(self.s.sent_at)

    def test_receiver_cannot_mark_sent(self):
        self.client.force_authenticate(self.user_b)
        self.assertEqual(self.client.patch(self._url(), {"status": "SENT"}, format="json").status_code, 403)

    def test_receiver_marks_received(self):
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(self._url(), {"status": "RECEIVED"}, format="json")
        self.assertEqual(r.status_code, 200, r.data); self.s.refresh_from_db()
        self.assertEqual(self.s.status, "RECEIVED"); self.assertIsNotNone(self.s.received_at)

    def test_giver_cannot_mark_received(self):
        self.client.force_authenticate(self.user_a)
        self.assertEqual(self.client.patch(self._url(), {"status": "RECEIVED"}, format="json").status_code, 403)

    def test_patch_blocked_when_not_shipping_status(self):
        self.event.status = "ARCHIVED"; self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.user_a)
        self.assertEqual(self.client.patch(self._url(), {"status": "SENT"}, format="json").status_code, 403)
