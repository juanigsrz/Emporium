"""
events/test_admin_dashboard.py

Organizer manage-dashboard tests: kick cascade + admin endpoints.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from events.admin_actions import kick_participant
from events.tests import import_boardgames_csv, _make_csv, SAMPLE_ROWS
from trades.models import (
    OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, WantBid,
)

User = get_user_model()


class AdminDashboardBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        import os
        csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=csv_path)
        os.unlink(csv_path)

        cls.organizer = User.objects.create_user("org", password="pass1234", email="o@x.com")
        cls.victim = User.objects.create_user("victim", password="pass1234", email="v@x.com")
        cls.other = User.objects.create_user("other", password="pass1234", email="t@x.com")
        cls.game1 = BoardGame.objects.get(bgg_id=224517)
        cls.game2 = BoardGame.objects.get(bgg_id=342942)

    def setUp(self):
        # Fresh event per test so deletes don't leak across tests.
        self.event = TradeEvent.objects.create(
            name="Manage Test", slug="manage-test", organizer=self.organizer,
            status=TradeEvent.Status.MATCH_REVIEW,
        )
        # victim lists copy of game1; other lists copy of game2.
        EventParticipation.objects.create(event=self.event, user=self.victim)
        EventParticipation.objects.create(event=self.event, user=self.other)
        self.victim_copy = Copy.objects.create(owner=self.victim, board_game=self.game1)
        self.other_copy = Copy.objects.create(owner=self.other, board_game=self.game2)
        self.victim_listing = EventListing.objects.create(event=self.event, copy=self.victim_copy)
        self.other_listing = EventListing.objects.create(event=self.event, copy=self.other_copy)

        # victim has an offer+want+wish trio.
        self.v_offer = OfferGroup.objects.create(event=self.event, user=self.victim, name="vo")
        OfferGroupItem.objects.create(offer_group=self.v_offer, event_listing=self.victim_listing)
        self.v_want = WantGroup.objects.create(event=self.event, user=self.victim, name="vw")
        WantGroupItem.objects.create(want_group=self.v_want,
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game2)
        TradeWish.objects.create(event=self.event, user=self.victim,
            offer_group=self.v_offer, want_group=self.v_want)

        # other wants victim's SPECIFIC listing (LISTING target) + a bid on it.
        self.o_want = WantGroup.objects.create(event=self.event, user=self.other, name="ow")
        self.o_listing_item = WantGroupItem.objects.create(want_group=self.o_want,
            target_type=WantGroupItem.TargetType.LISTING, event_listing=self.victim_listing)
        # other also wants game2 by BOARD_GAME (must survive the kick).
        self.o_game_item = WantGroupItem.objects.create(want_group=self.o_want,
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game2)
        self.o_bid = WantBid.objects.create(user=self.other, event=self.event,
            target_type=WantBid.TargetType.LISTING, event_listing=self.victim_listing, amount=5)


class KickServiceTests(AdminDashboardBase):
    def test_kick_removes_victim_event_data_keeps_copy(self):
        summary = kick_participant(self.event, self.victim)
        # victim's event-scoped rows gone
        self.assertFalse(EventParticipation.objects.filter(event=self.event, user=self.victim).exists())
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        self.assertFalse(OfferGroup.objects.filter(user=self.victim, event=self.event).exists())
        self.assertFalse(WantGroup.objects.filter(user=self.victim, event=self.event).exists())
        self.assertFalse(TradeWish.objects.filter(user=self.victim, event=self.event).exists())
        # Copy preserved
        self.assertTrue(Copy.objects.filter(pk=self.victim_copy.pk).exists())
        # summary
        self.assertEqual(summary["removed_listings"], 1)
        self.assertEqual(summary["removed_wishes"], 1)
        self.assertEqual(summary["affected_other_users"], 1)

    def test_kick_cascades_other_users_listing_refs_only(self):
        kick_participant(self.event, self.victim)
        # other's LISTING-type want + listing bid (pointed at victim's listing) gone
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())
        self.assertFalse(WantBid.objects.filter(pk=self.o_bid.pk).exists())
        # other's BOARD_GAME want survives, and other's own want group + listing remain
        self.assertTrue(WantGroupItem.objects.filter(pk=self.o_game_item.pk).exists())
        self.assertTrue(WantGroup.objects.filter(pk=self.o_want.pk).exists())
        self.assertTrue(EventListing.objects.filter(pk=self.other_listing.pk).exists())


class AdminSubmissionsTests(AdminDashboardBase):
    URL = "/api/events/manage-test/admin/submissions/"

    def test_non_organizer_gets_403(self):
        self.client.force_authenticate(self.other)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 403)

    def test_organizer_sees_victim_listings_and_wishes(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["username"], "victim")
        self.assertEqual(len(r.data["listings"]), 1)
        self.assertEqual(len(r.data["wishes"]), 1)
        self.assertEqual(r.data["offer_groups"][0]["max_give"], 1)
        self.assertEqual(r.data["want_groups"][0]["min_receive"], 1)

    def test_archived_event_blocks_admin(self):
        self.event.status = TradeEvent.Status.ARCHIVED
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.organizer)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 403)


class AdminEditTests(AdminDashboardBase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.organizer)
        self.wish = TradeWish.objects.get(event=self.event, user=self.victim)

    def test_toggle_wish_active(self):
        url = f"/api/events/manage-test/admin/wishes/{self.wish.id}/"
        r = self.client.patch(url, {"active": False}, format="json")
        self.assertEqual(r.status_code, 200)
        self.wish.refresh_from_db()
        self.assertFalse(self.wish.active)

    def test_edit_offer_max_give(self):
        url = f"/api/events/manage-test/admin/offer-groups/{self.v_offer.id}/"
        r = self.client.patch(url, {"max_give": 3}, format="json")
        self.assertEqual(r.status_code, 200)
        self.v_offer.refresh_from_db()
        self.assertEqual(self.v_offer.max_give, 3)

    def test_edit_offer_max_give_rejects_zero(self):
        url = f"/api/events/manage-test/admin/offer-groups/{self.v_offer.id}/"
        r = self.client.patch(url, {"max_give": 0}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_edit_want_min_receive(self):
        url = f"/api/events/manage-test/admin/want-groups/{self.v_want.id}/"
        r = self.client.patch(url, {"min_receive": 2}, format="json")
        self.assertEqual(r.status_code, 200)
        self.v_want.refresh_from_db()
        self.assertEqual(self.v_want.min_receive, 2)

    def test_unlist_listing_cascades(self):
        url = f"/api/events/manage-test/admin/listings/{self.victim_listing.id}/"
        r = self.client.delete(url)
        self.assertEqual(r.status_code, 204)
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        # other's LISTING want at that listing is cascade-removed
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())

    def test_non_organizer_cannot_edit(self):
        self.client.force_authenticate(self.other)
        url = f"/api/events/manage-test/admin/wishes/{self.wish.id}/"
        r = self.client.patch(url, {"active": False}, format="json")
        self.assertEqual(r.status_code, 403)


class AdminKickEndpointTests(AdminDashboardBase):
    URL = "/api/events/manage-test/admin/kick/"

    def test_organizer_kicks_user(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.post(self.URL, {"username": "victim"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["removed_listings"], 1)
        self.assertEqual(r.data["removed_wishes"], 1)
        self.assertEqual(r.data["affected_other_users"], 1)
        self.assertFalse(
            EventParticipation.objects.filter(event=self.event, user=self.victim).exists()
        )

    def test_cannot_kick_self(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.post(self.URL, {"username": "org"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_non_organizer_cannot_kick(self):
        self.client.force_authenticate(self.other)
        r = self.client.post(self.URL, {"username": "victim"}, format="json")
        self.assertEqual(r.status_code, 403)
