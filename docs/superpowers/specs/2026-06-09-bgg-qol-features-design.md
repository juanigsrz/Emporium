# BGG-Powered QoL Features — Design

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan.

Five quality-of-life features for the math-trade app, all built on a shared
foundation that pulls public BoardGameGeek (BGG) data. The app already has a
Django backend (apps: `accounts`, `catalog`, `copies`, `events`, `trades`,
`matching`) and a Vite/React frontend.

---

## 0. Constraints & key decisions

- **No BGG XML API.** `xmlapi2` became auth-gated in late 2025. All BGG data is
  scraped from **public HTML pages** (`boardgamegeek.com/collection/...`,
  `/geeklist/...`) with an HTML parser.
- **Geocoding** for distance uses the free public **OSM Nominatim** endpoint.
- **No GeoDjango.** Distance is plain `lat/lng` floats + a haversine helper.
- **Tests never hit the network.** All external HTTP (BGG, Nominatim) is mocked
  against checked-in fixtures.
- **Catalog is the source of truth for games.** `catalog.BoardGame` (PK =
  `bgg_id`) already holds ~177k games from a CSV import. Scraped `bgg_id`s that
  are **not** in the catalog are skipped and reported — never auto-created.
- **`docs/API_CONTRACT.md` and `docs/DATA_MODEL.md` are binding.** Update both
  whenever an endpoint or model changes; FE and BE depend on them.

### Defaults locked during brainstorming
- A "pending" imported copy = **missing `language` or `condition`**. All other
  copy fields stay optional.
- Skip-existing-duplicates dedupe key = **(owner, bgg_id)** — not edition/language.
- F1 "simple filters" = in-my-wishlist, average rating, rank, year, expansion.
  **No weight filter** (weight is not in our catalog and we are not fetching it).

---

## 1. Shared foundation — new `bgg` app

A single Django app owns all BGG scraping so F1/F2/F5 reuse one client, one job
model, and one polling contract.

### 1.1 `BggClient` service (`bgg/client.py`)
Pure functions / a thin class that fetch public HTML and parse it. Adds the
dependency **`beautifulsoup4`** (parser: built-in `html.parser`, no `lxml`
needed).

Methods:
- `fetch_collection(username, kind) -> list[CollectionRow]`
  where `kind ∈ {WISHLIST, OWNED, OWNED_EXPANSIONS, RATED}`. Builds the right
  public collection URL per kind (see URL table below), follows pagination,
  parses each row.
- `fetch_geeklist(geeklist_id) -> list[CollectionRow]`.

`CollectionRow` (dataclass): `bgg_id:int, name:str, thumbnail:str,
my_rating:Decimal|None, language:str|None, wishlist_comment:str|None,
status:dict` (raw status flags when present).

**Parsing strategy (tolerant):** key every row off the anchor
`a[href^="/boardgame/"]` (or `/boardgameexpansion/`) — the href yields `bgg_id`
and the text yields the name. Other cells (rating, version/language, wishlist
comment) are best-effort: absent → `None`. This keeps the parser resilient to
BGG layout drift; only the row anchor is load-bearing.

**HTTP hygiene:** descriptive `User-Agent`, throttle (≥1 req/s, configurable),
retry with backoff on 429/5xx, hard timeout. Base URL + throttle live in Django
settings so tests can override.

**Collection URL map** (subtype + flag per kind; `ff=1` keeps the flat list):
| kind | URL template |
|---|---|
| WISHLIST | `/collection/user/{u}?subtype=boardgame&wishlist=1&columns=status\|thumbnail\|title\|wishlistcomment\|shop&ff=1` |
| OWNED | `/collection/user/{u}?subtype=boardgame&own=1&ff=1` |
| OWNED_EXPANSIONS | `/collection/user/{u}?subtype=boardgameexpansion&own=1&ff=1` |
| RATED | `/collection/user/{u}?subtype=boardgame&rated=1&columns=status\|thumbnail\|title\|rating&ff=1` |

### 1.2 `ImportJob` model (`bgg/models.py`)
Mirrors `matching.MatchRun` (async job + pollable status).

| field | type | notes |
|---|---|---|
| user | FK(User, related=bgg_imports) | who triggered it |
| kind | choice | WISHLIST, RATINGS, OWNED, GEEKLIST |
| source_ref | char blank | geeklist id / username override |
| options | JSON default dict | e.g. `{"skip_duplicates": true}` |
| status | choice | PENDING, RUNNING, DONE, FAILED |
| summary | JSON default dict | counts: matched, skipped, pending, errors |
| result | JSON default dict | `{matched:[bgg_id...], skipped:[{bgg_id,reason}], pending:[copy_id...]}` |
| log | text blank | human-readable progress/errors |

### 1.3 Celery tasks (`bgg/tasks.py`)
One task per kind (or a dispatcher) that: sets `RUNNING`, calls `BggClient`,
applies the importer, writes `summary`/`result`/`log`, sets `DONE`/`FAILED`.
Importers live next to the feature they serve but are invoked from here:
- WISHLIST → upsert `accounts.Wishlist` (F1)
- RATINGS → upsert `accounts.GameRating` (F2)
- OWNED / GEEKLIST → create `copies.Copy` (F5)

