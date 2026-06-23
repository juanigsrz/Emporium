"""Pricing model refactor — models, resolution, and endpoints."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from matching.tests import MatchingTestBase
from trades import pricing
from trades.models import UserGamePrice, WantBid, WantGroupItem


class PricingModelTests(MatchingTestBase):
    def test_user_game_price_unique_per_user_event_game(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UserGamePrice.objects.create(
                    user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("50")
                )

    def test_event_listing_sell_price_nullable(self):
        self.el_a1.sell_price = Decimal("12.50")
        self.el_a1.save(update_fields=["sell_price"])
        self.el_a1.refresh_from_db()
        self.assertEqual(self.el_a1.sell_price, Decimal("12.50"))

    def test_want_bid_listing_ok(self):
        wb = WantBid(
            user=self.user_a, event=self.event,
            event_listing=self.el_b1, amount=Decimal("30"),
        )
        wb.clean()  # no raise
        wb.save()
        self.assertEqual(WantBid.objects.filter(user=self.user_a).count(), 1)

    def test_want_bid_listing_from_other_event_rejected(self):
        from events.models import TradeEvent, EventListing
        other = TradeEvent.objects.create(
            name="Other Ev", organizer=self.user_a,
            status=TradeEvent.Status.SUBMISSIONS_OPEN,
        )
        other_listing = EventListing.objects.create(event=other, copy=self.copy_a1)
        wb = WantBid(
            user=self.user_a, event=self.event,
            event_listing=other_listing, amount=Decimal("30"),
        )
        with self.assertRaises(ValidationError):
            wb.clean()


class ResolveAskTests(MatchingTestBase):
    def test_per_copy_override_wins(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        self.el_a1.sell_price = Decimal("33")
        self.el_a1.save(update_fields=["sell_price"])
        self.assertEqual(pricing.resolve_ask(self.el_a1), Decimal("33"))

    def test_falls_through_to_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        self.assertIsNone(self.el_a1.sell_price)
        self.assertEqual(pricing.resolve_ask(self.el_a1), Decimal("40"))

    def test_none_when_no_price_anywhere(self):
        self.assertIsNone(pricing.resolve_ask(self.el_a1))


class ResolveBidTests(MatchingTestBase):
    def test_want_override_wins_over_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("20")
        )
        WantBid.objects.create(
            user=self.user_a, event=self.event,
            event_listing=self.el_b1, amount=Decimal("25"),
        )
        target = WantGroupItem(event_listing=self.el_b1)  # el_b1 is a terra copy
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("25"))

    def test_listing_target_uses_listing_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("20")
        )
        target = WantGroupItem(event_listing=self.el_b1)  # el_b1 is a terra copy
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("20"))

    def test_none_when_no_bid(self):
        target = WantGroupItem(event_listing=self.el_b1)
        self.assertIsNone(pricing.resolve_bid(self.user_a, self.event, target))

    def test_listing_override_wins(self):
        WantBid.objects.create(
            user=self.user_a, event=self.event,
            event_listing=self.el_b1, amount=Decimal("15"),
        )
        target = WantGroupItem(event_listing=self.el_b1)
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("15"))


class GamePriceEndpointTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(user=self.user_a)
        self.url = f"/api/events/{self.slug}/game-prices/"

    def test_put_creates_then_updates(self):
        r1 = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "40.00"}, format="json")
        self.assertEqual(r1.status_code, 200, r1.data)
        self.assertEqual(UserGamePrice.objects.count(), 1)
        r2 = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "55.00"}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(UserGamePrice.objects.count(), 1)  # upsert, not duplicate
        self.assertEqual(UserGamePrice.objects.get().price, Decimal("55.00"))

    def test_get_lists_only_my_prices(self):
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40"))
        UserGamePrice.objects.create(user=self.user_b, event=self.event, board_game=self.game_brass, price=Decimal("99"))
        r = self.client.get(self.url)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(Decimal(r.data[0]["price"]), Decimal("40"))

    def test_negative_price_rejected(self):
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "-5"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_zero_price_rejected(self):
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "0"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "40"}, format="json")
        self.assertIn(r.status_code, (401, 403))  # depends on DRF auth classes

    def test_delete_removes_my_price(self):
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40"))
        r = self.client.delete(f"{self.url}?board_game={self.game_brass.bgg_id}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(UserGamePrice.objects.count(), 0)

    def test_delete_without_param_400(self):
        r = self.client.delete(self.url)
        self.assertEqual(r.status_code, 400)


class WantBidEndpointTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(user=self.user_a)
        self.url = f"/api/events/{self.slug}/want-bids/"

    def test_put_listing_upsert(self):
        body = {"event_listing": self.el_b1.id, "amount": "25"}
        r1 = self.client.put(self.url, body, format="json")
        self.assertEqual(r1.status_code, 200, r1.data)
        r2 = self.client.put(self.url, {**body, "amount": "30"}, format="json")
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertEqual(WantBid.objects.count(), 1)
        self.assertEqual(WantBid.objects.get().amount, Decimal("30"))
        self.assertEqual(WantBid.objects.get().event_listing_id, self.el_b1.id)

    def test_delete_bid(self):
        WantBid.objects.create(user=self.user_a, event=self.event,
                               event_listing=self.el_b1, amount=Decimal("10"))
        r = self.client.delete(f"{self.url}?event_listing={self.el_b1.id}")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(WantBid.objects.count(), 0)

    def test_delete_without_param_400(self):
        r = self.client.delete(self.url)
        self.assertEqual(r.status_code, 400)

    def test_delete_non_numeric_param_400(self):
        r = self.client.delete(f"{self.url}?event_listing=abc")
        self.assertEqual(r.status_code, 400)

    def test_listing_from_other_event_rejected(self):
        from events.models import TradeEvent, EventListing
        other = TradeEvent.objects.create(
            name="Other Ev", organizer=self.user_a,
            status=TradeEvent.Status.SUBMISSIONS_OPEN,
        )
        other_listing = EventListing.objects.create(event=other, copy=self.copy_a1)
        body = {"event_listing": other_listing.id, "amount": "5"}
        r = self.client.put(self.url, body, format="json")
        self.assertEqual(r.status_code, 400)


class SellPricePatchTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.url = f"/api/events/{self.slug}/listings/{self.el_a1.id}/"

    def test_owner_sets_sell_price(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": "18.50"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.el_a1.refresh_from_db()
        self.assertEqual(self.el_a1.sell_price, Decimal("18.50"))

    def test_non_owner_forbidden(self):
        self.client.force_authenticate(user=self.user_b)
        r = self.client.patch(self.url, {"sell_price": "1"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_clear_sell_price_with_null(self):
        self.el_a1.sell_price = Decimal("9")
        self.el_a1.save(update_fields=["sell_price"])
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": None}, format="json")
        self.assertEqual(r.status_code, 200)
        self.el_a1.refresh_from_db()
        self.assertIsNone(self.el_a1.sell_price)

    def test_negative_sell_price_rejected(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": "-1"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_zero_sell_price_rejected(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": "0"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_patch_cannot_change_active_or_copy(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"active": False, "sell_price": "5"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.el_a1.refresh_from_db()
        self.assertTrue(self.el_a1.active)          # active untouched by PATCH
        self.assertEqual(self.el_a1.sell_price, Decimal("5"))


class ResolvedReadFieldTests(MatchingTestBase):
    def test_listing_resolved_ask_and_override_flag(self):
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40"))
        from events.serializers import EventListingSerializer
        data = EventListingSerializer(self.el_a1, context={"request": None}).data
        self.assertEqual(Decimal(data["resolved_ask"]), Decimal("40"))
        self.assertFalse(data["ask_is_override"])
        self.el_a1.sell_price = Decimal("33")
        self.el_a1.save(update_fields=["sell_price"])
        data = EventListingSerializer(self.el_a1, context={"request": None}).data
        self.assertEqual(Decimal(data["resolved_ask"]), Decimal("33"))
        self.assertTrue(data["ask_is_override"])

    def test_want_item_resolved_bid_from_game_default(self):
        from trades.models import WantGroup, WantGroupItem
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("22"))
        wg = WantGroup.objects.create(event=self.event, user=self.user_a, name="wg")
        item = WantGroupItem.objects.create(
            want_group=wg, event_listing=self.el_b1
        )  # el_b1 is a terra copy
        from trades.serializers import WantGroupItemSerializer
        data = WantGroupItemSerializer(item, context={"event": self.event}).data
        self.assertEqual(Decimal(data["resolved_bid"]), Decimal("22"))
        self.assertFalse(data["bid_is_override"])

    def test_want_item_listing_bid_override(self):
        from trades.models import WantGroup, WantGroupItem, WantBid
        wg = WantGroup.objects.create(event=self.event, user=self.user_a, name="wg2")
        item = WantGroupItem.objects.create(
            want_group=wg, event_listing=self.el_b1
        )
        WantBid.objects.create(
            user=self.user_a, event=self.event,
            event_listing=self.el_b1, amount=Decimal("17"),
        )
        from trades.serializers import WantGroupItemSerializer
        data = WantGroupItemSerializer(item, context={"event": self.event}).data
        self.assertEqual(Decimal(data["resolved_bid"]), Decimal("17"))
        self.assertTrue(data["bid_is_override"])
