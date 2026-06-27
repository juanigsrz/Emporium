"""A non-ACTIVE copy (e.g. TRADED from a prior cycle) can't be listed."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class ListingStatusGuardTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("lsg", "lsg@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=11500, name="Guarded")
        cls.event = TradeEvent.objects.create(
            name="Guard Ev", organizer=cls.u, status="SUBMISSIONS_OPEN"
        )

    def test_traded_copy_cannot_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN",
                                   status=Copy.Status.TRADED)
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_active_copy_can_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_listing_create_blocked_at_wantlist_open(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_delete_blocked_at_wantlist_open(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        listing = EventListing.objects.create(event=self.event, copy=copy)
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.u)
        resp = self.client.delete(
            f"/api/events/{self.event.slug}/listings/{listing.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_event_exposes_submissions_locked(self):
        self.client.force_authenticate(self.u)
        self.event.status = "SUBMISSIONS_OPEN"
        self.event.save(update_fields=["status"])
        r1 = self.client.get(f"/api/events/{self.event.slug}/")
        self.assertFalse(r1.data["submissions_locked"])
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        r2 = self.client.get(f"/api/events/{self.event.slug}/")
        self.assertTrue(r2.data["submissions_locked"])
