"""
catalog/management/commands/import_games.py

Management command wrapper around the catalog.tasks.import_boardgames_csv
Celery task.  Runs synchronously (no broker needed) via ALWAYS_EAGER or
direct call.

Usage:
    python manage.py import_games
    python manage.py import_games --limit 1000
    python manage.py import_games --path /custom/path/to/file.csv
    python manage.py import_games --path /custom/path/to/file.csv --limit 500
"""

from django.core.management.base import BaseCommand, CommandError

from catalog.tasks import import_boardgames_csv


class Command(BaseCommand):
    help = "Import (or update) BoardGame rows from a BGG CSV export."

    def add_arguments(self, parser):
        parser.add_argument(
            "--path",
            type=str,
            default=None,
            help=(
                "Absolute path to the CSV file. "
                "Defaults to <repo_root>/boardgames_ranks.csv."
            ),
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Import only the first N data rows (useful for testing).",
        )

    def handle(self, *args, **options):
        path = options["path"]
        limit = options["limit"]

        self.stdout.write(
            self.style.NOTICE(
                f"Starting import: path={path or 'default'}, limit={limit or 'all'}"
            )
        )

        try:
            # Call directly (bypasses Celery serialization for management command use)
            result = import_boardgames_csv(path=path, limit=limit)
        except FileNotFoundError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"Import complete: {result['imported']} rows processed, "
                f"{result['total_in_db']} total in DB."
            )
        )
