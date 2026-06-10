import csv
import os
import tempfile

from django.test import TestCase

from catalog.models import BoardGame, BoardGameVersion
from catalog.tasks import import_versions

VERSION_HEADER = [
    "boardgame_id", "id", "name", "thumbnail", "language", "publisher",
    "yearpublished", "width", "length", "depth", "weight",
]


def _write_versions_csv(rows):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=VERSION_HEADER)
        w.writeheader()
        for r in rows:
            full = {k: "" for k in VERSION_HEADER}
            full.update(r)
            w.writerow(full)
    return path


class ImportVersionsTest(TestCase):
    def setUp(self):
        BoardGame.objects.create(bgg_id=13, name="Catan")

    def test_upsert_and_skip_missing_game(self):
        path = _write_versions_csv([
            {"boardgame_id": "13", "id": "416798", "name": "Afrikaans edition",
             "language": "Afrikaans", "width": "11.7"},
            {"boardgame_id": "999", "id": "500", "name": "Orphan"},
        ])
        result = import_versions(path)
        os.unlink(path)
        self.assertEqual(result["imported"], 1)
        self.assertEqual(result["skipped_missing_game"], 1)
        v = BoardGameVersion.objects.get(bgg_version_id=416798)
        self.assertEqual(v.language, "Afrikaans")
        self.assertEqual(v.board_game_id, 13)
        self.assertEqual(v.width, 11.7)

    def test_rerun_is_idempotent(self):
        path = _write_versions_csv([
            {"boardgame_id": "13", "id": "416798", "name": "Afrikaans edition"},
        ])
        import_versions(path)
        import_versions(path)
        os.unlink(path)
        self.assertEqual(BoardGameVersion.objects.filter(bgg_version_id=416798).count(), 1)

    def test_missing_file_is_noop(self):
        result = import_versions("/nonexistent/versions.csv")
        self.assertEqual(result["imported"], 0)


from catalog.tasks import import_enriched_metadata

ENRICHED_HEADER = [
    "id", "name", "yearpublished", "rank", "bayesaverage", "average",
    "usersrated", "is_expansion", "abstracts_rank", "cgs_rank",
    "childrensgames_rank", "familygames_rank", "partygames_rank",
    "strategygames_rank", "thematic_rank", "wargames_rank",
    "thumbnail", "minplayers", "maxplayers", "averageweight",
    "languagedependence", "languagedependence_label",
]


def _write_enriched_csv(rows):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=ENRICHED_HEADER)
        w.writeheader()
        for r in rows:
            full = {k: "" for k in ENRICHED_HEADER}
            full.update(r)
            w.writerow(full)
    return path


class ImportEnrichedTest(TestCase):
    def test_updates_metadata_and_skips_missing(self):
        game = BoardGame.objects.create(bgg_id=13, name="Catan", metadata={"designers": ["x"]})
        path = _write_enriched_csv([
            {"id": "13", "name": "Catan", "thumbnail": "https://x/t.png",
             "minplayers": "3", "maxplayers": "4", "averageweight": "2.28",
             "languagedependence": "2", "languagedependence_label": "Some text"},
            {"id": "999", "name": "Orphan"},
        ])
        result = import_enriched_metadata(path)
        os.unlink(path)
        game.refresh_from_db()
        self.assertEqual(game.metadata["thumbnail"], "https://x/t.png")
        self.assertEqual(game.metadata["min_players"], 3)
        self.assertEqual(game.metadata["max_players"], 4)
        self.assertEqual(game.metadata["average_weight"], 2.28)
        self.assertEqual(game.metadata["language_dependence"], 2)
        self.assertEqual(game.metadata["language_dependence_label"], "Some text")
        self.assertEqual(game.metadata["designers"], ["x"])  # preserved
        self.assertEqual(result["skipped_missing_game"], 1)

    def test_missing_file_is_noop(self):
        result = import_enriched_metadata("/nonexistent/enriched.csv")
        self.assertEqual(result["updated"], 0)


from io import StringIO
from django.core.management import call_command

RANKS_HEADER = ENRICHED_HEADER[:16]  # the 16 base columns, no enrichment cols


def _write_ranks_csv(rows):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=RANKS_HEADER)
        w.writeheader()
        for r in rows:
            full = {k: "" for k in RANKS_HEADER}
            full.update(r)
            w.writerow(full)
    return path


class ImportGamesCommandTest(TestCase):
    def test_command_runs_all_three_imports(self):
        ranks = _write_ranks_csv([{"id": "13", "name": "Catan", "rank": "5"}])
        enriched = _write_enriched_csv([
            {"id": "13", "name": "Catan", "minplayers": "3", "maxplayers": "4"},
        ])
        versions = _write_versions_csv([
            {"boardgame_id": "13", "id": "416798", "name": "German", "language": "German"},
        ])
        out = StringIO()
        call_command(
            "import_games", path=ranks, enriched_path=enriched,
            versions_path=versions, stdout=out,
        )
        for p in (ranks, enriched, versions):
            os.unlink(p)
        game = BoardGame.objects.get(bgg_id=13)
        self.assertEqual(game.metadata["min_players"], 3)
        self.assertEqual(BoardGameVersion.objects.filter(bgg_version_id=416798).count(), 1)

    def test_command_skips_enrichment_when_flagged(self):
        ranks = _write_ranks_csv([{"id": "13", "name": "Catan"}])
        out = StringIO()
        call_command(
            "import_games", path=ranks, skip_enriched=True, skip_versions=True, stdout=out,
        )
        os.unlink(ranks)
        game = BoardGame.objects.get(bgg_id=13)
        self.assertNotIn("min_players", game.metadata)
