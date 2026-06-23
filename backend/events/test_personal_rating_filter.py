"""The event games endpoint's min_rating filters by the user's personal rating."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import GameRating
from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class PersonalRatingFilterTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.me = User.objects.create_user("pr_me", "prm@t.test", "pass1234")
        cls.owner = User.objects.create_user("pr_owner", "pro@t.test", "pass1234")
        # Two games; bg_low has a HIGH bgg average but the user rates it LOW,
        # bg_high has a LOW bgg average but the user rates it HIGH — so a personal
        # filter and a bgg filter give opposite results (proves it's personal).
        cls.bg_low = BoardGame.objects.create(bgg_id=30001, name="LowPersonal", average=9.5)
        cls.bg_high = BoardGame.objects.create(bgg_id=30002, name="HighPersonal", average=4.0)
        cls.event = TradeEvent.objects.create(name="PR Ev", organizer=cls.owner,
                                              status="WANTLIST_OPEN")
        for bg in (cls.bg_low, cls.bg_high):
            c = Copy.objects.create(owner=cls.owner, board_game=bg)
            EventListing.objects.create(event=cls.event, copy=c)
        GameRating.objects.create(user=cls.me, board_game=cls.bg_low, value=3)
        GameRating.objects.create(user=cls.me, board_game=cls.bg_high, value=9)

    def _games(self, **params):
        self.client.force_authenticate(self.me)
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client.get(f"/api/events/{self.event.slug}/games/?{qs}")

    def test_min_rating_uses_personal_not_bgg(self):
        resp = self._games(min_rating=8)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        names = {g["name"] for g in resp.data["results"]}
        # personal: only HighPersonal (rated 9) qualifies; LowPersonal (rated 3) excluded
        # even though its BGG average (9.5) is high.
        self.assertEqual(names, {"HighPersonal"})

    def test_no_qualifying_ratings_empty(self):
        resp = self._games(min_rating=10)
        self.assertEqual(resp.data["results"], [])

    def test_no_filter_returns_all(self):
        resp = self._games()
        names = {g["name"] for g in resp.data["results"]}
        self.assertEqual(names, {"LowPersonal", "HighPersonal"})
