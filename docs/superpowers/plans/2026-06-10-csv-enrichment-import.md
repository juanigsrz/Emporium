# Canonical Game Enrichment via CSV Import + Versioned Copies — Implementation Plan (Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the scraper's enrichment CSVs into the DB — add new fields to `catalog.BoardGame.metadata`, populate a new `catalog.BoardGameVersion`, and link each `Copy` to a version (with a per-game "Unknown" fallback that sets the language).

**Architecture:** The existing `import_games` command is extended to overlay `boardgames_enriched.csv` metadata onto games and upsert `BoardGameVersion` rows from `boardgame_versions.csv` (both idempotent, both tolerant of missing files). Copies gain an optional `version` FK; the copy serializer derives `language` from the chosen version, falling back to a per-game on-demand "Unknown" version.

**Tech Stack:** Django 5, DRF, stdlib `csv`, SQLite (`bulk_create(update_conflicts=True)` for idempotent upserts).

**Scope:** Backend only. The frontend version picker is a separate follow-up plan.

**Spec:** `docs/superpowers/specs/2026-06-10-csv-enrichment-import-design.md`

**How to run tests:** from `backend/` with the venv: `venv/bin/python manage.py test <dotted.path> -v 2`.

---

## File Structure

- Modify `backend/catalog/models.py` — add `BoardGameVersion` (+ `get_or_create_unknown`).
- Modify `backend/copies/models.py` — add `Copy.version` FK.
- Modify `backend/catalog/tasks.py` — add `import_versions`, `import_enriched_metadata` (+ `_apply_enriched_chunk`), default CSV paths.
- Modify `backend/catalog/management/commands/import_games.py` — orchestrate the three imports + flags.
- Modify `backend/catalog/serializers.py` — detail getters for the new metadata fields.
- Modify `backend/copies/serializers.py` — `version` field, read-only `language`, validation, Unknown-fallback resolution.
- Modify `backend/copies/tests.py` — new test classes (existing tests untouched).
- Create `backend/catalog/tests_versions.py` — `BoardGameVersion` model + detail serializer tests.
- Create `backend/catalog/tests_import.py` — import function + command tests.

---

## Task 1: `BoardGameVersion` model + `get_or_create_unknown`

**Files:**
- Modify: `backend/catalog/models.py`
- Test: `backend/catalog/tests_versions.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/catalog/tests_versions.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test catalog.tests_versions -v 2`
Expected: FAIL — `ImportError: cannot import name 'BoardGameVersion'`.

- [ ] **Step 3: Add the model**

Append to `backend/catalog/models.py`:

```python
class BoardGameVersion(models.Model):
    """An edition/version of a BoardGame, imported from BGG version data.

    Uses a surrogate AutoField PK because synthetic "Unknown" versions have no
    BGG version id. Real versions are keyed by bgg_version_id.
    """

    board_game = models.ForeignKey(
        BoardGame, on_delete=models.CASCADE, related_name="versions"
    )
    bgg_version_id = models.IntegerField(
        null=True, blank=True, unique=True, db_index=True
    )  # null for Unknown
    name = models.CharField(max_length=300, blank=True, default="")
    thumbnail_url = models.URLField(max_length=500, blank=True, default="")
    language = models.CharField(max_length=300, blank=True, default="")  # pipe-joined if multiple
    publisher = models.CharField(max_length=500, blank=True, default="")  # pipe-joined value(s)
    year_published = models.IntegerField(null=True, blank=True)
    width = models.FloatField(null=True, blank=True)
    length = models.FloatField(null=True, blank=True)
    depth = models.FloatField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)  # physical weight, NOT complexity

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["board_game_id", "bgg_version_id"]

    def __str__(self):
        return f"{self.name} (v{self.bgg_version_id or 'Unknown'})"

    @classmethod
    def get_or_create_unknown(cls, board_game):
        """Return (creating if needed) the single 'Unknown' version for a game."""
        obj, _ = cls.objects.get_or_create(
            board_game=board_game,
            name="Unknown",
            bgg_version_id=None,
            defaults={"language": "Unknown"},
        )
        return obj
```

- [ ] **Step 4: Make + apply the migration**

