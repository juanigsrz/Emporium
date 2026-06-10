"""
catalog/management/commands/import_games.py

Imports BoardGame rows from the BGG ranks CSV, then (optionally) overlays the
enriched-CSV metadata and upserts BoardGameVersion rows from the versions CSV.
All three steps are idempotent and run synchronously.

Usage:
    python manage.py import_games
    python manage.py import_games --limit 1000
    python manage.py import_games --path ranks.csv --enriched-path enriched.csv --versions-path versions.csv
    python manage.py import_games --skip-enriched --skip-versions
"""

from django.core.management.base import BaseCommand, CommandError

from catalog.tasks import (
    import_boardgames_csv,
    import_enriched_metadata,
    import_versions,
)


class Command(BaseCommand):
    help = "Import BoardGame rows + enriched metadata + versions from BGG CSVs."

    def add_arguments(self, parser):
        parser.add_argument("--path", type=str, default=None,
                            help="Ranks CSV path. Defaults to <repo_root>/boardgames_ranks.csv.")
        parser.add_argument("--limit", type=int, default=None,
                            help="Import only the first N ranks rows (testing).")
        parser.add_argument("--enriched-path", type=str, default=None,
                            help="Enriched CSV path. Defaults to <repo_root>/boardgames_enriched.csv.")
        parser.add_argument("--versions-path", type=str, default=None,
                            help="Versions CSV path. Defaults to <repo_root>/boardgame_versions.csv.")
        parser.add_argument("--skip-enriched", action="store_true",
                            help="Skip the enriched-metadata overlay step.")
        parser.add_argument("--skip-versions", action="store_true",
                            help="Skip the versions import step.")

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE(
            f"Importing ranks: path={options['path'] or 'default'}, limit={options['limit'] or 'all'}"
        ))
        try:
            base = import_boardgames_csv(path=options["path"], limit=options["limit"])
        except FileNotFoundError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(
            f"Ranks: {base['imported']} processed, {base['total_in_db']} total in DB."
        ))

        if not options["skip_enriched"]:
            enr = import_enriched_metadata(path=options["enriched_path"])
            self.stdout.write(self.style.SUCCESS(
                f"Enriched: {enr['updated']} updated, {enr['skipped_missing_game']} skipped."
            ))

        if not options["skip_versions"]:
            ver = import_versions(path=options["versions_path"])
            self.stdout.write(self.style.SUCCESS(
                f"Versions: {ver['imported']} upserted, {ver['skipped_missing_game']} skipped."
            ))
