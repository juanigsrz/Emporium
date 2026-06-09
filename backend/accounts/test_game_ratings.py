from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame

User = get_user_model()


class GameRatingApiTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        BoardGame.objects.create(bgg_id=224517, name="Brass")
        self.client.force_authenticate(self.u)

    def test_create_and_list_mine(self):
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "8.5"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["board_game"], 224517)
        self.assertEqual(r.data["board_game_name"], "Brass")
        lst = self.client.get("/api/game-ratings/")
        self.assertEqual(lst.data["count"] if "count" in lst.data else len(lst.data), 1)

    def test_upsert_on_repeat(self):
        self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "8"}, format="json")
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "9"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(str(r.data["value"]), "9.0")

    def test_out_of_range_rejected(self):
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "11"}, format="json")
        self.assertEqual(r.status_code, 400)