Run: `venv/bin/python manage.py makemigrations catalog`
Run: `venv/bin/python manage.py migrate catalog`
Expected: a new migration created + applied cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `venv/bin/python manage.py test catalog.tests_versions -v 2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/catalog/models.py backend/catalog/migrations/ backend/catalog/tests_versions.py
git commit -m "feat(catalog): add BoardGameVersion model with Unknown fallback"
```
(Do NOT add a Co-Authored-By trailer.)

---

## Task 2: `Copy.version` FK

**Files:**
- Modify: `backend/copies/models.py`
- Test: `backend/copies/tests.py` (add one class at end)

- [ ] **Step 1: Write the failing test**

Add to the imports at the top of `backend/copies/tests.py`:

```python
from catalog.models import BoardGameVersion
```

Append a new class at the end of `backend/copies/tests.py`:

```python
class CopyVersionFieldTest(CopyTestBase):
    def test_copy_links_to_version(self):
        version = BoardGameVersion.objects.create(
            board_game=self.game1, bgg_version_id=416798, name="German", language="German"
        )
        copy = Copy.objects.create(
            owner=self.user1, board_game=self.game1, version=version
        )
        self.assertEqual(copy.version, version)
        self.assertEqual(version.copies.count(), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test copies.tests.CopyVersionFieldTest -v 2`
Expected: FAIL — `TypeError`/`FieldError` (no `version` field).

- [ ] **Step 3: Add the field**

In `backend/copies/models.py`, in the "Relations" block right after the `board_game` FK, add:

```python
    version = models.ForeignKey(
        "catalog.BoardGameVersion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="copies",
    )
```

- [ ] **Step 4: Make + apply the migration**

Run: `venv/bin/python manage.py makemigrations copies`
Run: `venv/bin/python manage.py migrate copies`
Expected: a new migration created + applied cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `venv/bin/python manage.py test copies.tests.CopyVersionFieldTest -v 2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/copies/models.py backend/copies/migrations/ backend/copies/tests.py
git commit -m "feat(copies): add Copy.version FK"
```

---

## Task 3: `import_versions` task

**Files:**
- Modify: `backend/catalog/tasks.py`
- Test: `backend/catalog/tests_import.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/catalog/tests_import.py`:

```python
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
            {"boardgame_id": "999", "id": "500", "name": "Orphan"},  # no such game
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportVersionsTest -v 2`
Expected: FAIL — `ImportError: cannot import name 'import_versions'`.

- [ ] **Step 3: Implement `import_versions`**

In `backend/catalog/tasks.py`, add a default path constant next to `_DEFAULT_CSV`:

```python
_DEFAULT_VERSIONS_CSV = Path(__file__).resolve().parent.parent.parent / "boardgame_versions.csv"
```

Add the function (place after `import_boardgames_csv`, before `_flush`):

```python
def import_versions(path=None):
    """Upsert BoardGameVersion rows from boardgame_versions.csv (by bgg_version_id).

    Idempotent. Rows whose parent game is absent are skipped. Missing file is a
    no-op (the scrape may not have produced it yet).
    """
    from catalog.models import BoardGame, BoardGameVersion

    csv_path = Path(path) if path else _DEFAULT_VERSIONS_CSV
    if not csv_path.exists():
        logger.info("Versions CSV not found, skipping: %s", csv_path)
        return {"imported": 0, "skipped_missing_game": 0}

    existing_ids = set(BoardGame.objects.values_list("bgg_id", flat=True))
    update_fields = [
        "board_game_id", "name", "thumbnail_url", "language", "publisher",
        "year_published", "width", "length", "depth", "weight", "updated",
    ]
    buffer = []
    imported = 0
    skipped = 0

    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            game_id = _safe_int(row.get("boardgame_id"))
            version_id = _safe_int(row.get("id"))
            if game_id is None or version_id is None:
                continue
            if game_id not in existing_ids:
                skipped += 1
                continue
            buffer.append(BoardGameVersion(
                bgg_version_id=version_id,
                board_game_id=game_id,
                name=(row.get("name") or "").strip(),
                thumbnail_url=(row.get("thumbnail") or "").strip(),
                language=(row.get("language") or "").strip(),
                publisher=(row.get("publisher") or "").strip(),
                year_published=_safe_int(row.get("yearpublished")),
                width=_safe_float(row.get("width")),
                length=_safe_float(row.get("length")),
                depth=_safe_float(row.get("depth")),
                weight=_safe_float(row.get("weight")),
            ))
            if len(buffer) >= CHUNK_SIZE:
                BoardGameVersion.objects.bulk_create(
                    buffer, update_conflicts=True,
                    update_fields=update_fields, unique_fields=["bgg_version_id"],
                )
                imported += len(buffer)
                buffer = []

    if buffer:
        BoardGameVersion.objects.bulk_create(
            buffer, update_conflicts=True,
            update_fields=update_fields, unique_fields=["bgg_version_id"],
        )
        imported += len(buffer)

    logger.info("Versions import: %d upserted, %d skipped (missing game)", imported, skipped)
    return {"imported": imported, "skipped_missing_game": skipped}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportVersionsTest -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/tasks.py backend/catalog/tests_import.py
git commit -m "feat(catalog): import_versions upserts BoardGameVersion from CSV"
```

