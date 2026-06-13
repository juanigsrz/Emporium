"""Join-exclusivity + leave-gating/cascade rules (items 1 & 2)."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from events.models import EventParticipation, EventListing, TradeEvent
from events.test_admin_dashboard import AdminDashboardBase
from trades.models import TradeWish, WantGroupItem

User = get_user_model()


class LeaveRulesTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org", password="x")
        self.u = User.objects.create_user("alice", password="x")
        self.event = TradeEvent.objects.create(name="E1", organizer=self.org)
        EventParticipation.objects.create(event=self.event, user=self.u)
        self.client.force_authenticate(self.u)

    def _leave(self):
        return self.client.delete(f"/api/events/{self.event.slug}/leave/")

    def test_leave_allowed_before_matching(self):
        self.event.status = TradeEvent.Status.WANTLIST_OPEN
        self.event.save(update_fields=["status"])
        self.assertEqual(self._leave().status_code, 200)
        self.assertFalse(
            EventParticipation.objects.filter(event=self.event, user=self.u).exists()
        )

    def test_leave_blocked_after_matching(self):
        self.event.status = TradeEvent.Status.MATCHING
        self.event.save(update_fields=["status"])
        r = self._leave()
        self.assertEqual(r.status_code, 400)
        self.assertTrue(
            EventParticipation.objects.filter(event=self.event, user=self.u).exists()
        )

    def test_leave_when_not_participant(self):
        EventParticipation.objects.filter(event=self.event, user=self.u).delete()
        self.assertEqual(self._leave().status_code, 400)


class LeaveCascadeTests(AdminDashboardBase):
    """Reuses the kick-cascade fixtures: victim has a listing + offer/want/wish,
    and `other` references the victim's specific listing."""

    def test_leave_runs_full_kick_cascade(self):
        # AdminDashboardBase creates the event in MATCH_REVIEW (locked); leaving requires a pre-matching status.
        self.event.status = TradeEvent.Status.WANTLIST_OPEN
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.victim)
        r = self.client.delete(f"/api/events/{self.event.slug}/leave/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["removed_listings"], 1)
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        self.assertFalse(TradeWish.objects.filter(user=self.victim, event=self.event).exists())
        # other user's reference to the victim's specific listing is cascaded away
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())


class JoinExclusivityTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org2", password="x")
        self.u = User.objects.create_user("bob", password="x")
        self.e1 = TradeEvent.objects.create(name="E-one", organizer=self.org)
        self.e2 = TradeEvent.objects.create(name="E-two", organizer=self.org)
        self.client.force_authenticate(self.u)

    def _join(self, e):
        return self.client.post(f"/api/events/{e.slug}/join/", {}, format="json")

    def test_blocked_while_in_another_active_event(self):
        self.assertEqual(self._join(self.e1).status_code, 201)
        r = self._join(self.e2)
        self.assertEqual(r.status_code, 400)
        self.assertIn("already participating", str(r.data).lower())

    def test_rejoin_same_event_is_idempotent(self):
        self.assertEqual(self._join(self.e1).status_code, 201)
        self.assertEqual(self._join(self.e1).status_code, 200)

    def test_allowed_once_other_event_archived(self):
        self._join(self.e1)
        self.e1.status = TradeEvent.Status.ARCHIVED
        self.e1.save(update_fields=["status"])
        self.assertEqual(self._join(self.e2).status_code, 201)

    def test_organizing_without_joining_does_not_block(self):
        # u organizes e3 but never joins it; should still be free to join e1.
        TradeEvent.objects.create(name="E-three", organizer=self.u)
        self.assertEqual(self._join(self.e1).status_code, 201)
