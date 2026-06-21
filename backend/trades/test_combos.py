"""Combo targeting through offer/want/bid serializers (via API)."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent

User = get_user_model()


class ComboTargetingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("to", "to@t.test", "pass1234")
        cls.wisher = User.objects.create_user("tw", "tw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=3001, name="Gaia")
        cls.bg2 = BoardGame.objects.create(bgg_id=3002, name="Gaia Exp")
        cls.event = TradeEvent.objects.create(
            name="T Ev", organizer=cls.owner, status="WANTLIST_OPEN", money_enabled=True
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="GA bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def _u(self, suffix):
        return f"/api/events/{self.event.slug}/{suffix}"

    def test_want_group_targets_combo(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "want the bundle", "min_receive": 1,
            "items": [{"combo": self.combo.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        self.assertEqual(item["combo"], self.combo.id)
        self.assertEqual(item["combo_code"], self.combo.combo_code)

    def test_want_item_rejects_both_targets(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "bad", "min_receive": 1,
            "items": [{"combo": self.combo.id, "event_listing": self.el1.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_want_item_rejects_neither_target(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "bad", "min_receive": 1, "items": [{}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_offer_group_targets_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._u("offer-groups/"), {
            "name": "offer the bundle", "max_give": 1,
            "item_combo_ids": [self.combo.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["items"][0]["combo"], self.combo.id)

    def test_want_bid_on_combo(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.put(self._u("want-bids/"), {
            "combo": self.combo.id, "amount": "35.00",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["combo"], self.combo.id)
