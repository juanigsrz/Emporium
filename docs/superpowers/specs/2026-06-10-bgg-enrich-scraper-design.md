# BGG Enrichment Scraper — Design

Date: 2026-06-10

## Goal

Enrich the static BGG dump `boardgames_ranks.csv` (~177k games) with live data
from the authorized BGG XML API (`xmlapi2/thing`), and capture per-edition
version data, into two new CSV files. Long-running and resumable.

## Non-goals

- No database writes. CSV output only.
- No changes to `boardgames_ranks.csv` (read-only source of ids).
- No Django integration. Standalone script.

## Form

Single standalone script at repo root: `enrich_bgg.py`.

- Pure standard library (`urllib.request`, `csv`, `xml.etree.ElementTree`,
  `json`, `time`, `argparse`). No `requests` (not installed globally); zero
  third-party deps. Runs with plain `python3 enrich_bgg.py`.
- Reads bearer token from `os.environ["BGG_API_KEY"]` (exported locally).

## API request

Per batch of up to 20 ids:

```
GET https://boardgamegeek.com/xmlapi2/thing?id=<csv ids>&stats=1&versions=1
Authorization: Bearer <BGG_API_KEY>
```

## Outputs

### `boardgames_enriched.csv`

Original 16 columns passed through unchanged (the dump is the official BGG
snapshot, so `average` and `yearpublished` already match the API and are not
re-fetched), plus appended columns:

| column | source |
|---|---|
| `thumbnail` | `<thumbnail>` text |
| `minplayers` | `<minplayers value>` |
| `maxplayers` | `<maxplayers value>` |
| `averageweight` | `statistics/ratings/averageweight value` (complexity) |
| `languagedependence` | `language_dependence` poll: level (1–5) with most votes |
| `languagedependence_label` | that level's `value` text |

A row is written for every source id processed. If the API returns no `<item>`
for an id (deleted/missing), the source columns are written and the appended
columns are left blank.

### `boardgame_versions.csv`

One row per `boardgameversion` item found in any game's `<versions>` block.

| column | source |
|---|---|
| `boardgame_id` | parent game id (from the enclosing `<item>`) |
| `id` | version item id |
| `name` | version `name[type=primary] value` |
| `thumbnail` | version `<thumbnail>` text (may be empty) |
| `language` | all `link[type=language] value`, pipe-joined (`English\|German`) |
| `publisher` | all `link[type=boardgamepublisher] value`, pipe-joined (value only) |
| `yearpublished` | version `<yearpublished value>` |
| `width` | version `<width value>` |
| `length` | version `<length value>` |
| `depth` | version `<depth value>` |
| `weight` | version `<weight value>` (physical weight, NOT complexity) |

## Resume

Sidecar cursor file `boardgames_enriched.progress.json` storing the next
source-row index to process.

Per-batch ordering (durability before progress):
1. Append version rows for the batch.
2. Append enriched game rows for the batch.
3. `flush()` + `os.fsync()` both output files.
4. Write cursor file (next index).

Cursor only advances after output rows are durable. A crash re-processes at
most one batch (≤20 games) → bounded duplicate rows. Cursor advances even when
the API omits an id, so no infinite retry. Resume is O(1) (read cursor), not a
177k-row scan.

`--no-resume` ignores the cursor and truncates outputs to start fresh.

## Rate limiting / backoff

Goal: settle at the smallest sleep the server tolerates and stay there — no
perpetual sawtooth back into the rate limit. The delay only ever increases.

- `current_delay` starts at `--min-delay` (default 1.0s); `time.sleep` before
  each request.
- On rate-limit (HTTP 429/503, non-XML throttle body, or HTTP 202 queued):
  the current rate is proven too fast, so step up —
  `current_delay = min(current_delay + 1.0, --max-delay)` — and retry the same
  batch.
- No decay. Once raised, the delay is not lowered for the rest of the run.

Effect: with no limiting it sits at `--min-delay`. After hits it converges to
the smallest sustainable delay (last-failed-delay + 1) and never re-probes a
rate already known to fail. Tradeoff: a one-off transient spike leaves the run
slightly conservative for its remainder; deliberate, to avoid re-throttling.
A fresh `--min-delay` is reachable on the next invocation if conditions change.

## CLI args

| arg | default |
|---|---|
| `--source` | `boardgames_ranks.csv` |
| `--out` | `boardgames_enriched.csv` |
| `--versions-out` | `boardgame_versions.csv` |
| `--batch-size` | 20 |
| `--min-delay` | 1.0 |
| `--max-delay` | 10.0 |
| `--limit` | none (process all) |
| `--no-resume` | off |

## Parsing notes (from `bgg_results.xml` fixture)

- Game fields live on the top-level `<item type="boardgame">`.
- `language_dependence` is a `<poll name="language_dependence">` with `<result
  level=.. value=.. numvotes=..>`; pick max `numvotes` (ties → lowest level).
- Versions live in `<versions>` as `<item type="boardgameversion">` children;
  language/publisher are `<link>` children (can repeat).

## Verification

- Parser correctness: run parse over `bgg_results.xml`, confirm game + version
  fields (incl. a multi-language version) extract correctly.
- End-to-end: live run of ids 1–20, confirm both CSVs + cursor written.
- Resume: re-run, confirm it skips processed ids via the cursor.
