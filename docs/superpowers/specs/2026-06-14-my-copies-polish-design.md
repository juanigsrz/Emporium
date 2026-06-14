# My Copies Polish — Thumbnails, Card Grid, BGG Import Restructure

**Date:** 2026-06-14
**Batch:** C (My Copies) — third of six platform-polish batches.
**Scope:** Frontend only, single file `frontend/src/features/copies/MyCopiesPage.tsx`.
No backend, API, or data-model changes. `CopyForm.tsx` is **not** touched.

## Problem

1. **C1 — no covers when adding a copy.** The add-copy search typeahead and the
   selected-game chip show only text, so users can't visually confirm the game.
2. **C2 — copies browse as a long single-column list.** On the now navbar-wide page
   this wastes horizontal space.
3. **C3 — the "Import from BGG" controls feel haphazard.** The owned-import button
   and the geeklist input+button sit in a loose `flex flex-wrap` row with no grouping.

## Goals

- Show game cover thumbnails in the add-copy search results and picked-game chip.
- Render the user's copies as a responsive card grid (2 cols sm, 3 cols xl).
- Group the BGG import controls into two clearly labeled sub-cards.

## Non-Goals

- Photo-URL image previews in the copy form (considered, not chosen).
- Thumbnails inside the version `<select>` (native selects can't render images).
- Any change to `CopyForm.tsx`, copy data shape, or import behavior/logic.

## C1 — Covers in the add-copy flow

In `AddCopyModal`:

- **Search results** (the result `<button>`, ~line 574): prepend
  `<GameThumb src={g.thumbnail} alt={g.name} className="h-8 w-8" />` and relayout the
  button to `flex w-full items-center gap-2`: thumbnail, then game name
  (`flex-1 truncate text-ink`), then `year_published` (`shrink-0 text-xs text-moss/70`).
- **Picked-game chip** (~line 589): prepend `<GameThumb src=… className="h-8 w-8" />`
  before the name. The chip currently only carries `picked.name`/`picked.bgg_id`;
  extend the `picked` state object to also hold `thumbnail` so the chip can render it
  without an extra fetch.
  - Change `picked` type from `{ bgg_id: number; name: string }` to
    `{ bgg_id: number; name: string; thumbnail: string }`.
  - At the result click (`setPicked(...)`): pass `thumbnail: g.thumbnail`.

`GameThumb` and the `GameListItem.thumbnail` field already exist; `GameThumb` is
already imported in this file. `GameThumb` renders a neutral placeholder when `src`
is empty, so missing thumbnails are handled.

## C2 — Card grid for browsing copies

- **Grid container** (~line 732): replace the single list box
  `rounded-3xl border-2 border-ink bg-cream overflow-hidden shadow-card` with
  `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4`.
- **`MyCopyCard` outer div** (~line 244): replace
  `p-4 border-b-2 border-ink/10 last:border-0` with
  `flex flex-col rounded-2xl border-2 border-ink/15 bg-cream p-4 shadow-sm`, keeping
  the existing conditional `opacity-60` when `isWithdrawn`. (The card's inner markup —
  pending banner, badges, notes, actions+rating — is unchanged.)
- **`CopiesSkeleton`** (~line 344): replace the single divided box with
  `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4`, each of the 4 skeleton
  items wrapped as a card (`rounded-2xl border-2 border-ink/15 bg-cream p-4`) instead
  of `border-b` rows, so the loading state matches the grid.

## C3 — Two sub-cards in the BGG import panel

In `BggImportPanel`, keep the outer panel
(`rounded-3xl border-2 border-ink/15 bg-teal-50/60 p-4`), its `Import from BGG`
heading, and the skip-duplicates checkbox at top. Replace the
`flex flex-wrap gap-3 items-end` block (~lines 446–487) with `grid gap-3 sm:grid-cols-2`
containing two sub-cards, each `rounded-2xl border-2 border-ink/10 bg-cream/70 p-3 flex flex-col gap-2`:

- **From your collection:** a `text-xs font-bold text-ink` sub-heading, the existing
  "Set your BGG username first" hint (rendered only when `!hasBggUsername`), and the
  existing "Import owned from BGG" button (logic/disabled/title unchanged).
- **From a geeklist:** a `text-xs font-bold text-ink` sub-heading, the existing
  Geeklist ID labeled input, and the existing "Import from geeklist" button
  (logic unchanged). The input may widen to `w-full` within its sub-card.

The status/result/error messages (`isRunning`, `importResult`, `FAILED`,
`importError`) remain below the grid, unchanged.

## Verification

- `cd frontend && npm run build` succeeds.
- `cd frontend && npm run lint` adds no new warnings (the pre-existing
  `CopyForm.tsx` `react-refresh/only-export-components` warning is unrelated).
- Manual: open Add a copy → search shows cover thumbnails; pick a game → chip shows
  its cover. My Copies list renders as a 2-col (sm) / 3-col (xl) card grid. The
  Import from BGG panel shows two labeled sub-cards; owned and geeklist imports still
  start jobs and report results.

## Risk / Rollback

Low. Single-file presentational refactor; no logic, API, or data changes beyond
extending the local `picked` state object with a `thumbnail` string. Rollback =
revert the branch.
