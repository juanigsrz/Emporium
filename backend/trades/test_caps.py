"""TradeCap model + API tests."""
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from trades.models import TradeCap, TradeCapItem

User = get_user_model()


class TradeCapModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("capu", "capu@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=9001, name="CapGame")
        cls.event = TradeEvent.objects.create(name="Cap Ev", organizer=cls.u)
        cls.copy = Copy.objects.create(owner=cls.u, board_game=cls.bg)
        cls.el = EventListing.objects.create(event=cls.event, copy=cls.copy)

    def test_create_cap_with_listing_item(self):
        cap = TradeCap.objects.create(
            event=self.event, user=self.u, kind=TradeCap.Kind.GIVE, n=1
        )
        TradeCapItem.objects.create(cap=cap, event_listing=self.el)
        self.assertEqual(cap.items.count(), 1)
        self.assertEqual(cap.kind, "GIVE")

    def test_capitem_requires_exactly_one_target(self):
        cap = TradeCap.objects.create(
            event=self.event, user=self.u, kind=TradeCap.Kind.TAKE, n=2
        )
        with self.assertRaises(IntegrityError):
            # neither target set -> violates the check constraint
            TradeCapItem.objects.create(cap=cap)


from rest_framework import status
from rest_framework.test import APITestCase


class TradeCapAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("capo", "capo@t.test", "pass1234")
        cls.other = User.objects.create_user("capx", "capx@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=9101, name="G1")
        cls.bg2 = BoardGame.objects.create(bgg_id=9102, name="G2")
        cls.event = TradeEvent.objects.create(
            name="Cap API Ev", organizer=cls.owner, status="WANTLIST_OPEN"
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.co = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.el_other = EventListing.objects.create(event=cls.event, copy=cls.co)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def _url(self):
        return f"/api/events/{self.event.slug}/caps/"

    def test_create_give_cap_listings_and_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1,
            "item_listing_ids": [self.el1.id],
            "item_combo_ids": [self.combo.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["kind"], "GIVE")
        self.assertEqual(len(resp.data["items"]), 2)

    def test_create_take_cap_other_listing(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "TAKE", "n": 2, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_give_cap_rejects_non_owned_item(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_no_items(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {"kind": "TAKE", "n": 1}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_n_below_one(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "TAKE", "n": 0, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_blocked_when_locked(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_returns_only_own_caps(self):
        self.client.force_authenticate(self.owner)
        self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json")
        self.client.force_authenticate(self.other)
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 0)

    def test_only_owner_can_delete(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json").data
        self.client.force_authenticate(self.other)
        resp = self.client.delete(f"{self._url()}{created['id']}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
