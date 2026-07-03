"""Combo export: item/ask/bid entries, give/take, and givecap directives."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from trades.models import (
    OfferGroup, OfferGroupItem, TradeWish, WantBid, WantGroup, WantGroupItem,
)
from matching.external_solver import build_wants

User = get_user_model()


class ComboExportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("eo", "eo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("ew", "ew@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=5001, name="Wing")
        cls.bg2 = BoardGame.objects.create(bgg_id=5002, name="WingExp")
        cls.bgw = BoardGame.objects.create(bgg_id=5003, name="Wisher Game")
        cls.event = TradeEvent.objects.create(
            name="E Ev", organizer=cls.owner, status="WANTLIST_OPEN", money_enabled=True
        )
        # owner's two copies -> combo
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(
            event=cls.event, owner=cls.owner, name="WS bundle", sell_price="40.00"
        )
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)
        # wisher's copy to offer for the combo
        cls.cw = Copy.objects.create(owner=cls.wisher, board_game=cls.bgw)
        cls.elw = EventListing.objects.create(event=cls.event, copy=cls.cw)

        # wisher: offer elw -> want the combo (a wish)
        og = OfferGroup.objects.create(event=cls.event, user=cls.wisher, name="og", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, event_listing=cls.elw)
        wg = WantGroup.objects.create(event=cls.event, user=cls.wisher, name="wg", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, combo=cls.combo)
        TradeWish.objects.create(event=cls.event, user=cls.wisher, offer_group=og,
                                 want_group=wg, active=True)
        WantBid.objects.create(user=cls.wisher, event=cls.event, combo=cls.combo, amount="42.00")

    def _doc(self):
        return json.loads(build_wants(self.event))

    def test_combo_item_entry_with_ask(self):
        self.assertIn(
            {"name": self.combo.combo_code, "owner": self.owner.username, "ask": 4000},
            self._doc()["items"],
        )

    def test_combo_bid_entry(self):
        self.assertIn(
            {"user": self.wisher.username, "item": self.combo.combo_code,
             "max_price": 4200},
            self._doc()["bids"],
        )

    def test_givecap_per_member(self):
        givecaps = self._doc()["givecaps"]
        member_sets = [
            set(c["items"]) for c in givecaps
            if c["user"] == self.owner.username and c["n"] == 1
        ]
        self.assertIn({self.c1.listing_code, self.combo.combo_code}, member_sets)
        self.assertIn({self.c2.listing_code, self.combo.combo_code}, member_sets)

    def test_combo_appears_as_take(self):
        wishes = [w for w in self._doc()["wishes"] if w["user"] == self.wisher.username]
        self.assertTrue(any(self.combo.combo_code in w["take"] for w in wishes),
                        f"combo not in any wish take side: {wishes}")

    def test_combo_appears_as_give(self):
        # owner offers the combo (give side) in exchange for the wisher's game
        og = OfferGroup.objects.create(event=self.event, user=self.owner,
                                       name="og2", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, combo=self.combo)
        wg = WantGroup.objects.create(event=self.event, user=self.owner,
                                      name="wg2", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, event_listing=self.elw)
        TradeWish.objects.create(event=self.event, user=self.owner, offer_group=og,
                                 want_group=wg, active=True)
        owner_wishes = [w for w in self._doc()["wishes"] if w["user"] == self.owner.username]
        self.assertTrue(any(self.combo.combo_code in w["give"] for w in owner_wishes),
                        f"combo not on give side: {owner_wishes}")


from matching.external_solver import load_solution
from matching.models import MatchRun, TradeAssignment


class ComboLoadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("lo", "lo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("lw", "lw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=6001, name="L1")
        cls.bg2 = BoardGame.objects.create(bgg_id=6002, name="L2")
        cls.bgw = BoardGame.objects.create(bgg_id=6003, name="LW")
        cls.event = TradeEvent.objects.create(
            name="L Ev", organizer=cls.owner, status="MATCHING", money_enabled=False
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)
        cls.cw = Copy.objects.create(owner=cls.wisher, board_game=cls.bgw)
        cls.elw = EventListing.objects.create(event=cls.event, copy=cls.cw)

    def test_combo_move_loads_as_single_assignment(self):
        run = MatchRun.objects.create(event=self.event, algorithm="gurobi")
        # wisher gives their copy LW, receives the combo:
        #   {give: combo, take: LW} reads combo given so wisher's item received
        # Solver emits two barter edges for the cycle; the combo token is K-...
        out = json.dumps({"trades": [
            {"give": self.combo.combo_code, "take": self.cw.listing_code},
            {"give": self.cw.listing_code, "take": self.combo.combo_code},
        ]})
        result, summary, log = load_solution(run, out)
        combo_rows = TradeAssignment.objects.filter(match_run=run, combo=self.combo)
        self.assertEqual(combo_rows.count(), 1)
        row = combo_rows.first()
        self.assertIsNone(row.event_listing_id)
        self.assertEqual(row.giver_id, self.owner.id)
        self.assertEqual(row.receiver_id, self.wisher.id)

    def test_combo_move_links_wish_id(self):
        # wisher has a wish wanting the combo -> the combo assignment carries wish_id
        og = OfferGroup.objects.create(event=self.event, user=self.wisher,
                                       name="og", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, event_listing=self.elw)
        wg = WantGroup.objects.create(event=self.event, user=self.wisher,
                                      name="wg", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        wish = TradeWish.objects.create(event=self.event, user=self.wisher,
                                        offer_group=og, want_group=wg, active=True)
        run = MatchRun.objects.create(event=self.event, algorithm="gurobi")
        out = json.dumps({"trades": [
            {"give": self.combo.combo_code, "take": self.cw.listing_code},
            {"give": self.cw.listing_code, "take": self.combo.combo_code},
        ]})
        load_solution(run, out)
        row = TradeAssignment.objects.get(match_run=run, combo=self.combo)
        self.assertEqual(row.wish_id, wish.id)
