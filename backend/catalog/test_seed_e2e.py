from django.core.management import call_command
from django.test import TestCase

from catalog.models import BoardGame, BoardGameVersion


class SeedE2ECatalogTests(TestCase):
    def test_seeds_twenty_games_idempotently(self):
        call_command("seed_e2e_catalog")
        call_command("seed_e2e_catalog")  # second run must not duplicate
        games = BoardGame.objects.filter(bgg_id__range=(900001, 900020))
        self.assertEqual(games.count(), 20)
        self.assertEqual(
            BoardGameVersion.objects.filter(board_game__in=games).count(), 20
        )
        g = games.get(bgg_id=900001)
        self.assertEqual(g.name, "E2E Game 01")
        self.assertFalse(g.is_expansion)
        self.assertIsNotNone(g.rank)