---

## Task 4: `import_enriched_metadata` task

**Files:**
- Modify: `backend/catalog/tasks.py`
- Test: `backend/catalog/tests_import.py` (add `ImportEnrichedTest`)

- [ ] **Step 1: Write the failing test**

Append to `backend/catalog/tests_import.py`:

```python
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
            {"id": "999", "name": "Orphan"},  # no such game
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportEnrichedTest -v 2`
Expected: FAIL — `ImportError: cannot import name 'import_enriched_metadata'`.

- [ ] **Step 3: Implement the function**

In `backend/catalog/tasks.py`, add the default path next to the others:

```python
_DEFAULT_ENRICHED_CSV = Path(__file__).resolve().parent.parent.parent / "boardgames_enriched.csv"
```

Add `from django.utils import timezone` to the imports at the top of the file.

Add the functions (after `import_versions`):

```python
def import_enriched_metadata(path=None):
    """Overlay the enriched-CSV fields onto existing BoardGame.metadata.

    Idempotent. Rows for absent games are skipped. Missing file is a no-op.
    """
    csv_path = Path(path) if path else _DEFAULT_ENRICHED_CSV
    if not csv_path.exists():
        logger.info("Enriched CSV not found, skipping: %s", csv_path)
        return {"updated": 0, "skipped_missing_game": 0}

    updated = 0
    skipped = 0
    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        chunk = []
        for row in reader:
            chunk.append(row)
            if len(chunk) >= CHUNK_SIZE:
                u, s = _apply_enriched_chunk(chunk)
                updated += u
                skipped += s
                chunk = []
        if chunk:
            u, s = _apply_enriched_chunk(chunk)
            updated += u
            skipped += s

    logger.info("Enriched import: %d updated, %d skipped (missing game)", updated, skipped)
    return {"updated": updated, "skipped_missing_game": skipped}


def _apply_enriched_chunk(rows):
    """Merge one chunk of enriched rows into BoardGame.metadata via bulk_update."""
    from catalog.models import BoardGame

    by_id = {}
    for row in rows:
        gid = _safe_int(row.get("id"))
        if gid is not None:
            by_id[gid] = row

    games = BoardGame.objects.in_bulk(by_id.keys())
    now = timezone.now()
    to_update = []
    skipped = 0
    for gid, row in by_id.items():
        game = games.get(gid)
        if game is None:
            skipped += 1
            continue
        meta = dict(game.metadata or {})
        meta.update({
            "thumbnail": (row.get("thumbnail") or "").strip(),
            "min_players": _safe_int(row.get("minplayers")),
            "max_players": _safe_int(row.get("maxplayers")),
            "average_weight": _safe_float(row.get("averageweight")),
            "language_dependence": _safe_int(row.get("languagedependence")),
            "language_dependence_label": (row.get("languagedependence_label") or "").strip(),
        })
        game.metadata = meta
        game.updated = now
        to_update.append(game)

    if to_update:
        BoardGame.objects.bulk_update(to_update, ["metadata", "updated"])
    return len(to_update), skipped
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportEnrichedTest -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/tasks.py backend/catalog/tests_import.py
git commit -m "feat(catalog): import_enriched_metadata overlays metadata from CSV"
```

---

## Task 5: Extend `import_games` command

**Files:**
- Modify: `backend/catalog/management/commands/import_games.py`
- Test: `backend/catalog/tests_import.py` (add `ImportGamesCommandTest`)

- [ ] **Step 1: Write the failing test**

