"""Event browse: image_url, center_place (reverse geocode), archived default, ?joined."""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.geo import reverse_geocode
from events.models import EventParticipation, TradeEvent

User = get_user_model()
EVENTS = "/api/events/"


class EventBrowseTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = User.objects.create_user("eb_org", "ebo@t.test", "pass1234")
        cls.other = User.objects.create_user("eb_other", "ebx@t.test", "pass1234")

    def test_reverse_geocode_returns_display_name(self):
        with patch("accounts.geo.requests.get") as g:
            g.return_value.json.return_value = {"display_name": "Buenos Aires, Argentina"}
            g.return_value.raise_for_status.return_value = None
            self.assertEqual(reverse_geocode(-34.6, -58.4), "Buenos Aires, Argentina")

    def test_reverse_geocode_none_on_error(self):
        with patch("accounts.geo.requests.get", side_effect=Exception("down")):
            self.assertIsNone(reverse_geocode(-34.6, -58.4))

    def test_create_with_center_stores_place_and_image(self):
        self.client.force_authenticate(self.org)
        with patch("events.serializers.reverse_geocode", return_value="Rosario, AR") as rg:
            resp = self.client.post(EVENTS, {
                "name": "Geo Ev", "image_url": "https://x/y.png",
                "center_latitude": -32.95, "center_longitude": -60.66,
            }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["image_url"], "https://x/y.png")
        self.assertEqual(resp.data["center_place"], "Rosario, AR")
        rg.assert_called_once()

    def test_default_list_excludes_archived(self):
        TradeEvent.objects.create(name="Live", organizer=self.org, status="SUBMISSIONS_OPEN")
        TradeEvent.objects.create(name="Done", organizer=self.org, status="ARCHIVED")
        self.client.force_authenticate(self.org)
        names = {e["name"] for e in self.client.get(EVENTS).data["results"]}
        self.assertIn("Live", names)
        self.assertNotIn("Done", names)
        # explicit ?status=ARCHIVED still returns them
        arch = self.client.get(f"{EVENTS}?status=ARCHIVED").data["results"]
        self.assertTrue(any(e["name"] == "Done" for e in arch))

    def test_joined_filter(self):
        ev = TradeEvent.objects.create(name="Joined", organizer=self.other, status="WANTLIST_OPEN")
        TradeEvent.objects.create(name="NotJoined", organizer=self.other, status="WANTLIST_OPEN")
        EventParticipation.objects.create(event=ev, user=self.org)
        self.client.force_authenticate(self.org)
        names = {e["name"] for e in self.client.get(f"{EVENTS}?joined=1").data["results"]}
        self.assertEqual(names, {"Joined"})
