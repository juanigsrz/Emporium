"""A user must join an event before they can enter it into matching:
listing a copy and creating a wish both require participation. This closes the
join-time gates (location, single-active-event, submissions lock) that were
otherwise bypassable by never calling /join/."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from trades.models import OfferGroup, WantGroup

User = get_user_model()


class ParticipationGateTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user("org", "org@t.test", "pass1234")
        cls.outsider = User.objects.create_user("out", "out@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=771, name="Gate")
        cls.event = TradeEvent.objects.create(
            name="Gate Ev", organizer=cls.organizer, status="SUBMISSIONS_OPEN"
        )
        cls.copy = Copy.objects.create(
            owner=cls.outsider, board_game=cls.bg, condition="GOOD", language="EN"
        )

    def test_non_participant_cannot_list(self):
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": self.copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_participant_can_list(self):
        EventParticipation.objects.create(event=self.event, user=self.outsider)
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": self.copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_non_participant_cannot_create_wish(self):
        # Give the outsider groups directly (no gate on those), then attempt a wish.
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        og = OfferGroup.objects.create(event=self.event, user=self.outsider, name="og")
        wg = WantGroup.objects.create(event=self.event, user=self.outsider, name="wg")
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/wishes/",
            {"offer_group": og.id, "want_group": wg.id, "active": True}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
