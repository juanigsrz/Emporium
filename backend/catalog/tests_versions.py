from django.test import TestCase

from catalog.models import BoardGame, BoardGameVersion


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
