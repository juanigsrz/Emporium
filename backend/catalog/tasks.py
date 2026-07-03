"""
catalog/tasks.py

Celery task for importing board game data from a CSV file into the
catalog.BoardGame model.

CSV columns:
    id, name, yearpublished, rank, bayesaverage, average, usersrated,
    is_expansion, abstracts_rank, cgs_rank, childrensgames_rank,
    familygames_rank, partygames_rank, strategygames_rank, thematic_rank,
    wargames_rank

The task is idempotent: re-running with the same CSV updates existing rows
via bulk_create(update_conflicts=True) — no duplicate rows ever created.
"""

import csv
import logging
import os
from pathlib import Path

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

# Category rank columns that get packed into category_ranks JSON
CATEGORY_RANK_FIELDS = [
    "abstracts_rank",
    "cgs_rank",
    "childrensgames_rank",
    "familygames_rank",
    "partygames_rank",
    "strategygames_rank",
    "thematic_rank",
    "wargames_rank",
]

# Default CSV path: boardgames_ranks.csv at repo root (two levels above backend/)
_DEFAULT_CSV = Path(__file__).resolve().parent.parent.parent / "boardgames_ranks.csv"
_DEFAULT_VERSIONS_CSV = Path(__file__).resolve().parent.parent.parent / "boardgame_versions.csv"
_DEFAULT_ENRICHED_CSV = Path(__file__).resolve().parent.parent.parent / "boardgames_enriched.csv"

CHUNK_SIZE = 2000


def _dedupe_by(objs, attr):
    """Keep one obj per attr value (last wins). Postgres upsert rejects a batch
    that proposes the same conflict target twice."""
    seen = {getattr(o, attr): o for o in objs}
    return list(seen.values())


def _safe_int(value):
    """Return int or None for blank/invalid strings."""
    if value is None:
        return None
    v = str(value).strip()
    if v == "":
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def _safe_float(value):
    """Return float or None for blank/invalid strings."""
    if value is None:
        return None
    v = str(value).strip()
    if v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _safe_bool(value):
    """Return bool; treat '1' / 'true' as True, anything else as False."""
    v = str(value).strip().lower()
    return v in ("1", "true", "yes")


# Map CSV column name → friendly JSON key for category_ranks
_CATEGORY_KEY_MAP = {
    "abstracts_rank": "abstracts",
    "cgs_rank": "cgs",
    "childrensgames_rank": "childrensgames",
    "familygames_rank": "family",
    "partygames_rank": "party",
    "strategygames_rank": "strategy",
    "thematic_rank": "thematic",
    "wargames_rank": "wargames",
}


def _build_category_ranks(row):
    """Pack *_rank columns into a dict with friendly keys, skipping blanks."""
    result = {}
    for col in CATEGORY_RANK_FIELDS:
        raw = row.get(col, "")
        val = _safe_int(raw)
        if val is not None:
            key = _CATEGORY_KEY_MAP.get(col, col)
            result[key] = val
    return result


@shared_task(name="catalog.tasks.import_boardgames_csv")
def import_boardgames_csv(path=None, limit=None):
    """
    Import (or update) BoardGame rows from a CSV file.

    Args:
        path (str | None): Absolute path to the CSV file.
            Defaults to <repo_root>/boardgames_ranks.csv.
        limit (int | None): If set, import only the first N data rows.
            Useful for tests and quick smoke checks.

    Returns:
        dict: {"imported": <int>, "total_in_db": <int>}
    """
    from catalog.models import BoardGame  # local import avoids circular at module load

    csv_path = Path(path) if path else _DEFAULT_CSV
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    logger.info("Starting BoardGame import from %s (limit=%s)", csv_path, limit)

    update_fields = [
        "name",
        "year_published",
        "rank",
        "bayes_average",
        "average",
        "users_rated",
        "is_expansion",
        "category_ranks",
        "image_url",
        "metadata",
        "updated",
    ]

    buffer = []
    imported = 0
    rows_read = 0

    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            if limit is not None and rows_read >= limit:
                break

            bgg_id = _safe_int(row.get("id"))
            if bgg_id is None:
                # Skip rows with no valid id
                continue

            raw_rank = _safe_int(row.get("rank"))
            # In the BGG CSV, rank=0 means "unranked"; treat as null.
            if raw_rank == 0:
                raw_rank = None

            obj = BoardGame(
                bgg_id=bgg_id,
                name=(row.get("name") or "").strip(),
                year_published=_safe_int(row.get("yearpublished")),
                rank=raw_rank,
                bayes_average=_safe_float(row.get("bayesaverage")),
                average=_safe_float(row.get("average")),
                users_rated=_safe_int(row.get("usersrated")) or 0,
                is_expansion=_safe_bool(row.get("is_expansion", "0")),
                category_ranks=_build_category_ranks(row),
                image_url="",
                metadata={},
            )
            buffer.append(obj)
            rows_read += 1

            if len(buffer) >= CHUNK_SIZE:
                _flush(buffer, update_fields)
                imported += len(buffer)
                logger.debug("Flushed chunk, total flushed so far: %d", imported)
                buffer = []

    if buffer:
        _flush(buffer, update_fields)
        imported += len(buffer)

    total = BoardGame.objects.count()
    logger.info("Import complete. Rows processed: %d. Total in DB: %d", imported, total)
    return {"imported": imported, "total_in_db": total}


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
                rows = _dedupe_by(buffer, "bgg_version_id")
                BoardGameVersion.objects.bulk_create(
                    rows, update_conflicts=True,
                    update_fields=update_fields, unique_fields=["bgg_version_id"],
                )
                imported += len(rows)
                buffer = []

    if buffer:
        rows = _dedupe_by(buffer, "bgg_version_id")
        BoardGameVersion.objects.bulk_create(
            rows, update_conflicts=True,
            update_fields=update_fields, unique_fields=["bgg_version_id"],
        )
        imported += len(rows)

    logger.info("Versions import: %d upserted, %d skipped (missing game)", imported, skipped)
    return {"imported": imported, "skipped_missing_game": skipped}


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


def _flush(objects, update_fields):
    """Bulk-create with conflict update so re-runs are idempotent."""
    from catalog.models import BoardGame

    BoardGame.objects.bulk_create(
        objects,
        update_conflicts=True,
        update_fields=update_fields,
        unique_fields=["bgg_id"],
    )
