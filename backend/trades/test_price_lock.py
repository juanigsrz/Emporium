"""Price edits (UserGamePrice, WantBid, EventListing.sell_price) lock at MATCHING."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class PriceLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("pl", "pl@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=20001, name="PL")
        cls.event = TradeEvent.objects.create(
            name="PL Ev", organizer=cls.u, status="WANTLIST_OPEN", money_enabled=True
        )
        cls.copy = Copy.objects.create(owner=cls.u, board_game=cls.bg,
                                       condition="GOOD", language="EN")
        cls.el = EventListing.objects.create(event=cls.event, copy=cls.copy)

    def _lock(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])

    def test_game_price_put_open_then_locked(self):
        self.client.force_authenticate(self.u)
        url = f"/api/events/{self.event.slug}/game-prices/"
        ok = self.client.put(url, {"board_game": self.bg.bgg_id, "price": "10.00"}, format="json")
        self.assertEqual(ok.status_code, status.HTTP_200_OK, ok.data)
        self._lock()
        locked = self.client.put(url, {"board_game": self.bg.bgg_id, "price": "12.00"}, format="json")
        self.assertEqual(locked.status_code, status.HTTP_403_FORBIDDEN)

    def test_game_price_delete_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/game-prices/?board_game={self.bg.bgg_id}"
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_want_bid_put_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/want-bids/"
        resp = self.client.put(url, {"event_listing": self.el.id, "amount": "5.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_sell_price_patch_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/listings/{self.el.id}/"
        resp = self.client.patch(url, {"sell_price": "9.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_sell_price_patch_open_ok(self):
        self.client.force_authenticate(self.u)
        url = f"/api/events/{self.event.slug}/listings/{self.el.id}/"
        resp = self.client.patch(url, {"sell_price": "9.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
