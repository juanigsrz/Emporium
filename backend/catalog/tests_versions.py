from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status

from catalog.models import BoardGame, BoardGameVersion
from catalog.serializers import BoardGameDetailSerializer, BoardGameListSerializer


class BoardGameListThumbnailTest(TestCase):
    def test_list_serializer_exposes_thumbnail_from_metadata(self):
        game = BoardGame.objects.create(
            bgg_id=13, name="Catan", metadata={"thumbnail": "https://x/t.png"}
        )
        data = BoardGameListSerializer(game).data
        self.assertEqual(data["thumbnail"], "https://x/t.png")

    def test_list_serializer_thumbnail_defaults_blank(self):
        game = BoardGame.objects.create(bgg_id=99, name="No Meta")
        data = BoardGameListSerializer(game).data
        self.assertEqual(data["thumbnail"], "")


class BoardGameVersionModelTest(TestCase):
    def test_create_real_version(self):
        game = BoardGame.objects.create(bgg_id=13, name="Catan")
        v = BoardGameVersion.objects.create(
            board_game=game, bgg_version_id=416798, name="Afrikaans edition",
            language="Afrikaans", publisher="Catan Studio", width=11.7,
        )
        self.assertEqual(game.versions.count(), 1)
        self.assertEqual(v.bgg_version_id, 416798)

    def test_get_or_create_unknown_is_idempotent(self):
        game = BoardGame.objects.create(bgg_id=13, name="Catan")
        u1 = BoardGameVersion.get_or_create_unknown(game)
        u2 = BoardGameVersion.get_or_create_unknown(game)
        self.assertEqual(u1.pk, u2.pk)
        self.assertEqual(u1.name, "Unknown")
        self.assertEqual(u1.language, "Unknown")
        self.assertIsNone(u1.bgg_version_id)
        self.assertEqual(game.versions.count(), 1)


class DetailEnrichmentFieldsTest(TestCase):
    def test_serializer_exposes_metadata_enrichment(self):
        game = BoardGame.objects.create(
            bgg_id=13, name="Catan",
            metadata={
                "thumbnail": "https://x/thumb.png",
                "min_players": 3, "max_players": 4, "average_weight": 2.28,
                "language_dependence": 2, "language_dependence_label": "Some text",
            },
        )
        data = BoardGameDetailSerializer(game).data
        self.assertEqual(data["thumbnail"], "https://x/thumb.png")
        self.assertEqual(data["average_weight"], 2.28)
        self.assertEqual(data["language_dependence"], 2)
        self.assertEqual(data["language_dependence_label"], "Some text")
        self.assertEqual(data["min_players"], 3)


class GameVersionsAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.game = BoardGame.objects.create(bgg_id=500001, name="Versioned Game")
        cls.v1 = BoardGameVersion.objects.create(
            board_game=cls.game, bgg_version_id=9001, name="First Edition",
            language="English", year_published=2018,
        )
        cls.v2 = BoardGameVersion.objects.create(
            board_game=cls.game, bgg_version_id=9002, name="Deluxe",
            language="English|German", year_published=2021,
        )
        cls.unknown = BoardGameVersion.get_or_create_unknown(cls.game)

    def test_lists_real_versions_excludes_unknown(self):
        resp = self.client.get(f"/api/games/{self.game.bgg_id}/versions/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {v["id"] for v in resp.data}
        self.assertEqual(ids, {self.v1.id, self.v2.id})
        self.assertNotIn(self.unknown.id, ids)

    def test_version_fields_present(self):
        resp = self.client.get(f"/api/games/{self.game.bgg_id}/versions/")
        v = next(v for v in resp.data if v["id"] == self.v1.id)
        self.assertEqual(v["bgg_version_id"], 9001)
        self.assertEqual(v["name"], "First Edition")
        self.assertEqual(v["language"], "English")
        self.assertEqual(v["year_published"], 2018)
        self.assertIn("thumbnail_url", v)

    def test_unknown_game_404(self):
        resp = self.client.get("/api/games/424242/versions/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_game_with_no_versions_returns_empty(self):
        g2 = BoardGame.objects.create(bgg_id=500002, name="No Versions")
        resp = self.client.get(f"/api/games/{g2.bgg_id}/versions/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data, [])