### 1.4 API
| method | path | notes |
|---|---|---|
| POST | `/api/bgg/imports/` | `{kind, source_ref?, options?}` → `{id, status:"PENDING"}`. Requires `profile.bgg_username` (except GEEKLIST, which uses `source_ref`). |
| GET | `/api/bgg/imports/{id}/` | poll: `{id, kind, status, summary, result, log}` (mine only). |

FE polls `GET .../{id}/` every ~2 s while PENDING/RUNNING (same pattern as
match runs), then invalidates the relevant query keys.

### 1.5 Test fixtures
Checked-in sample HTML under `backend/bgg/fixtures/` for: a wishlist page, an
owned page, an owned-expansions page, a rated page, a geeklist, and a paginated
2-page collection. `BggClient` HTTP is mocked to serve these. Importer tests use
catalog games already present in the test DB (the suite seeds known `bgg_id`s).

---

## 2. Data-model changes

All additive (new fields/models + migrations). No destructive changes.

### accounts
- **Profile** + `latitude` float null, `longitude` float null,
  `max_trade_distance_km` int null (null = no self-limit). `location` stays the
  free-text address input that gets geocoded.
- **GameRating** (new): `user` FK, `board_game` FK(catalog.BoardGame,
  related=ratings), `value` Decimal(3,1) validated 1.0–10.0,
  `created`/`updated`. `unique_together = (user, board_game)`.

### copies
- **Copy** + `is_pending` bool default False, + `import_source` char(40) blank
  (e.g. `BGG_OWNED`, `BGG_GEEKLIST`, empty for manual). A pending copy is one
  imported without `language` **or** `condition`. **Guard:** creating an
  `EventListing` from a pending copy → 400.

### events
- **TradeEvent** + `require_location` bool default False,
  `center_latitude` float null, `center_longitude` float null,
  `max_distance_km` int null. When `require_location` is set, join requires the
  user to have lat/lng; when a center + radius is set, join requires the user
  within `max_distance_km`.

### trades
- No change. `WantGroup.duplicate_protection` already exists.

---

## 3. Feature specs

### F1 — Wishlist sync + want-builder filters

**Sync.** `POST /api/bgg/imports/ {kind:"WISHLIST"}` → scrape the wishlist
collection → for each row, if `bgg_id` is in catalog, `update_or_create`
`Wishlist(user, board_game_bgg_id)` (carry `wishlist_comment` into `note`).
Rows not in catalog → `result.skipped`. Summary reports matched/skipped counts.

**Filters.** Extend `GET /api/events/{slug}/games/` with:
- `?wishlisted=true` — only games whose `bgg_id` is in the requester's Wishlist.
- `?min_rating=<float>` — `average >= value`.
- `?is_expansion=<bool>` and existing `?ordering=rank|-average|name`.

**FE.** `MyWantsPage` game-browse panel gets a filter bar (wishlist toggle, min
rating, expansion, sort) + a "Sync BGG wishlist" button that starts the import
job and shows progress, then refetches the wishlist + game list. Button disabled
with a hint if `bgg_username` is unset (links to profile).

### F2 — Rate canonical games + grid auto-tick + ratings import

**Ratings CRUD.** `GET/POST/DELETE /api/game-ratings/` (mine):
- list item: `{id, board_game (bgg_id), board_game_name, value}`
- POST body: `{board_game: <bgg_id>, value: <1.0–10.0>}`; upsert on
  (user, board_game). DELETE by id.

**Import.** `POST /api/bgg/imports/ {kind:"RATINGS"}` → scrape rated collection →
upsert `GameRating` for in-catalog rows; skip + report the rest.

**Grid auto-tick.** In `MyWantsPage` `GridMode` (rows = want targets, cols = my
own items), add an **"Auto-tick by rating"** button. For a cell (want-target `W`,
my-item `O`): tick iff `rating(O.board_game) ≤ rating(W.board_game)`, both
ratings present. Missing either rating → leave the cell as-is. This only mutates
the **staged** editor state (the existing save flow persists it); the user
reviews before saving. FE loads all of the user's ratings as a `bgg_id → value`
map to compute ticks client-side.

### F3 — Duplication-protection toggle (advanced view)

Backend already accepts `duplicate_protection` on WantGroup create/patch and the
normal "My Wants" builder already sets it `true`. **Only delta:** add a per-
WantGroup on/off toggle in the **advanced** `WantListBuilderPage`, wired to the
existing PATCH. No backend change.

### F4 — Location + distance restrictions

**Geocoding.** When a Profile is saved with a changed non-empty `location`,
geocode via Nominatim (`/search?q=...&format=json&limit=1`) and store
`latitude`/`longitude`. Done in the serializer/save path with a polite
User-Agent; failures leave lat/lng null and surface a non-blocking warning.
Cache by normalized address string to avoid duplicate calls (simple cache table
or Django cache).

