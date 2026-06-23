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

    def test_want_group_rejects_combo_from_other_event(self):
        other_event = TradeEvent.objects.create(
            name="Other Ev", organizer=self.owner, status="WANTLIST_OPEN"
        )
        other_combo = Combo.objects.create(
            event=other_event, owner=self.owner, name="other bundle"
        )
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "cross-event", "min_receive": 1,
            "items": [{"combo": other_combo.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

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


from django.test import TestCase

from decimal import Decimal

from trades.models import WantBid
from trades.pricing import resolve_ask_target, resolve_bid


class ComboPricingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("po", "po@t.test", "pass1234")
        cls.wisher = User.objects.create_user("pw", "pw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=4001, name="Ark")
        cls.bg2 = BoardGame.objects.create(bgg_id=4002, name="Ark Exp")
        cls.event = TradeEvent.objects.create(name="P Ev", organizer=cls.owner)
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(
            event=cls.event, owner=cls.owner, name="bundle", sell_price=Decimal("40.00")
        )
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def test_resolve_ask_target_combo(self):
        self.assertEqual(resolve_ask_target(self.combo), Decimal("40.00"))

    def test_resolve_ask_target_barter_combo_is_none(self):
        barter = Combo.objects.create(event=self.event, owner=self.owner, name="b2")
        self.assertIsNone(resolve_ask_target(barter))

    def test_resolve_bid_combo_target(self):
        WantBid.objects.create(
            user=self.wisher, event=self.event, combo=self.combo, amount="35.00"
        )
        # Build a minimal want item pointing at the combo:
        from trades.models import WantGroup, WantGroupItem
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("35.00"))

    def test_resolve_bid_combo_falls_back_to_max_member_price(self):
        from trades.models import UserGamePrice, WantGroup, WantGroupItem
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg1, price="10.00"
        )
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg2, price="18.00"
        )
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("18.00"))

    def test_resolve_bid_combo_override_beats_member_price(self):
        from trades.models import UserGamePrice, WantGroup, WantGroupItem
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg1, price="10.00"
        )
        WantBid.objects.create(
            user=self.wisher, event=self.event, combo=self.combo, amount="3.00"
        )
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w2")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("3.00"))

    def test_resolve_bid_combo_none_when_no_member_price(self):
        from trades.models import WantGroup, WantGroupItem
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w3")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertIsNone(resolve_bid(self.wisher, self.event, wi))

    def test_want_group_item_serializer_resolved_bid_for_combo(self):
        """WantGroupItemSerializer surfaces resolved_bid for a combo want item."""
        from trades.models import WantGroup, WantGroupItem
        from trades.serializers import WantGroupItemSerializer

        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="wser")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        WantBid.objects.create(
            user=self.wisher, event=self.event, combo=self.combo, amount="27.50"
        )
        ser = WantGroupItemSerializer(wi, context={"event": self.event})
        self.assertEqual(ser.data["resolved_bid"], "27.50")


class ComboBidDeleteTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("bo", "bo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("bw", "bw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=7001, name="Bd1")
        cls.bg2 = BoardGame.objects.create(bgg_id=7002, name="Bd2")
        cls.event = TradeEvent.objects.create(
            name="BidDel Ev", organizer=cls.owner, status="WANTLIST_OPEN",
            money_enabled=True,
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="cb")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def test_delete_combo_bid(self):
        from trades.models import WantBid
        self.client.force_authenticate(self.wisher)
        self.client.put(
            f"/api/events/{self.event.slug}/want-bids/",
            {"combo": self.combo.id, "amount": "30.00"}, format="json",
        )
        self.assertTrue(
            WantBid.objects.filter(user=self.wisher, combo=self.combo).exists()
        )
        resp = self.client.delete(
            f"/api/events/{self.event.slug}/want-bids/?combo={self.combo.id}"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            WantBid.objects.filter(user=self.wisher, combo=self.combo).exists()
        )
