from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import TradeEvent

User = get_user_model()


class PendingListingGuardTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.bg = BoardGame.objects.create(bgg_id=224517, name="Brass")
        self.event = TradeEvent.objects.create(name="E", organizer=self.u)
        self.client.force_authenticate(self.u)

    def test_pending_copy_rejected(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg, is_pending=True)
        r = self.client.post(f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_complete_copy_accepted(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg, language="English", condition="GOOD", is_pending=False)
        r = self.client.post(f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json")
        self.assertEqual(r.status_code, 201)
