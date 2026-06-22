# Combos Frontend — Design

## Summary

Frontend for combos (#12), building on the merged backend engine. A user can
author combos (bundle ≥2 of their own event listings), and combos appear as
tradeable items under each member game in the want/offer builders — wantable,
offerable, and biddable. Two implementation plans:

- **Plan 2a — Combo builder (authoring):** a new "My Combos" section in
  `EventDetailPage`, plus the `api/combos.ts` client. Ships standalone.
- **Plan 2b — Combos in the trade builders:** combos surface under each member
  game in the visual (`MyWantsPage`) and advanced (`WantListBuilderPage`)
  builders, wantable/offerable/biddable; plus the deferred combo-bid delete.

**Repo:** Emporium only. **Verification:** `npm run build` (tsc -b typecheck) +
`npm run lint` (eslint, `--max-warnings 0`) + a manual QA checklist per task. The
frontend has no test runner; none is added.

## Background

Backend (merged): `Combo`/`ComboItem` (`events` app), `combo_code` token,
`combo` FK on `OfferGroupItem`/`WantGroupItem`/`WantBid`/`TradeAssignment`
(exactly-one `{event_listing, combo}`), combo pricing, and endpoints:

- `GET/POST /api/events/{slug}/combos/` — browse (all active; `?board_game=<bgg_id>`,
  `?mine=1`) / create.
- `GET/PATCH/DELETE /api/events/{slug}/combos/{id}/` — detail / owner-only edit /
  owner-only delete. Blocked when `event.inputs_locked`.
- Want/offer/bid accept combo targets: `WantGroupItem.combo`,
  `OfferGroup.item_combo_ids`, `WantBid.combo`.

Combo serializer read shape (per member): `event_listing` (id), `listing_code`,
`board_game_id`, `board_game_name`, `board_game_thumbnail`. Combo:
`id, owner, owner_username, name, combo_code, active, sell_price, items[]`.

The frontend API layer is per-domain modules of axios functions + react-query
hooks (`api/events.ts` is the pattern to mirror). The want builders group items
by canonical game; `MyWantsPage` is the visual grid (primary flow),
`WantListBuilderPage` the advanced offer/want/wish editor.

## Plan 2a — Combo builder (authoring)

### `api/combos.ts` (new)

Mirror `api/events.ts` structure.

```ts
export interface ComboItemRead {
  id: number
  event_listing: number
  listing_code: string
  board_game_id: number
  board_game_name: string
  board_game_thumbnail: string
}
export interface Combo {
  id: number
  owner: number
  owner_username: string
  name: string
  combo_code: string
  active: boolean
  sell_price: string | null
  items: ComboItemRead[]
  created: string
  updated: string
}
export interface ComboPayload {
  name: string
  sell_price?: string | null
  item_listing_ids: number[]
}
```

Functions: `fetchCombos(slug, { board_game?, mine? })`, `createCombo(slug, payload)`,
`patchCombo(slug, id, payload)`, `deleteCombo(slug, id)`. Hooks: `useCombos`,
`useCreateCombo`, `usePatchCombo`, `useDeleteCombo`. Query keys under a
`COMBOS_KEYS` namespace; mutations invalidate the combos list (and the listings
list is unaffected). `fetchCombos` returns the paginated shape
(`PaginatedResponse<Combo>`), like listings.

### Combo builder UI (`EventDetailPage`)

Add a **"My Combos"** subsection inside the existing
`MyListingsSection` (the "My Listings in This Event" card), below the listings
list. It reuses that section's already-loaded `myListings`.

- **List:** `useCombos(slug, { mine: true })` → a `ComboCard` per combo: name,
  the member game thumbnails (from `combo.items[].board_game_thumbnail`), the
  member names, `sell_price` (or "barter"), an **Edit** and a **Delete** button.
  Delete shows a confirm popup ("Remove combo <name>?") before calling
  `deleteCombo`.
- **Create / Edit form (`ComboForm`):** name input, optional `sell_price`
  (decimal, money-enabled events only — hide when `!event.money_enabled`), and a
  multi-select of *my* listings (checkbox list of `myListings`, each shown with
  game thumbnail + `listing_code`). Submit calls `createCombo` / `patchCombo`
  with `item_listing_ids`.
- **Client guards:** require ≥2 selected; disable (grey out) listings already in
  another of the user's combos (computed from the loaded combos' member ids,
  excluding the combo being edited); show the backend's 400 message on failure.
