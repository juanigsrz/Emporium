"""A non-ACTIVE copy (e.g. TRADED from a prior cycle) can't be listed."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import TradeEvent

User = get_user_model()


class ListingStatusGuardTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("lsg", "lsg@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=11500, name="Guarded")
        cls.event = TradeEvent.objects.create(
            name="Guard Ev", organizer=cls.u, status="SUBMISSIONS_OPEN"
        )

    def test_traded_copy_cannot_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN",
                                   status=Copy.Status.TRADED)
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_active_copy_can_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
