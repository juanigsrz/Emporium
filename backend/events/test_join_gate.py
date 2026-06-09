from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from events.models import TradeEvent

User = get_user_model()


class JoinGateTest(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org", password="x")
        self.u = User.objects.create_user("alice", password="x")
        self.event = TradeEvent.objects.create(
            name="E", organizer=self.org, require_location=True,
            center_latitude=-34.6, center_longitude=-58.4, max_distance_km=100,
        )
        self.client.force_authenticate(self.u)

    def _join(self):
        return self.client.post(f"/api/events/{self.event.slug}/join/", {}, format="json")

    def test_requires_location(self):
        r = self._join()
        self.assertEqual(r.status_code, 400)

    def test_rejects_too_far(self):
        p = self.u.profile
        p.latitude, p.longitude = -38.0, -57.5  # > 300km away
        p.save()
        self.assertEqual(self._join().status_code, 400)

    def test_allows_within_radius(self):
        p = self.u.profile
        p.latitude, p.longitude = -34.65, -58.45
        p.save()
        self.assertEqual(self._join().status_code, 201)
