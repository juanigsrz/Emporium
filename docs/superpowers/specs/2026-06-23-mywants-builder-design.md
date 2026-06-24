# My Wants Builder — Visual Rework + Grid Ask (#4, #6) — Design

## Summary

Two frontend-only improvements to `MyWantsPage`:

- **#4 Visual rework:** make the visual view a clean, at-a-glance picture of each
  item's wishes — bigger wanted-game thumbnails, each with a × to remove that
  game from the wish; drop the redundant text-chip list and the inline add-want
  field. Adding wants happens in the Catalog view.
- **#6 Grid ask:** in the grid, show the seller-side **ask** for each wanted game
  next to the user's existing **bid**, so both sides are visible at once.

**Repo:** Emporium (frontend only). **Verification:** `npm run build` + targeted
eslint + manual checklist (no test runner). One spec, one plan.

## Background

`MyWantsPage` has three views over a shared editor model (`Target` =
`{key,listingId,gameId,gameName,thumbnail,comboId?}`, grouped by game via
`groupTargetsByGame`):

- **Catalog** (`GameBrowse`): browse event games, add wants (the add surface).
- **Visual** (`VisualMode`): per my-listing, an offered-copy thumbnail → arrow →
  the wanted-game thumbnails, then a text chip list of those wants, then a "+ Add
  want" inline picker.
- **Grid** (`GridMode`): a matrix of wanted-game rows × my-item columns; each row
  header shows the game name and (money mode) a per-game **bid** input
  (`editor.priceForGame`/`setMoney` → `UserGamePrice`).

`groupKeys(g)` + `editor.toggle(listingId, key, false)` removes a game's targets
from a listing's wish (the existing remove mechanism). `EventListing` already
exposes `resolved_ask` (string|null) via the listings API.

## #4 — Visual rework (`VisualMode`)

Rework the per-listing card:

- **Bigger thumbnails** in the receive cluster (e.g. `h-16 w-16` / `h-20 w-20`
  instead of `h-12 w-12`).
- **Each receive thumbnail gets a × overlay** (small button, top-right corner)
  that removes that game from this listing's wish:
  `groupKeys(g).forEach((k) => editor.toggle(listing.id, k, false))`. (This is the
  same remove action the old text chips used.)
- **Remove** the text chip list block (the `myWants.map(...)` purple chips with
  the badge + × button) — the thumbnails now carry the remove affordance.
- **Remove** the inline "+ Add want" picker (the `addingFor` state, the `addable`
  list, the `+ {gameName}` buttons, and the "+ Add want" / "Done" buttons).
  Wants are added from the Catalog view.
- Keep the header (item name/code + "wants N"), the give→receive row, and the
  empty-state ("No wants yet — add games in the Catalog view.").

Net: `VisualMode` no longer needs the `addingFor` state. The card becomes
offered-copy → big wanted-game thumbnails (each ×-removable).

## #6 — Grid ask (`GridMode`)

- Load the event's listings once: `useEventListings(slug, { page_size: 500 })`,
  build a map `listingId → resolved_ask` (parse the string; skip null).
- For each want-game row, compute the row **ask** = the minimum `resolved_ask`
  over the group's `copyTargets` (`t.listingId`), or null if none priced.
- In the row header, money-enabled only, render the ask next to the existing bid
  input: e.g. `ask: $X` (or `ask: —` when null/barter). Keep the bid input
  unchanged. Combo rows (synthetic `gameId >= COMBO_GAME_OFFSET`) show no
  ask (consistent with their suppressed bid input).

So the row reads: game name · your bid input · `ask: $X` — both sides at a glance.

## Testing

Frontend only: `npm run build` (tsc) + `npx eslint src/features/trades/MyWantsPage.tsx`
+ manual checklist:

- **#4:** Visual view shows larger wanted-game thumbnails; clicking a thumbnail's
  × removes that game from that item's wish (the count + thumbnails update; Save
  persists). No text chip list, no add-want field. Adding still works in Catalog.
- **#6:** In money-enabled grid, each wanted-game row shows `ask: $X` (the
  cheapest available copy's ask) next to the bid input; barter/none shows `—`;
  combo rows show no ask.

## Files

- `frontend/src/features/trades/MyWantsPage.tsx` (`VisualMode`, `GridMode`).

## Out of scope

- Adding wants from the visual view (moved to Catalog).
- Per-copy ask breakdown / ask ranges (show the minimum; per-copy asks remain in
  the Catalog and the grid's expanded copy rows).
- Backend changes (`resolved_ask` already provided by the listings API).
