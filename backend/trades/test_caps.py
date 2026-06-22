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