Append to `backend/catalog/tests_import.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportGamesCommandTest -v 2`
Expected: FAIL — unrecognized argument `enriched_path` / command does not import versions.

- [ ] **Step 3: Extend the command**

Replace the body of `backend/catalog/management/commands/import_games.py` with:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test catalog.tests_import.ImportGamesCommandTest -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/management/commands/import_games.py backend/catalog/tests_import.py
git commit -m "feat(catalog): import_games orchestrates ranks + enriched + versions"
```

---

## Task 6: Detail serializer — expose new metadata fields

**Files:**
- Modify: `backend/catalog/serializers.py`
- Test: `backend/catalog/tests_versions.py` (add `DetailEnrichmentFieldsTest`)

- [ ] **Step 1: Write the failing test**

Append to `backend/catalog/tests_versions.py`:

```python
from catalog.serializers import BoardGameDetailSerializer


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test catalog.tests_versions.DetailEnrichmentFieldsTest -v 2`
Expected: FAIL — `KeyError: 'thumbnail'`.

- [ ] **Step 3: Add the serializer fields**

In `backend/catalog/serializers.py`, inside `BoardGameDetailSerializer`, add four method-field declarations next to the existing ones:

```python
    thumbnail = serializers.SerializerMethodField()
    average_weight = serializers.SerializerMethodField()
    language_dependence = serializers.SerializerMethodField()
    language_dependence_label = serializers.SerializerMethodField()
```

Add them to `Meta.fields` after `"image_url"`:

```python
            "thumbnail",
            "average_weight",
            "language_dependence",
            "language_dependence_label",
