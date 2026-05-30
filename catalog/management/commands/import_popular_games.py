from django.core.management.base import BaseCommand
from catalog import bgg as bgg_service


class Command(BaseCommand):
    help = 'Seed catalog with BGG hotness list (one API call, ~50 games, stubs only).'

    def handle(self, *args, **options):
        self.stdout.write('Fetching BGG hotness list...')
        hot = bgg_service.fetch_hot_games()
        if not hot:
            self.stderr.write('No results — BGG may be unreachable.')
            return
        bgg_service.bulk_create_stubs(hot)
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(hot)} game stubs.'))
