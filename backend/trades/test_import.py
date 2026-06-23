"""import_user_trades + the import-trades endpoint."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from trades.models import UserGamePrice, WantGroup, WantGroupItem

User = get_user_model()


class ImportTradesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.me = User.objects.create_user("imp_me", "me@t.test", "pass1234")
        cls.other = User.objects.create_user("imp_other", "o@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=12001, name="Imp1")
        cls.bg2 = BoardGame.objects.create(bgg_id=12002, name="Imp2")

        cls.src = TradeEvent.objects.create(name="Src Ev", organizer=cls.me,
                                            status="ARCHIVED")
        cls.dst = TradeEvent.objects.create(name="Dst Ev", organizer=cls.me,
                                            status="WANTLIST_OPEN")
        for ev in (cls.src, cls.dst):
            EventParticipation.objects.create(event=ev, user=cls.me)
            EventParticipation.objects.create(event=ev, user=cls.other)

        # Source: my per-game price + a want group wanting bg1 (other's copy).
        UserGamePrice.objects.create(user=cls.me, event=cls.src, board_game=cls.bg1, price=15)
        src_copy = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        src_el = EventListing.objects.create(event=cls.src, copy=src_copy)
        wg = WantGroup.objects.create(user=cls.me, event=cls.src, name="my wants",
                                      min_receive=1, duplicate_protection=True)
        WantGroupItem.objects.create(want_group=wg, event_listing=src_el)

        # Target: another copy of bg1 by other, plus an unrelated bg2 copy.
        dst_copy1 = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.dst_el1 = EventListing.objects.create(event=cls.dst, copy=dst_copy1)
        dst_copy2 = Copy.objects.create(owner=cls.other, board_game=cls.bg2)
        cls.dst_el2 = EventListing.objects.create(event=cls.dst, copy=dst_copy2)

    def _url(self, slug):
        return f"/api/events/{slug}/import-trades/"

    def test_import_copies_prices_and_wants(self):
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["prices"], 1)
        self.assertEqual(resp.data["want_groups"], 1)
        # price copied to target
        self.assertTrue(UserGamePrice.objects.filter(
            user=self.me, event=self.dst, board_game=self.bg1, price=15).exists())
        # want group re-created, targeting the target's bg1 listing
        wg = WantGroup.objects.get(user=self.me, event=self.dst)
        self.assertEqual(wg.name, "my wants")
        self.assertTrue(wg.items.filter(event_listing=self.dst_el1).exists())
        self.assertFalse(wg.items.filter(event_listing=self.dst_el2).exists())

    def test_wants_skipped_when_target_has_want_groups(self):
        WantGroup.objects.create(user=self.me, event=self.dst, name="existing",
                                 min_receive=1)
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["want_groups"], 0)  # dedup guard

    def test_reject_same_event(self):
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.dst.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_non_participant_source(self):
        stranger_event = TradeEvent.objects.create(name="Stranger", organizer=self.other,
                                                   status="ARCHIVED")
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": stranger_event.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_locked_target(self):
        self.dst.status = "MATCHING"
        self.dst.save(update_fields=["status"])
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
