"""resolved_ask is private: only the copy owner sees their own ask."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class AskPrivacyTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("askowner", "o@t.test", "pass1234")
        cls.other = User.objects.create_user("askother", "x@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=22200, name="Priced")
        cls.event = TradeEvent.objects.create(
            name="Ask Ev", organizer=cls.owner, status="WANTLIST_OPEN",
            money_enabled=True,
        )
        copy = Copy.objects.create(owner=cls.owner, board_game=cls.bg,
                                   condition="GOOD", language="EN")
        cls.listing = EventListing.objects.create(
            event=cls.event, copy=copy, sell_price="12.50"
        )

    def _ask_for(self, requester):
        self.client.force_authenticate(requester)
        resp = self.client.get(f"/api/events/{self.event.slug}/listings/")
        self.assertEqual(resp.status_code, 200)
        return resp.data["results"][0]["resolved_ask"]

    def test_owner_sees_own_ask(self):
        self.assertEqual(self._ask_for(self.owner), "12.50")

    def test_other_user_cannot_see_ask(self):
        self.assertIsNone(self._ask_for(self.other))
