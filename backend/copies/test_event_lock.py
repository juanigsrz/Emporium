"""A copy listed in an active event is locked in the owner's profile."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class CopyEventLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("clock", "c@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=33300, name="Locked")

    def _make_copy(self):
        return Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")

    def _list_in(self, copy, status_value):
        ev = TradeEvent.objects.create(name=status_value, organizer=self.u,
                                       status=status_value)
        EventListing.objects.create(event=ev, copy=copy)

    def test_edit_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "WANTLIST_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"condition": "FAIR"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_withdraw_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "SUBMISSIONS_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"status": "WITHDRAWN"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "WANTLIST_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.delete(f"/api/copies/{copy.id}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_edit_allowed_when_event_archived(self):
        copy = self._make_copy()
        self._list_in(copy, "ARCHIVED")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"owner_notes": "ok"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_edit_allowed_when_not_listed(self):
        copy = self._make_copy()
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"owner_notes": "ok"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_serializer_exposes_in_active_event(self):
        copy = self._make_copy()
        self.client.force_authenticate(self.u)
        r1 = self.client.get(f"/api/copies/{copy.id}/")
        self.assertFalse(r1.data["in_active_event"])
        self._list_in(copy, "WANTLIST_OPEN")
        r2 = self.client.get(f"/api/copies/{copy.id}/")
        self.assertTrue(r2.data["in_active_event"])
