# Wants Pricing Polish — Grid Price Field, Hidden Spinners, Price > 0

**Date:** 2026-06-14
**Batch:** F (Wants builder) — sixth of six platform-polish batches.
**Scope:** Frontend (`MyWantsPage.tsx`, `EventDetailPage.tsx`, `index.css`) +
backend validators (`trades/serializers.py`, `events/serializers.py`) + backend tests.

## Problem

1. **F1** — The want-list builder's Grid view has no per-game price field (the Catalog
   view does). The Catalog price field's only defect is that it accepts 0 (covered by F3).
2. **F2** — Number inputs for rating and price show native step arrows, which behave
   inconsistently; they should be hidden.
3. **F3** — Ask prices can be set to 0, so a user can accidentally give a game away or
   bid $0. All ask prices must be greater than 0.

## Goals

- Add a per-game price input to the Grid view, sharing the staged-save model.
- Hide native spin buttons on rating/price number inputs.
- Reject a price of 0 (or negative) on the per-game price (UserGamePrice) and the
  event-listing sell price (EventListing.sell_price), both client- and server-side.

## Non-Goals

- WantBid per-want overrides (not edited in these flows).
- Hiding spinners on unrelated numeric inputs (e.g. create-event max money/distance).
- Changing the Catalog price field beyond the >0 rule and hidden spinners.

## F1 — Grid view price field

In `MyWantsPage.tsx`:

- Add `moneyEnabled: boolean` to `GridModeProps`; pass `moneyEnabled={event.money_enabled}`
  at the `<GridMode … />` call site.
- In `GridMode`, in each want-game row header `<th>` (the `groupTargetsByGame(...).map`
  row label cell), when `moneyEnabled` render a compact price input below/after the game
  name, wired to the existing staged editor:
  `value={editor.priceForGame(g.gameId)}`, `onChange={(e) => editor.setMoney(g.gameId, e.target.value)}`.
  Use the same `min="0.01" step="0.01"` + `no-spinner` styling as the Catalog price.
  (Negative synthetic gameIds `< 0` cannot be priced — guard by only rendering the input
  when `g.gameId >= 0`, mirroring the persist-time `if (gameId < 0) continue`.)
- Changes persist through the existing Save bar (no new save path).

## F2 — Hide number spinners

- Add to `index.css` `@layer utilities`:
  ```css
  .no-spinner::-webkit-outer-spin-button,
  .no-spinner::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .no-spinner {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  ```
- Apply the `no-spinner` class to these rating/price number inputs:
  - `MyWantsPage.tsx`: `RatingPriceRow` rating input and price input; the Min-rating
    filter input; the new Grid price input.
  - `EventDetailPage.tsx`: the `MyListingCard` Min. ask input.

## F3 — Prices cannot be 0

**Backend:**

- `trades/serializers.py` `UserGamePriceSerializer.validate_price`: change the guard from
  `if value < 0` to `if value <= 0`, message `"price must be greater than 0."`.
- `events/serializers.py` `EventListingSerializer.validate_sell_price`: change
  `if value is not None and value < 0` to `if value is not None and value <= 0`, message
  `"sell_price must be greater than 0."` (`null` remains allowed — clears the override.)

**Backend tests** (`trades/tests_pricing.py`), added next to the existing negative-price tests:

- In the game-prices API test class: `test_zero_price_rejected` — `PUT` `price: "0"` → 400.
- In the listing sell-price test class: `test_zero_sell_price_rejected` — `PATCH`
  `sell_price: "0"` → 400.

**Frontend guards** (surface inline, avoid a failed network round-trip):

- `MyWantsPage.tsx` `handleSave`: before `persistChanges`, iterate
  `editor.changedGamePrices`; for any entry whose trimmed value is non-empty and parses
  to a number `<= 0`, call `setSaveError("Price must be greater than $0.")`, `setSaving(false)`,
  and return without saving. (Empty string = clear price, still allowed.)
- `EventDetailPage.tsx` `MyListingCard.handleSave`: if the trimmed `draft` is non-empty and
  parses to `<= 0`, `setErr("Price must be greater than $0.")` and return before calling
  `setListingSellPrice`.
- Set `min="0.01"` on the affected price inputs (semantic; the `step` stays `0.01`).

## Verification

- `cd frontend && npm run build` succeeds; `npm run lint` no new warnings.
- `cd backend && python manage.py test trades events` passes, including the two new
  zero-rejected tests.
- Manual: Grid view shows a per-game price input that saves via the Save bar; rating and
  price inputs show no step arrows; entering `0` and saving is blocked with a message
  (both the wants per-game price and the event Min. ask).

## Risk / Rollback

Low–moderate. Two one-line backend validator tightenings (covered by tests), additive
grid field, a CSS utility, and client-side guards. No data migration or schema change.
Rollback = revert the branch.
