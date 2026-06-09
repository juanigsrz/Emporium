# Spec C — Almanac tab + enriched per-game dropdown

**Date:** 2026-06-09
**Status:** Approved (design)
**Area:** `frontend/src/features/trades/MyWantsPage.tsx` + `frontend/src/api/ratings.ts`.

Third of three specs from a larger QOL request. **Spec A** (event page) and **Spec B**
(profile BGG hub + location) are done. This spec depends on B having shipped: it
**removes** the two BGG buttons from My Wants, which B re-homed in the Profile.

## Problem

The "My Wants" page bundles game discovery (the paginated `GameBrowse` "almanac")
above two refinement views (Visual, Grid), and the almanac's per-game expand only
lists copies. Users want the almanac as its own primary section and richer per-game
controls there:

1. The almanac (`GameBrowse`) should be its own tab — the default — since it is the
   most-used surface. Visual and Grid become refinement-only views.
2. The per-game expand dropdown should let you, for that canonical game: set a
   rating, set a buy-price (the max you'll pay), and add the game to one of your
   custom X-to-Y want groups.
3. The two BGG buttons ("Sync BGG wishlist", "Import ratings from BGG") should leave
   My Wants — they now live in the Profile (Spec B).

## Decisions (from brainstorming)

- **Tabs:** `almanac | visual | grid`, default `almanac`. New games are added only in
  the Almanac; Visual and Grid operate on already-added wants.
- **Rating:** saves immediately (POST upsert / DELETE), with a small success tick;
  independent of the want-list Save bar.
- **Buy-price:** shown only when `event.money_enabled`; the field is **disabled until
  the game is wanted on at least one of the user's offered items** (any-copy toggle or
  a specific-copy pick). Editing it stages into the want-list Save bar. No enabling
  checkbox and no auto-want: a price is only meaningful once a want exists.
- **Add to WantGroup:** dropdown of the user's *custom* want groups (those not part of
  the auto 1-to-1 trios) + an inline "+ New group" (name; `min_receive = 1`). Adds the
  game as a BOARD_GAME (any-copy) target and persists immediately.
- **Money model:** one price per canonical game, applied to that game's want targets
  across all the user's offered items.

## Goals (success criteria)

- Almanac is its own default tab; Visual and Grid no longer render the browse panel.
- The two BGG buttons are gone from My Wants; no dead imports remain.
- Expand a game card → set/clear its rating (persists immediately).
- Want a game → the buy-price field enables; set a price, Save → `money_amount` is
  written on that game's want items across the user's want groups.
- Add a game to a custom want group (existing or newly created inline) from the
  dropdown; it persists immediately.
- `npm run build` + `npm run lint` (`--max-warnings 0`) clean; backend suite unchanged.

## Non-goals

- No backend changes (game-ratings upsert/DELETE and want-item `money_amount` already
  exist).
- No change to the advanced X-to-Y builder page.
- No new "want" semantics beyond attaching price to existing want targets; the buy-
  price never auto-creates a want.
- Buy-price UI hidden entirely when the event has money disabled.

## Architecture & data flow

### Ratings API (`frontend/src/api/ratings.ts`)

Add `useDeleteRating`:

```ts
export function useDeleteRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await apiClient.delete(`/game-ratings/${id}/`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] }),
  })
}
```

`useSetRating` (POST upsert) already exists. To clear a rating, find its `id` by
`board_game` from `useMyRatings()` data and call `useDeleteRating`.

### Editor money state (`MyWantsPage.tsx`)

- `PageModel` gains `baseMoneyByGame: Map<number, string>` — for each canonical game,
  the first non-null `money_amount` among its want items (else `''`). Built in
  `buildModel` while scanning want-group items.
- `useEditor` gains `moneyByGame` (session overrides) + `setMoney(gameId, value)`.
  - `priceForGame(gameId)` = session override if present, else base.
  - `dirtyCount` includes money entries that differ from base.
  - `changedListingIds` includes any listing whose want group currently holds a target
    for a game whose price changed (so the want group is re-persisted).
- `persistChanges` writes `money_amount` for each item from `priceForGame(t.gameId)`
  when `event.money_enabled` (parse: `'' → null`, else `Number`); omits money when the
  event has money disabled (unchanged from today for those events).

### Almanac dropdown controls (`GameBrowse` expanded card)

In the expanded section (where `GameCopies` renders), add a per-game controls row:

- **Rating:** numeric input (1–10, step 0.5) bound to the current rating; on
  change/blur, `useSetRating({ board_game: gameId, value })`; a clear "×" calls
  `useDeleteRating(ratingId)`. Small "✓" on success.
- **Buy-price:** rendered only when `event.money_enabled`. `disabled` unless the game
  is wanted on ≥1 of the user's listings (reuse `isWanted` / `groupIsOn`). Bound to
  `editor.priceForGame(gameId)`; `onChange → editor.setMoney(gameId, value)`.
- **Add to WantGroup:** a `<select>` of custom want groups + an "+ New group" inline
  form (name input). Selecting an existing group → append a BOARD_GAME item for this
  game and `patchWantGroupRaw(slug, groupId, { items: [...existing, newItem] })`.
  "New group" → `createWantGroupRaw(slug, { name, min_receive: 1, items: [newItem] })`.
  Then `invalidateTrades(qc, slug)`. "Custom" = want groups whose id is not a value in
  `model.wantGroupByListing` (the auto 1-to-1 groups).

### Tab restructure (`MyWantsPage` main component)

- `type ViewMode = 'almanac' | 'visual' | 'grid'`; default `'almanac'`.
- Tab bar lists all three; `GameBrowse` renders under `almanac`, `VisualMode` under
  `visual`, `GridMode` under `grid`.
- Remove the "Import ratings from BGG" block and its hooks/state.
- Inside `GameBrowse`, remove the "Sync BGG wishlist" button and the BGG sync
  state/hooks (`useStartImport`, `useImportJob`, job polling effect, `handleSync`),
  keeping the "In my BGG wishlist" filter checkbox and its `wishlisted` state. Remove
  now-unused imports (`useStartImport`, `useImportJob`, `useMyProfile` if unused after
  both removals, `EVENTS_KEYS` if its only use was sync invalidation — verify before
  deleting).

## Error handling

- Rating set/clear failures: surface a small inline error near the control; do not
  block other edits.
- Add-to-WantGroup failure: inline error in the dropdown area; no partial state (the
  patch/create is a single request).
- Price parsing: blank → `null`; invalid handled by the numeric input (`type=number`).

## Testing

No frontend test harness. Verify with `npm run build` + `npm run lint`, plus manual:

- Almanac is the default tab; Visual and Grid no longer show the browse panel.
- "Import ratings from BGG" and "Sync BGG wishlist" are absent from My Wants.
- Expand a card → set a rating (persists across reload), clear it (gone).
- Before wanting a game, the price field is disabled; after wanting it (any-copy or a
  specific copy), the field enables; set a price + Save → reload shows the price on the
  want (and in the advanced builder's want-group item money).
- Add a game to an existing custom want group and via "+ New group"; both appear in the
  advanced X-to-Y builder.
- Save bar reflects price-only changes (dirty count > 0 when only a price changed).
- Backend suite remains green (no backend change).

## Risks

- Highest-touch single file of the three. The money threading through
  `buildModel`/`useEditor`/`persistChanges` is the main risk — keep the changes
  additive and preserve existing want-toggle behavior for money-disabled events.
- Import cleanup after removing the BGG buttons: rely on `npm run lint`
  (`--max-warnings 0`) to catch orphans.
