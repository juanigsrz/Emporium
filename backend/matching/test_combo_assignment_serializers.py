"""Combo TradeAssignments (event_listing=None) must serialize cleanly on the
/mine/, /shipping/, and /shipping/overview/ endpoints — a combo row carries a
combo target instead of a single listing."""
import json

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from trades.models import (
    OfferGroup, OfferGroupItem, TradeWish, WantGroup, WantGroupItem,
)

User = get_user_model()


class ComboAssignmentSerializerTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("eo", "eo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("ew", "ew@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=5001, name="Wing")
        cls.bg2 = BoardGame.objects.create(bgg_id=5002, name="WingExp")
        cls.bgw = BoardGame.objects.create(bgg_id=5003, name="Wisher Game")
        cls.event = TradeEvent.objects.create(
            name="E Ev", organizer=cls.owner, status="MATCHING"
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(
            event=cls.event, owner=cls.owner, name="WS bundle"
        )
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)
        cls.cw = Copy.objects.create(owner=cls.wisher, board_game=cls.bgw)
        cls.elw = EventListing.objects.create(event=cls.event, copy=cls.cw)

        # wisher: offer elw -> want the combo
        og = OfferGroup.objects.create(event=cls.event, user=cls.wisher, name="og", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, event_listing=cls.elw)
        wg = WantGroup.objects.create(event=cls.event, user=cls.wisher, name="wg", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, combo=cls.combo)
        TradeWish.objects.create(event=cls.event, user=cls.wisher, offer_group=og,
                                 want_group=wg, active=True)
        # owner: offer the combo -> want the wisher's copy
        og2 = OfferGroup.objects.create(event=cls.event, user=cls.owner, name="og2", max_give=1)
        OfferGroupItem.objects.create(offer_group=og2, combo=cls.combo)
        wg2 = WantGroup.objects.create(event=cls.event, user=cls.owner, name="wg2", min_receive=1)
        WantGroupItem.objects.create(want_group=wg2, event_listing=cls.elw)
        TradeWish.objects.create(event=cls.event, user=cls.owner, offer_group=og2,
                                 want_group=wg2, active=True)

    def _upload(self):
        self.client.force_authenticate(user=self.owner)
        doc = {
            "version": "1.0.0", "trades": [],
            "combos": [
                {"sent": [self.cw.listing_code], "taken": [self.combo.combo_code]},
                {"sent": [self.combo.combo_code], "taken": [self.cw.listing_code]},
            ],
            "cash_purchases": [], "cash_summary": [], "settlement": [],
        }
        resp = self.client.post(
            f"/api/events/{self.event.slug}/matches/upload/",
            json.dumps(doc), content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        return resp.data["id"]

    def test_mine_serializes_combo_row(self):
        run_id = self._upload()
        self.client.force_authenticate(user=self.wisher)
        resp = self.client.get(f"/api/events/{self.event.slug}/matches/{run_id}/mine/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        rows = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        # the combo the wisher receives
        combo_row = next(r for r in rows if r["combo_code"] == self.combo.combo_code)
        self.assertIsNone(combo_row["listing_code"])
        self.assertIsNone(combo_row["copy_id"])
        self.assertEqual(combo_row["combo_name"], "WS bundle")
        self.assertCountEqual(
            combo_row["members"], [self.c1.listing_code, self.c2.listing_code]
        )
        self.assertIn("Wing", combo_row["board_game_name"])

    def test_shipping_serializes_combo_row(self):
        self._upload()
        self.event.status = "SHIPPING"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(user=self.wisher)
        resp = self.client.get(f"/api/events/{self.event.slug}/shipping/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        combo_ships = [s for s in resp.data if s["combo_code"] == self.combo.combo_code]
        self.assertTrue(combo_ships)
        self.assertIsNone(combo_ships[0]["listing_code"])
        self.assertCountEqual(
            combo_ships[0]["members"], [self.c1.listing_code, self.c2.listing_code]
        )

    def test_shipping_overview_serializes_combo_row(self):
        self._upload()
        self.client.force_authenticate(user=self.owner)
        resp = self.client.get(f"/api/events/{self.event.slug}/shipping/overview/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        rows = resp.data["results"]
        self.assertTrue(any(s["combo_code"] == self.combo.combo_code for s in rows))
