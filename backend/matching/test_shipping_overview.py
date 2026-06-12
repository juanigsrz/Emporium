"""Organizer shipping-overview endpoint: all shipments, organizer-only."""
from matching.tests import MatchingTestBase
from matching.models import MatchRun, TradeAssignment, Shipment


class ShippingOverviewTests(MatchingTestBase):
    def _url(self):
        return f"/api/events/{self.slug}/shipping/overview/"

    def _setup_run(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_a1, giver=self.user_a,
            receiver=self.user_b, cycle_id=1,
        )
        TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_b1, giver=self.user_b,
            receiver=self.user_a, cycle_id=1,
        )
        return run

    def test_organizer_sees_all_shipments(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_a)  # organizer
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 2)  # both, not just user_a's

    def test_non_organizer_forbidden(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_b)  # not organizer
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 403)

    def test_lazily_creates_shipments(self):
        run = self._setup_run()
        self.assertEqual(Shipment.objects.filter(assignment__match_run=run).count(), 0)
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())
        self.assertEqual(Shipment.objects.filter(assignment__match_run=run).count(), 2)

    def test_empty_when_no_done_run(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, [])
