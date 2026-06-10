# Canonical Game Enrichment via CSV Import + Versioned Copies — Design

Date: 2026-06-10

## Goal

Prepare the app for the enrichment data the `enrich_bgg.py` scraper is
producing (`boardgames_enriched.csv`, `boardgame_versions.csv`):

1. Enhance `catalog.BoardGame` with the new fields, imported from the enriched
   CSV.
2. Add canonical `BoardGameVersion` (editions), imported from the versions CSV.
3. Link a `Copy` to the version its owner picks; the chosen version sets the
   copy's language. When no version exists for a game (or the version has no
   language), fall back to a per-game **Unknown** version + `"Unknown"` language.

## Non-goals

- No lazy/on-demand BGG API calls. Data comes only from the CSVs (DB import).
- No new first-class columns on `BoardGame` (enrichment lives in `metadata`).
- No backfill of `version` on legacy copies.
- Frontend version picker is a separate follow-up plan.
- The CSVs may be partial while the scrape runs; imports must tolerate missing
  files and missing rows.

## Decisions (from brainstorming)

| Axis | Choice |
|---|---|
| Game field storage | `metadata` JSON (no new columns) |
| Unknown fallback | Per-game `Unknown` version, created on demand at copy creation |
| Import | Extend the existing `import_games` command (ranks + enriched + versions) |
| Blank-language chosen version | Keep the chosen version; set `language="Unknown"` |

## CSV shapes (produced by `enrich_bgg.py`)

`boardgames_enriched.csv` — original 16 rank columns **plus**:
`thumbnail, minplayers, maxplayers, averageweight, languagedependence,
languagedependence_label`.

`boardgame_versions.csv` — columns:
`boardgame_id, id, name, thumbnail, language, publisher, yearpublished, width,
length, depth, weight`.

## Schema

### `catalog.BoardGame` — no migration

Import writes these keys into the existing `metadata` JSONField:

| metadata key | enriched CSV column |
|---|---|
| `thumbnail` | `thumbnail` |
| `min_players` | `minplayers` |
| `max_players` | `maxplayers` |
| `average_weight` | `averageweight` |
| `language_dependence` | `languagedependence` |
| `language_dependence_label` | `languagedependence_label` |

The detail serializer already reads `min_players`/`max_players` from `metadata`.
Add getters for `thumbnail`, `average_weight`, `language_dependence`,
`language_dependence_label`.

### `catalog.BoardGameVersion` — new model + migration

```
id              AutoField primary key   # surrogate (Unknown rows have no BGG id)
board_game      FK -> BoardGame (related_name="versions", on_delete=CASCADE)
bgg_version_id  IntegerField(null=True, unique=True, db_index=True)  # null for Unknown
name            CharField(max_length=300, blank=True, default="")
thumbnail_url   URLField(max_length=500, blank=True, default="")
language        CharField(max_length=300, blank=True, default="")   # pipe-joined if multiple
publisher       CharField(max_length=500, blank=True, default="")   # pipe-joined value(s)
year_published  IntegerField(null=True, blank=True)
width/length/depth/weight  FloatField(null=True, blank=True)        # physical dims
created/updated DateTimeField
```

Real versions are upserted by `bgg_version_id`. Unknown rows have
`bgg_version_id=None`, `name="Unknown"`, `language="Unknown"`.

### `copies.Copy` — migration

Add:
```
version  FK -> catalog.BoardGameVersion (null=True, on_delete=SET_NULL,
              related_name="copies")
```
- DB-nullable so legacy rows stay valid.
- `language` becomes read-only at the API (derived).

## Copy create — version + language resolution

Resolution logic (in `CopySerializer.create`, before `Copy.save`):

1. If `version` supplied:
   - validate `version.board_game_id == board_game.bgg_id` (BoardGame's PK is
     `bgg_id`), else 400;
   - `language = version.language or "Unknown"` (keep the chosen version even if
     its language is blank).
2. If `version` not supplied:
   - `version = BoardGameVersion.get_or_create_unknown(board_game)`;
   - `language = "Unknown"`.

`BoardGameVersion.get_or_create_unknown(game)` →
`get_or_create(board_game=game, name="Unknown", defaults={"language": "Unknown"})`
(one Unknown row per game, `bgg_version_id` stays null).

`version` is therefore optional input but always set after create. `Copy.save`
keeps generating `listing_code`; language is set by the serializer (not derived
in `save`, since the Unknown fallback needs the board_game context the
serializer has).

`is_pending` is unchanged: `not (language and condition)`. Because language is
always set (real or "Unknown"), pending now depends on `condition` only.

## Import (extend `import_games`)

The `import_games` management command orchestrates three idempotent steps. Each
is a focused function in `catalog/tasks.py`; the command calls them in order:

1. `import_boardgames_csv(path, limit)` — unchanged base import from
   `boardgames_ranks.csv` (all games).
2. `import_enriched_metadata(path)` — read `boardgames_enriched.csv`; for each
   row, update the six `metadata` keys on the matching `BoardGame` (by `id`).
   Skips silently if the file is absent. Rows for unknown games are skipped.
3. `import_versions(path)` — read `boardgame_versions.csv`; upsert
   `BoardGameVersion` by `bgg_version_id` (FK to the parent game by
   `boardgame_id`). Skips silently if the file is absent. Rows whose parent
   game is absent are skipped.

New command flags: `--enriched-path` (default `<root>/boardgames_enriched.csv`),
`--versions-path` (default `<root>/boardgame_versions.csv`),
`--skip-enriched`, `--skip-versions`. Existing `--path`/`--limit` unchanged.

All steps idempotent: re-running updates in place (no duplicate rows).

## Migrations

1. `catalog`: create `BoardGameVersion`.
2. `copies`: add `Copy.version`.

(No `BoardGame` migration — `metadata` already exists.)

## Tests

- `import_enriched_metadata`: writes the six metadata keys onto an existing
  game; missing file is a no-op; row for a non-existent game is skipped.
- `import_versions`: upserts `BoardGameVersion` by `bgg_version_id`; re-run does
  not duplicate; row with absent parent game is skipped.
- Detail serializer exposes the new metadata fields (direct serializer test).
- Copy create with a chosen version → `language = version.language`.
- Copy create with a chosen version whose language is blank → `language ==
  "Unknown"`, version unchanged.
- Copy create for a game with no versions / no version supplied → an Unknown
  version is created for that game and `language == "Unknown"`.
- Copy create with a version from another game → 400.
- `get_or_create_unknown` returns the same row on second call (one per game).

## Verification

- Backend test suite green (existing + new).
- `python manage.py makemigrations --check --dry-run` → no changes.
- A manual `import_games` run against partial CSVs does not error.
