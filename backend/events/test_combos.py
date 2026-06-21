"""Combo model + API tests."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent

User = get_user_model()


class ComboModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("cu", "cu@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=1001, name="Wingspan")
        cls.bg2 = BoardGame.objects.create(bgg_id=1002, name="Wingspan: Europe")
        cls.event = TradeEvent.objects.create(name="Combo Ev", organizer=cls.u)
        cls.copy1 = Copy.objects.create(owner=cls.u, board_game=cls.bg1)
        cls.copy2 = Copy.objects.create(owner=cls.u, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.copy1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.copy2)

    def test_combo_code_generated_with_k_prefix(self):
        c = Combo.objects.create(event=self.event, owner=self.u, name="WS bundle")
        self.assertTrue(c.combo_code.startswith("K-"))
        self.assertEqual(len(c.combo_code), 8)

    def test_combo_holds_members(self):
        c = Combo.objects.create(event=self.event, owner=self.u, name="WS bundle",
                                 sell_price=Decimal("40.00"))
        ComboItem.objects.create(combo=c, event_listing=self.el1)
        ComboItem.objects.create(combo=c, event_listing=self.el2)
        self.assertEqual(c.items.count(), 2)
        self.assertEqual(c.sell_price, Decimal("40.00"))

    def test_duplicate_combo_item_rejected(self):
        from django.db import IntegrityError
        c = Combo.objects.create(event=self.event, owner=self.u, name="WS bundle")
        ComboItem.objects.create(combo=c, event_listing=self.el1)
        with self.assertRaises(IntegrityError):
            ComboItem.objects.create(combo=c, event_listing=self.el1)


from rest_framework import status
from rest_framework.test import APITestCase


class ComboAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("co", "co@t.test", "pass1234")
        cls.other = User.objects.create_user("cx", "cx@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=2001, name="Brass")
        cls.bg2 = BoardGame.objects.create(bgg_id=2002, name="Brass Exp")
        cls.event = TradeEvent.objects.create(name="API Ev", organizer=cls.owner)
        cls.copy1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.copy2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.copy_other = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.copy1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.copy2)
        cls.el_other = EventListing.objects.create(event=cls.event, copy=cls.copy_other)

    def _url(self):
        return f"/api/events/{self.event.slug}/combos/"

    def test_create_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "Brass bundle", "sell_price": "40.00",
            "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["combo_code"].startswith("K-"))
        self.assertEqual(len(resp.data["items"]), 2)

    def test_reject_fewer_than_two(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_non_owned_member(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id, self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_member_already_in_another_combo(self):
        self.client.force_authenticate(self.owner)
        first = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        copy3 = Copy.objects.create(owner=self.owner, board_game=self.bg1)
        el3 = EventListing.objects.create(event=self.event, copy=copy3)
        resp = self.client.post(self._url(), {
            "name": "b", "item_listing_ids": [self.el1.id, el3.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_blocked_when_inputs_locked(self):
        self.event.refresh_from_db()
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_browse_lists_all_active_combos(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        # other user can see it in browse
        self.client.force_authenticate(self.other)
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 1)

    def test_browse_filter_by_board_game(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        resp = self.client.get(self._url() + f"?board_game={self.bg1.bgg_id}")
        self.assertEqual(resp.data["count"], 1)
        resp2 = self.client.get(self._url() + "?board_game=999999")
        self.assertEqual(resp2.data["count"], 0)

    def test_only_owner_can_delete(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json").data
        self.client.force_authenticate(self.other)
        resp = self.client.delete(f"{self._url()}{created['id']}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
