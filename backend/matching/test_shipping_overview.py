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
        self.assertEqual(r.data["count"], 2)
        self.assertEqual(len(r.data["results"]), 2)

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
        self.assertEqual(r.data["count"], 0)
        self.assertEqual(r.data["results"], [])

    def test_status_filter(self):
        run = self._setup_run()
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())  # create shipments
        Shipment.objects.filter(assignment__match_run=run).update(status="SENT")
        r = self.client.get(self._url() + "?status=SENT")
        self.assertEqual(r.data["count"], 2)
        r2 = self.client.get(self._url() + "?status=PENDING")
        self.assertEqual(r2.data["count"], 0)


from django.db import connection
from django.test.utils import CaptureQueriesContext


class ShippingOverviewQueryTests(ShippingOverviewTests):
    def test_query_count_does_not_grow_with_shipments(self):
        run = self._setup_run()  # 2 assignments
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())  # warm: create the 2 shipments
        with CaptureQueriesContext(connection) as small:
            self.client.get(self._url() + "?page_size=100")

        # Add 4 more assignments (one per remaining listing) → 6 shipments total.
        for el in (self.el_a2, self.el_b2, self.el_c1, self.el_c2):
            TradeAssignment.objects.create(
                match_run=run, event_listing=el, giver=self.user_a,
                receiver=self.user_b, cycle_id=2,
            )
        self.client.get(self._url())  # create the new shipments
        with CaptureQueriesContext(connection) as large:
            self.client.get(self._url() + "?page_size=100")

        self.assertEqual(
            len(large.captured_queries), len(small.captured_queries),
            "shipping overview query count must be constant w.r.t. shipment count",
        )