```

Add the getters next to the other `get_*` methods:

```python
    def get_thumbnail(self, obj):
        return self._meta(obj, "thumbnail", "")

    def get_average_weight(self, obj):
        return self._meta(obj, "average_weight", None)

    def get_language_dependence(self, obj):
        return self._meta(obj, "language_dependence", None)

    def get_language_dependence_label(self, obj):
        return self._meta(obj, "language_dependence_label", "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test catalog.tests_versions.DetailEnrichmentFieldsTest -v 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/serializers.py backend/catalog/tests_versions.py
git commit -m "feat(catalog): expose enrichment metadata fields on game detail"
```

---

## Task 7: Copy serializer — version input, derived language, Unknown fallback

**Files:**
- Modify: `backend/copies/serializers.py`
- Test: `backend/copies/tests.py` (add `CopyVersionApiTest`)

- [ ] **Step 1: Write the failing test**

Append to `backend/copies/tests.py`:

```python
class CopyVersionApiTest(CopyTestBase):
    def setUp(self):
        super().setUp()
        self.version = BoardGameVersion.objects.create(
            board_game=self.game1, bgg_version_id=416798, name="German", language="German"
        )
        self.blank_lang_version = BoardGameVersion.objects.create(
            board_game=self.game1, bgg_version_id=500, name="Promo", language=""
        )

    def test_create_with_version_derives_language(self):
        resp = self.client.post(
            COPIES_URL,
            {"board_game": 224517, "version": self.version.pk, "condition": "GOOD",
             "language": "Klingon"},  # supplied language ignored (read-only)
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["language"], "German")
        self.assertEqual(resp.data["version"], self.version.pk)

    def test_create_with_blank_language_version_sets_unknown(self):
        resp = self.client.post(
            COPIES_URL,
            {"board_game": 224517, "version": self.blank_lang_version.pk, "condition": "GOOD"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["language"], "Unknown")
        self.assertEqual(resp.data["version"], self.blank_lang_version.pk)  # version kept

    def test_create_without_version_uses_unknown(self):
        resp = self.client.post(
            COPIES_URL, {"board_game": 224517, "condition": "GOOD"}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["language"], "Unknown")
        unknown = BoardGameVersion.objects.get(board_game=self.game1, name="Unknown")
        self.assertEqual(resp.data["version"], unknown.pk)

    def test_create_rejects_version_from_other_game(self):
        other_version = BoardGameVersion.objects.create(
            board_game=self.game2, bgg_version_id=700, name="X", language="English"
        )
        resp = self.client.post(
            COPIES_URL,
            {"board_game": 224517, "version": other_version.pk, "condition": "GOOD"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("version", resp.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test copies.tests.CopyVersionApiTest -v 2`
Expected: FAIL — `version` not accepted / language not derived.

- [ ] **Step 3: Update the serializer**

In `backend/copies/serializers.py`:

Change the import line to include `BoardGameVersion`:

```python
from catalog.models import BoardGame, BoardGameVersion
```

Add the `version` + `version_name` fields next to `board_game`/`board_game_name`:

```python
    version = serializers.PrimaryKeyRelatedField(
        queryset=BoardGameVersion.objects.all(), required=False, allow_null=True
    )
    version_name = serializers.SerializerMethodField()
```

Add `"version"` and `"version_name"` to `Meta.fields` (after `"board_game_name"`),
and add `"language"` to `read_only_fields`:

```python
        read_only_fields = ["id", "listing_code", "owner", "language", "is_pending", "import_source", "created", "updated"]
```

Add the `version_name` getter, a `validate`, and `create`/`update` overrides
(replace the existing `update` method):

```python
    def get_version_name(self, obj):
        return obj.version.name if obj.version_id else ""

    def validate(self, attrs):
        version = attrs.get("version")
        board_game = attrs.get("board_game") or getattr(self.instance, "board_game", None)
        if version and board_game and version.board_game_id != board_game.bgg_id:
            raise serializers.ValidationError(
                {"version": "Selected version does not belong to the selected game."}
            )
        return attrs

    def _resolve_version_and_language(self, board_game, version):
        if version is not None:
            return version, (version.language or "Unknown")
        return BoardGameVersion.get_or_create_unknown(board_game), "Unknown"

    def create(self, validated_data):
        version, language = self._resolve_version_and_language(
            validated_data.get("board_game"), validated_data.get("version")
        )
        validated_data["version"] = version
        validated_data["language"] = language
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "version" in validated_data:
            version, language = self._resolve_version_and_language(
                instance.board_game, validated_data["version"]
            )
            validated_data["version"] = version
            validated_data["language"] = language
        instance = super().update(instance, validated_data)
        if instance.is_pending:
            instance.recompute_pending()
            instance.save(update_fields=["is_pending", "updated"])
        return instance
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `venv/bin/python manage.py test copies.tests.CopyVersionApiTest -v 2`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm existing copy tests still pass**

`version` is optional and `language` derivation only triggers via the serializer
(ORM-created copies in the existing tests are unaffected; API-create tests do
not assert a supplied `language`). Verify:
Run: `venv/bin/python manage.py test copies -v 1`
Expected: PASS (all existing + new). If any test fails because it asserts a
POST-supplied `language` value, update that test to assert the derived value
(`"Unknown"` when no version is supplied) — do not re-add write access to
`language`.

- [ ] **Step 6: Commit**

```bash
git add backend/copies/serializers.py backend/copies/tests.py
git commit -m "feat(copies): version input + derived language with Unknown fallback"
```

---

## Task 8: Full suite + migration check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `venv/bin/python manage.py test -v 1`
Expected: all tests pass (prior suite + new). Fix any regression before
proceeding.

- [ ] **Step 2: Confirm no missing migrations**

Run: `venv/bin/python manage.py makemigrations --check --dry-run`
Expected: "No changes detected".

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "test: backend suite green for csv enrichment import"
```
(Skip if nothing changed.)

---

## Self-Review notes (addressed)

- **Spec coverage:** metadata overlay (Task 4), `BoardGameVersion` + Unknown (Task 1), `Copy.version` (Task 2), version import (Task 3), command orchestration + flags (Task 5), detail fields (Task 6), copy resolution incl. blank-language-keeps-version + no-version Unknown fallback + cross-game 400 (Task 7), migrations (Tasks 1–2), idempotency tested (Task 3), missing-file tolerance (Tasks 3–4).
- **Type consistency:** `BoardGameVersion` keyed by surrogate `id` PK with `bgg_version_id` unique; `import_versions` upserts on `bgg_version_id`; `get_or_create_unknown(board_game)` used identically in model test and copy serializer; validation compares `version.board_game_id == board_game.bgg_id` (BoardGame PK is `bgg_id`). Metadata keys written by `_apply_enriched_chunk` (`min_players`, `average_weight`, `language_dependence`, …) match the keys read by the serializer getters in Task 6.
- **No `BoardGame` migration:** only `metadata` (pre-existing) is written.
