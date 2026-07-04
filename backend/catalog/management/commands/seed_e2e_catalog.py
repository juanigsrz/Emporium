"""Tiny deterministic catalog for the Playwright E2E suite.

import_games needs the full CSV and seed_test_event assumes the catalog
already exists, so the E2E web server seeds this instead.
"""
from django.core.management.base import BaseCommand

from catalog.models import BoardGame, BoardGameVersion


class Command(BaseCommand):
    help = "Seed 20 deterministic BoardGames for E2E tests (idempotent)."

    def handle(self, *args, **options):
        for i in range(1, 21):
            game, _ = BoardGame.objects.update_or_create(
                bgg_id=900000 + i,
                defaults={
                    "name": f"E2E Game {i:02d}",
                    "year_published": 2020,
                    "rank": i,
                    "average": 7.5,
                    "users_rated": 1000,
                    "is_expansion": False,
                },
            )
            BoardGameVersion.objects.update_or_create(
                board_game=game,
                bgg_version_id=900000 + i,
                defaults={"name": f"E2E Edition {i:02d}", "language": "English"},
            )
        self.stdout.write(self.style.SUCCESS("Seeded 20 E2E games"))
