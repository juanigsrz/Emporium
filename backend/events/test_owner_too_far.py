"""
Tests for EventListing.owner_too_far serializer field.

Scenario: requester has lat/lng + max_trade_distance_km=10.
  - A listing whose copy owner is >10 km away → owner_too_far=True
  - A listing whose copy owner is within 10 km  → owner_too_far=False
  - When the requester has no max_trade_distance_km limit → False
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from copies.models import Copy
from events.models import TradeEvent

User = get_user_model()

# Buenos Aires centre ≈ (-34.603, -58.381)
# ~320 km south: Mar del Plata ≈ (-38.000, -57.560)
LAT_BA, LNG_BA = -34.603, -58.381
LAT_FAR, LNG_FAR = -38.000, -57.560   # >10 km from BA
LAT_NEAR, LNG_NEAR = -34.610, -58.390  # ~1 km from BA


def _make_game():
    from catalog.models import BoardGame
    return BoardGame.objects.get_or_create(
        bgg_id=1,
        defaults={"name": "Chess", "year_published": 1475},
    )[0]


class OwnerTooFarTest(APITestCase):
    def setUp(self):
        game = _make_game()

        # Organiser
        self.org = User.objects.create_user("org_tf", password="x")

        # Requesting user: has location + distance limit
        self.requester = User.objects.create_user("requester_tf", password="x")
        p = self.requester.profile
        p.latitude, p.longitude, p.max_trade_distance_km = LAT_BA, LNG_BA, 10
        p.save()

        # Far owner (>10 km away from requester)
        self.far_user = User.objects.create_user("far_user_tf", password="x")
        fp = self.far_user.profile
        fp.latitude, fp.longitude = LAT_FAR, LNG_FAR
        fp.save()

        # Near owner (<10 km from requester)
        self.near_user = User.objects.create_user("near_user_tf", password="x")
        np_ = self.near_user.profile
        np_.latitude, np_.longitude = LAT_NEAR, LNG_NEAR
        np_.save()

        # Event
        self.event = TradeEvent.objects.create(
            name="TF Event", organizer=self.org,
        )

        # Copies + listings
        self.far_copy = Copy.objects.create(owner=self.far_user, board_game=game)
        self.near_copy = Copy.objects.create(owner=self.near_user, board_game=game)

        from events.models import EventListing
        self.far_listing = EventListing.objects.create(event=self.event, copy=self.far_copy)
        self.near_listing = EventListing.objects.create(event=self.event, copy=self.near_copy)

    def _listings(self):
        self.client.force_authenticate(self.requester)
        return self.client.get(f"/api/events/{self.event.slug}/listings/")

    def _listing_map(self):
        r = self._listings()
        self.assertEqual(r.status_code, 200)
        return {item["id"]: item for item in r.data["results"]}

    def test_far_owner_flagged(self):
        m = self._listing_map()
        self.assertTrue(m[self.far_listing.id]["owner_too_far"])

    def test_near_owner_not_flagged(self):
        m = self._listing_map()
        self.assertFalse(m[self.near_listing.id]["owner_too_far"])

    def test_no_limit_returns_false(self):
        # Remove the distance limit from the requester's profile.
        p = self.requester.profile
        p.max_trade_distance_km = None
        p.save()
        m = self._listing_map()
        self.assertFalse(m[self.far_listing.id]["owner_too_far"])
        self.assertFalse(m[self.near_listing.id]["owner_too_far"])
