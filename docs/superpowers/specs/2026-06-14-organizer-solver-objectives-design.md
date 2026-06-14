# Organizer-selectable solver objectives

**Date:** 2026-06-14

## Problem

The external Pareto solver (`../Pareto/main.py`) now accepts:

- `location <user> <lat> <lng>` input directives, and
- `--kpi trades,users,distance` — a priority-ordered objective list (leftmost
  optimized first): maximize trades, then users with >= 1 trade, then minimize
  total shipping distance between trading users.

Today the organizer matching section exports a single `wants.txt`
(`build_wants`) with no objective control and no `location` lines, and the
organizer runs the solver manually in their own terminal. We want the organizer
to pick which objectives to optimize and in what priority order (any non-empty
subset of the three — not necessarily all), and, when `distance` is chosen, to
include each user's available location in the exported `wants.txt` so the solver
can compute shipping distances.

## Scope

- The app does **not** run the solver. Selection drives only two things: the
  contents of the exported `wants.txt` (whether `location` lines are included)
  and a plain-text `--kpi <list>` string shown in the UI for the organizer to
  pass when they run the solver manually.
- Stateless: the selection lives in frontend state and is passed as a query
  param to the export endpoint. No model field, no migration.
- FakeMatcher (the in-app placeholder matcher) is untouched.

## Backend

### `wants_export` endpoint — `backend/events/views.py`

`GET /events/<slug>/wants-export/?kpi=<comma-list>`

- Parse `kpi` query param: split on `,`, strip, drop empties. Validate each
  token against `{trades, users, distance}`; reject duplicates. On any invalid
  or duplicate token raise `ValidationError` (400).
- Absent/empty param → default `["trades"]` (matches the solver default).
- `include_locations = "distance" in kpi`.
- Call `build_wants(event, include_locations=include_locations)`.

The `--kpi` string is **not** consumed by the backend beyond the
`distance`-membership check; it is a CLI flag surfaced only in the UI.

### `build_wants` — `backend/matching/external_solver.py`

Signature: `build_wants(event, include_locations: bool = False) -> str`.

When `include_locations` is true, append a trailing block of
`location <username> <lat> <lng>` lines, sorted by username, for every user who:

1. owns an active `EventListing` in this event **or** has an active `TradeWish`
   in this event (covers both ends — owner and receiver — of every possible
   move), and
2. has a `Profile` with non-null `latitude` and `longitude`.

Users without coordinates are skipped; the solver already tolerates moves with a
missing location on either end (`distance_terms` skips them). Location lines are
emitted after the existing body / dupcap / money blocks; file order is
irrelevant to the solver's parser.

Coordinates come from `accounts.models.Profile` (`latitude`, `longitude`);
reuse the existing `_load_coords()` (returns `user_id -> (lat, lng, max_km)`).
The username for each user id is taken from the already-loaded listings
(`el.copy.owner`) and wishes (`w.user`), so no extra user query is needed.

## Frontend — `XToYSolvePanel` in `frontend/src/features/matching/MatchRunPage.tsx`

Add an objectives picker above the existing Download button:

- Ordered checklist of the three objectives, each row: `☑ include` + label +
  `↑` / `↓` reorder controls. The order of the list = solver priority
  (leftmost/topmost optimized first).
- **Default:** only `trades` checked. (Distance off by default → no locations
  emitted until opted in.)
- At least one objective must remain checked. If none are checked, disable the
  Download button and show a hint.
- Download builds the param from the checked objectives in their listed order
  and calls `fetchWantsExport(slug, kpi)`.
- Below the Download button, show plain text:
  `Objectives: --kpi <list>` and a one-line note: "pass this flag when running
  the solver". Hidden/empty when nothing is selected.

### `fetchWantsExport` — `frontend/src/api/matching.ts`

Add an optional `kpi: string[]` argument. When non-empty, send
`?kpi=<joined-with-commas>` on the GET request. Existing callers (if any) keep
working with the default.

## Tests — `backend/matching/test_external_solver.py`

- `build_wants(event, include_locations=True)` emits `location` lines for users
  with coordinates and **no** line for a user lacking coordinates.
- `build_wants(event, include_locations=False)` (and the default call) emits
  **no** `location` lines.
- Endpoint: `?kpi=trades,distance` response body contains `location` lines;
  `?kpi=trades` (or no param) contains none.
- Endpoint: an invalid token (e.g. `?kpi=foo`) and a duplicate
  (`?kpi=trades,trades`) each return 400.

## Out of scope

- No DB model / migration (stateless selection).
- No backend execution of the solver / subprocess wiring.
- No change to FakeMatcher or the upload-solution parsing path.
