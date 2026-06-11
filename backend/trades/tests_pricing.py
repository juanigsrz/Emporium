"""Pricing model refactor — models, resolution, and endpoints."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from matching.tests import MatchingTestBase
from trades.models import UserGamePrice, WantBid


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
        self.assertEqual(WantBid.objects.count(), 1)