**Organizer gate (join).** `POST /api/events/{slug}/join/`:
- if `require_location` and the user has no lat/lng → **400** ("set your
  location first").
- if `center_lat/lng` + `max_distance_km` set and `haversine(user, center) >
  max_distance_km` → **400** ("outside the event area").
Event serializer exposes the new fields (organizer-writable).

**User self-limit.** `Profile.max_trade_distance_km`. A wisher won't be matched
with — and won't see — copies owned by users farther than this.

**Enforcement (reuse existing block path).** `matching/external_solver.py`
already excludes blocked owners from a wisher's expansion via `_blocked_with(
user_id)`. Add `_distance_blocked(user_id)` returning owner ids beyond the
wisher's `max_trade_distance_km` (and, if the event constrains it, beyond the
event radius), and union it into the blocked set used by `_expand`. Hard
guarantee at solve time, zero new solver structure.

**UI.** Want-builder greys/hides listings whose owner is beyond the user's
limit; profile form gains location + max-distance fields; event organizer form
gains the location-gate fields. Distance math: a shared `haversine_km(lat1,
lng1, lat2, lng2)` helper (BE; FE mirrors only what it needs for greying).

### F5 — Owned/geeklist import → copies (with pending)

**Import.** `POST /api/bgg/imports/`:
- `{kind:"OWNED", options:{skip_duplicates:true}}` → scrape owned boardgames +
  owned expansions.
- `{kind:"GEEKLIST", source_ref:"<geeklist_id>", options:{...}}` → scrape a
  geeklist.

For each in-catalog row, create a `Copy(owner=user, board_game=bgg_id,
import_source=...)`. If the row is missing `language` **or** `condition` →
`is_pending=true` (BGG owned/geeklist data rarely carries condition, so most
imports start pending). If `skip_duplicates` and the user already owns a Copy of
that `bgg_id` → skip + report. Rows not in catalog → skip + report. `result`
lists created copy ids, pending ids, and skipped reasons.

**Pending UX.** `MyCopiesPage` shows pending copies with a "Complete details"
banner highlighting whichever required field is missing (`language` and/or
`condition`). Saving the missing field(s) re-evaluates and clears `is_pending`
once both are present. A pending copy cannot be added to an event (the
EventListing-create guard returns 400 with a clear message).

---

## 4. API additions (contract delta summary)

| method | path | feature |
|---|---|---|
| POST | `/api/bgg/imports/` | F1/F2/F5 |
| GET | `/api/bgg/imports/{id}/` | F1/F2/F5 |
| GET/POST/DELETE | `/api/game-ratings/` | F2 |
| GET | `/api/events/{slug}/games/?wishlisted=&min_rating=` | F1 |
| (fields) | Profile: `latitude,longitude,max_trade_distance_km` | F4 |
| (fields) | TradeEvent: `require_location,center_latitude,center_longitude,max_distance_km` | F4 |
| (fields) | Copy: `is_pending,import_source` | F5 |
| (behavior) | `POST /events/{slug}/join/` distance/location gate | F4 |
| (behavior) | EventListing create rejects pending copies | F5 |

Full request/response shapes go into `docs/API_CONTRACT.md` during
implementation.

---

## 5. Sequencing & agent team

Team: one **backend** dev, one **frontend** dev, one **QA** (all Sonnet).

1. **Foundation first (BE):** `bgg` app (`BggClient`, parsers, fixtures,
   `ImportJob`, Celery tasks, import endpoints) + **all migrations** for the
   model changes in §2. This unblocks F1/F2/F5. **F3** and **F4 models** can land
   in parallel immediately (no BGG dependency).
2. **Parallelize feature work:**
   - F1 (wishlist sync + filters), F2 (ratings + grid), F5 (owned/geeklist) all
     consume the foundation.
   - F4 (location/distance) is independent — its only shared touch-point is the
     solver block path.
3. **FE** builds each workstream's UI against the documented endpoints; **QA**
   verifies each feature against fixtures + `API_CONTRACT.md`, filing
   `qa/BUG-*.md` reports in the existing format and re-testing after fixes.

Dependency note: F2's grid auto-tick needs the ratings endpoint (BE) before the
FE wiring; F1's filter bar needs the `games/` filter params before FE.

---

## 6. Testing strategy

- **Unit (BE):** `BggClient` parsers against the checked-in HTML fixtures
  (including a paginated case and a malformed/missing-cell case); haversine;
  geocode parsing (mocked Nominatim JSON).
- **Contract (BE):** every new endpoint — auth, mine-scoping, the join
  location/distance gate, the pending-copy EventListing guard, filter params.
- **Importers (BE):** wishlist/ratings/owned/geeklist against fixtures with a
  seeded catalog; assert matched/skipped/pending counts and that out-of-catalog
  rows are skipped.
- **All external HTTP mocked** — no live BGG/Nominatim calls in the suite.
- **QA pass** per feature before sign-off; existing 182 BE tests stay green.
