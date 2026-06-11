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

    def test_want_bid_board_game_target_requires_board_game(self):
        wb = WantBid(
            user=self.user_a, event=self.event,
            target_type=WantBid.TargetType.BOARD_GAME, amount=Decimal("30"),
        )
        with self.assertRaises(ValidationError):
            wb.clean()

    def test_want_bid_listing_target_ok(self):
        wb = WantBid(
            user=self.user_a, event=self.event,
            target_type=WantBid.TargetType.LISTING,
            event_listing=self.el_b1, amount=Decimal("30"),
        )
        wb.clean()  # no raise
        wb.save()
        self.assertEqual(WantBid.objects.filter(user=self.user_a).count(), 1)


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
            target_type=WantBid.TargetType.BOARD_GAME,
            board_game=self.game_terra, amount=Decimal("25"),
        )
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game_terra
        )
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("25"))

    def test_listing_target_uses_listing_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("20")
        )
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.LISTING, event_listing=self.el_b1
        )  # el_b1 is a terra copy
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("20"))

    def test_none_when_no_bid(self):
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game_terra
        )
        self.assertIsNone(pricing.resolve_bid(self.user_a, self.event, target))