- **Lock:** when `event.inputs_locked`, the New-combo button, edit, and delete are
  disabled (combos are read-only once matching starts), mirroring how listing
  add/remove is gated.

### Plan 2a verification (manual QA checklist)
- Create a combo from ≥2 of my listings → appears in "My Combos" with member
  thumbnails and (if priced) the sell price.
- Creating with <2, or selecting a listing already in another combo, is blocked
  (button disabled / 400 surfaced).
- Edit renames / re-selects members; delete (after confirm) removes it.
- After the event moves to MATCHING, combo create/edit/delete controls are
  disabled.
- `npm run build` and `npm run lint` clean.

## Plan 2b — Combos in the trade builders

### `api/trades.ts` extensions

- `WantGroupItemPayload`: add `combo?: number` (and keep `event_listing?`
  optional — exactly one is sent).
- `WantGroupItem` (read): add `combo: number | null`, `combo_code: string | null`,
  `combo_name: string | null`.
- `OfferGroupPayload`: add `item_combo_ids?: number[]`.
- `OfferGroupItem` (read): add `combo`, `combo_code`, `combo_name`.
- `WantBidPayload`: add `combo?: number`; `deleteWantBid` target accepts
  `{ combo: number }`.
- `WantBid` (read): add `combo: number | null`.

### Visual builder (`MyWantsPage`)

The grid groups others' listings by canonical game. Add active combos as targets:

- Load combos via `useCombos(slug)` (all active). For each combo, surface it as a
  target **under every member game** it contains, excluding the current user's
  own combos.
- Target key `K:<comboId>` (alongside the existing `L:<listingId>` keys). A combo
  shown under multiple member games is one logical target — toggling it from any
  member game adds/removes the single `WantGroupItem.combo`.
- The combo chip is visually distinguished (e.g. a "combo" badge + member count)
  from a single copy.
- Persistence reuses the existing per-listing WantGroup flow: a combo target
  becomes a `WantGroupItem` with `combo` set instead of `event_listing`.
- **Money mode:** the combo target exposes a bid input (like listing targets);
  saving writes `WantBid.combo`, clearing calls `deleteWantBid({ combo })`. The
  resolved bid for a combo comes from `WantGroupItem.resolved_bid` (already
  wired server-side).

### Advanced builder (`WantListBuilderPage`)

- `OfferGroupForm`: add a combo multi-select beside the listing select; submit
  includes `item_combo_ids`. `OfferGroupCard`/item rows render combo items
  (combo_name + member count) distinctly from listings.
- Want-group editor: allow adding combo targets (combo picker); item rows render
  combos.
- `WishCard`: render combo offer/want items (combo_name) so a wish that
  involves a combo is legible.

### Backend addition (deferred bit, in 2b)

`WantBidView.delete` (`backend/trades/views.py`) currently requires
`?event_listing=`. Extend it to also accept `?combo=<id>` and delete the matching
combo bid (mirrors the `put` branch added in the backend plan). Small, with a
serializer/endpoint test in `backend/trades/test_combos.py`.

### Plan 2b verification (manual QA checklist)
- A combo created by user A shows under each of its member games in B's visual
  builder, badged as a combo; not shown to A (own).
- B wants the combo → a `WantGroupItem` with `combo` set is created; toggling it
  off removes it; toggling under a different member game reflects the same state.
- Money mode: B sets a combo bid → `WantBid.combo`; clearing deletes it.
- Advanced builder: A offers the combo (`item_combo_ids`); B adds the combo as a
  want target; wish rows render combos.
- `npm run build` and `npm run lint` clean; backend `trades.test_combos` passes
  (combo-bid delete).

## Files

**Plan 2a:** `frontend/src/api/combos.ts` (new); `frontend/src/features/events/EventDetailPage.tsx`.

**Plan 2b:** `frontend/src/api/trades.ts`; `frontend/src/features/trades/MyWantsPage.tsx`;
`frontend/src/features/trades/WantListBuilderPage.tsx`; `backend/trades/views.py`;
`backend/trades/test_combos.py`.

## Out of scope

- Rework of the listing section layout (#4 visual wantlist builder is a separate
  item).
- Rejecting a want that targets the user's own combo at creation time (kept as
  the export-time `_expand` filter, consistent with own-listing wants).
- Combo participation in match-result / shipping views beyond what the existing
  per-assignment rendering already shows (combo assignments render via the
  existing TradeAssignment surfaces).
