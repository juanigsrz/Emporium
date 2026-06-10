# Canonical Game Enrichment + Versioned Copies — Design

Date: 2026-06-10

## Goal

1. Enrich the canonical `catalog.BoardGame` with fields collected from the BGG
   XML API (thumbnail, player counts, complexity weight, language dependence).
2. Introduce canonical `BoardGameVersion` (editions) and link a `Copy` to the
   version its owner picks; the chosen version sets the copy's language.
3. Populate enrichment lazily: a request for a game's info serves stored data
   if already synced, otherwise fetches from the BGG API first, then serves.

## Non-goals

- No bulk CSV → DB importer (lazy per-game only).
- No new first-class columns on `BoardGame` (enrichment lives in `metadata`).
- No backfill of `version` on legacy copies (we cannot know which edition).
- Not populating designers/publishers/mechanics/categories on the game (those
  remain deferred placeholders; only the listed fields are in scope).

## Decisions (from brainstorming)

| Axis | Choice |
|---|---|
| Game field storage | `metadata` JSON (no new columns) |
| Lazy fetch timing | Synchronous on first request, then cached |
| Copy ↔ version | `version` FK required on new copies; `language` derived |
| Bulk load | Lazy-only |

## Schema

### `catalog.BoardGame` — no migration

New data stored as keys in the existing `metadata` JSONField:

| key | source (thing API) |
|---|---|
| `thumbnail` | `<thumbnail>` |
| `min_players` | `<minplayers value>` |
| `max_players` | `<maxplayers value>` |
| `average_weight` | `statistics/ratings/averageweight value` |
| `language_dependence` | top-voted `language_dependence` poll level (1–5) |
| `language_dependence_label` | that level's text |
| `synced_at` | ISO-8601 UTC timestamp; **absent = not enriched** |

The detail serializer already exposes `min_players`/`max_players` from
`metadata` (defaulting null), so those surface automatically. Add serializer
fields for `thumbnail`, `average_weight`, `language_dependence`,
`language_dependence_label`.

### `catalog.BoardGameVersion` — new model + migration

```
bgg_id        IntegerField primary_key   # BGG version id
board_game    FK -> BoardGame (related_name="versions", on_delete=CASCADE)
name          CharField
thumbnail_url CharField/URLField (blank)
language      CharField (blank)          # pipe-joined if multiple, e.g. "English|German"
publisher     CharField (blank)          # pipe-joined value(s)
year_published IntegerField (null)
width         FloatField (null)
length        FloatField (null)
depth         FloatField (null)
weight        FloatField (null)          # physical weight, NOT complexity
created/updated DateTimeField
```

Upserted by `bgg_id` (idempotent across re-syncs).

### `copies.Copy` — migration

Add:
```
version  FK -> catalog.BoardGameVersion (null=True, on_delete=SET_NULL,
              related_name="copies")
```
- DB-nullable so existing rows remain valid.
- **Required on create** via the serializer (not the DB).
- `language` becomes read-only at the API; derived from `version.language`.

## Lazy enrichment service

`bgg/enrich.py`:

```python
def ensure_game_enriched(bgg_id: int) -> BoardGame:
    """Return the BoardGame, fetching + persisting BGG details on first call.

    Idempotent and best-effort: if metadata['synced_at'] is set, returns
    immediately. On BGG API failure (network, missing token, parse error) it
    logs and returns the game un-enriched -- never raises into the request.
    """
```

Behavior:
1. `get_or_create` the `BoardGame` (minimal row with name from API if absent).
2. If `metadata.get("synced_at")` → return as-is.
3. Fetch `thing?id=<id>&stats=1&versions=1` with
   `Authorization: Bearer {settings.BGG_API_KEY}` (one request, short timeout,
   single retry on HTTP 429/503).
4. Parse via shared `bgg/thing_parse.parse_things`.
5. In a `transaction.atomic()`: write the metadata keys above, upsert
   `BoardGameVersion` rows for this game, set `metadata["synced_at"]`, save.
6. On any API/parse error: log a warning, leave the game un-enriched, return it.

### Parser sharing

Extract the pure-stdlib parser out of `enrich_bgg.py` into
`backend/bgg/thing_parse.py` (no Django imports): `parse_things`, `_langdep`,
`_parse_version`, `_val`. Both consumers import it:
- `bgg/enrich.py` imports `from bgg.thing_parse import parse_things`.
- `enrich_bgg.py` inserts `backend/` on `sys.path` and imports the same module,
  so it still runs with plain `python3` from the repo root (zero new deps).

### HTTP client

`bgg/thing_api.py::fetch_thing_xml(bgg_id) -> str` using `requests` (matches
`bgg/client.py`), bearer auth from settings, short timeout, one retry on
429/503. Raises on failure; `ensure_game_enriched` catches.

## API surface

| endpoint | change |
|---|---|
| `GET /api/games/{bgg_id}/` | call `ensure_game_enriched(bgg_id)` before serialize; existing cache + `synced_at` make it a one-time cost |
| `GET /api/games/{bgg_id}/versions/` | **new**; ensure enriched, return `BoardGameVersion` list (feeds copy form) |

`BoardGameVersionSerializer`: `bgg_id`, `name`, `thumbnail_url`, `language`,
`publisher`, `year_published`, `width`, `length`, `depth`, `weight`.

Synchronous fetch adds ~1–3s latency only on the first view of an un-synced
game; thereafter served from DB/cache.

## Copy ↔ version flow

`CopySerializer`:
- Add `version` (PrimaryKeyRelatedField, queryset all versions), required on
  create.
- `language` → `read_only`.
- `validate`: `version.board_game_id == board_game.bgg_id`, else 400.

`Copy.save()`:
- If `version_id` set: `self.language = self.version.language` before super().

`recompute_pending` unchanged (`language` now always set when version chosen).

## Frontend (phased after backend)

Copy-create form:
1. User selects a board game.
2. Form calls `GET /api/games/{bgg_id}/versions/` (triggers enrichment).
3. Render version dropdown (name + language).
4. On version select, auto-fill a read-only `language` field from the choice.
5. Submit includes `version`; `language` no longer user-entered.

## Migrations

1. `catalog`: create `BoardGameVersion`.
2. `copies`: add `Copy.version` (nullable FK).

(No `BoardGame` migration — `metadata` already exists.)

## Tests

- `bgg/thing_parse`: parse the `bgg_results.xml` fixture — game fields, a
  multi-language version (pipe-join), publisher, dims.
- `ensure_game_enriched`: mocked `fetch_thing_xml` →
  - happy path: metadata keys + version rows written, `synced_at` set, second
    call is a no-op (fetch not re-called);
  - API-down: returns un-enriched game, no exception, `synced_at` absent.
- `GET /games/{id}/versions/`: triggers enrichment, returns versions.
- `CopySerializer`: create without `version` → 400; create with mismatched
  `version` (wrong game) → 400; valid create derives `language` from version;
  `language` in payload is ignored.

## Verification

- Backend test suite green (existing 182 + new).
- `enrich_bgg.py` still runs standalone after parser extraction (smoke: parse
  fixture).
