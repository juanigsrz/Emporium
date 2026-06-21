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
