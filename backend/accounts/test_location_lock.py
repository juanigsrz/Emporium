"""Profile lat/lng/max_trade_distance_km freeze while in a non-archived event."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Profile
from events.models import EventParticipation, TradeEvent

User = get_user_model()


class LocationLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("ll", "ll@t.test", "pass1234")
        cls.org = User.objects.create_user("ll_org", "llo@t.test", "pass1234")

    def setUp(self):
        self.client.force_authenticate(self.u)

    def _profile(self, **kw):
        p, _ = Profile.objects.get_or_create(user=self.u)
        for k, v in kw.items():
            setattr(p, k, v)
        p.save()
        return p

    def _join_active(self):
        ev = TradeEvent.objects.create(name="Active", organizer=self.org,
                                       status="WANTLIST_OPEN")
        EventParticipation.objects.create(event=ev, user=self.u)
        return ev

    def test_first_time_set_allowed_during_active_event(self):
        self._profile(latitude=None, longitude=None)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"latitude": 10.0, "longitude": 20.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_change_existing_blocked_during_active_event(self):
        self._profile(latitude=10.0, longitude=20.0)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"latitude": 11.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_change_max_distance_blocked_during_active_event(self):
        self._profile(max_trade_distance_km=100)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"max_trade_distance_km": 200}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_change_allowed_when_only_event_archived(self):
        self._profile(latitude=10.0, longitude=20.0)
        ev = TradeEvent.objects.create(name="Old", organizer=self.org, status="ARCHIVED")
        EventParticipation.objects.create(event=ev, user=self.u)
        resp = self.client.patch("/api/profiles/me/", {"latitude": 11.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_non_location_field_editable_during_active_event(self):
        self._profile(latitude=10.0, longitude=20.0)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"bio": "hi"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
