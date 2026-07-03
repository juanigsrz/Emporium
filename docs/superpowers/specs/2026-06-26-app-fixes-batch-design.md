# App fixes batch — design

Date: 2026-06-26

Four independent fixes surfaced by a status review. Each is self-contained; they
share no state and can be implemented and tested separately.

---

## F1 — Event photo field in create/edit forms

**Problem.** `TradeEvent.image_url` exists, is writable in the serializer, and is
rendered on event cards, but neither the create form nor the edit form exposes a
field to set it.

**Change (frontend only).**

- Create form (`frontend/src/features/events/EventsPage.tsx`): add `image_url`
  to `createEventSchema` (optional, URL-shaped, allow empty), render a text
  input, include `values.image_url` in the create payload.
- Edit form (`frontend/src/features/events/EventDetailPage.tsx`): add `image_url`
  to `editEventSchema`, default from `event.image_url`, include in the patch
  payload.
- Show a small inline thumbnail preview when the URL is non-empty.
- URL only, no binary upload (matches the model comment).

No backend or model change.

---

## F2 — Lock submissions at Want-List Open; lock listed copies; combo cascade

Today listings and combos are editable until `inputs_locked` (status `MATCHING`
and later). They must instead lock one phase earlier — at `WANTLIST_OPEN` — so a
participant cannot add/remove submissions once want-lists open. Want-lists
themselves stay editable through `WANTLIST_OPEN` (unchanged).

### Backend

- New computed property `TradeEvent.submissions_locked`:
  `status not in {DRAFT, SUBMISSIONS_OPEN}` (equivalently: locked from
  `WANTLIST_OPEN` onward). Expose read-only on `TradeEventSerializer`.
  `inputs_locked` (wantlists, `MATCHING`+) is unchanged.
- `events/views.py`:
  - `_listings_create`: gate on `submissions_locked` (was `inputs_locked`).
  - `listing_detail` DELETE: gate on `submissions_locked`.
  - `listing_detail` PATCH (`sell_price`): keep on `inputs_locked` — per-listing
    pricing stays editable during the Want-List phase.
- `events/combo_views.py`: `_assert_editable` uses `submissions_locked`. Combo
  create/patch/delete lock at `WANTLIST_OPEN`.
- **Combo cascade.** A shared helper deletes every `Combo` that an
  `EventListing` belongs to when that listing is removed (user delete path in
  `listing_detail` DELETE, and the admin unlist path). The whole combo is
  removed, not merely its `ComboItem`.
- **Copy lock.** `Copy.is_in_active_event` =
  `self.event_listings.filter(active=True).exclude(event__status="ARCHIVED").exists()`.
  `copies/views.py` `update` and `destroy` raise `PermissionDenied` when
  `is_in_active_event`. Both field edits and withdraw/delete are blocked (the
  guard motivates: a participant must not change or withdraw a copy that others
  may have wished for). Archived events do not lock the copy. Expose
  `in_active_event` read-only on `CopySerializer`.

### Frontend

- Add `submissions_locked` to the EventDetail type (`api/events.ts`).
- `EventDetailPage`: add-listing control, unlist control, and `MyCombosSection`
  gate on `submissions_locked` (were `inputs_locked`).
- `MyCopiesPage`: disable Edit and Withdraw when `copy.in_active_event`; show a
  short reason ("Listed in an active event — unlist it first").

### Tests

Extend `events/test_listing_status_guard.py`, `events/test_combos.py`, and the
copies tests:
- Listing create/delete and combo create/delete are blocked at `WANTLIST_OPEN`,
  allowed at `SUBMISSIONS_OPEN`.
- Deleting a listing that is a combo member deletes the whole combo.
- Editing/withdrawing a copy with an active listing returns 403; same copy in an
  archived event is editable.

---

## F3 — Grid ask: show your own item ask in the column header; close the leak

**Problem.** GridMode renders an `ask:` value per want-target row computed from
**other** users' `resolved_ask`. That spoils private seller pricing. The actual
intent was to surface **your own** per-item ask. The leak is also at the API
layer: `EventListingSerializer` serializes `resolved_ask`/`ask_is_override` for
every listing to every authenticated user.

### Backend

- `EventListingSerializer.get_resolved_ask` and `get_ask_is_override` return a
  value only when `context["request"].user` owns the copy; otherwise `null`.

### Frontend (`MyWantsPage` GridMode)

- Remove the extra `useEventListings(slug, { page_size: 500 })` fetch, the
  `askByListing` map, and the per-row `ask:` line.
- Render each of **your** items' ask (`listing.resolved_ask`) at the top of its
  column header.
- Keep the per-row "Default bidding price" input (your own bid).

### Tests

Add/extend a serializer test: `resolved_ask` is present for the owner's own
listing and `null` for another user's listing.

---

## F4 — Catalog view: start-empty wishing + single merged dropdown

**Problem.** Clicking to wish a game auto-checks every owned item as an offer
(`toggleWant`/`toggleCopy` fall back to all `myListings` when none offer yet).
The "items you offer" checklist is hidden unless something already offers the
game, and lives in a panel separate from the Expand dropdown.

### Behavior

- `toggleWant(game)`: stage every other-owned, in-range copy of the game as an
  accepted target, but toggle **no** items. Auto-open the card's Expand
  dropdown so the user immediately ticks which items offer it. (The "already
  wanted → clear all" branch is unchanged.)
- `toggleCopy`/`toggleCombo` (GameCopies): drop the `myListings` fallback —
  `acting = offering` only. Ticking a copy with no offering item stages the copy
  but assigns no cell.
- Merge into one Expand dropdown (delete the separate offering IIFE panel). The
  dropdown, top to bottom:
  1. Add-to-group control (`WantGroupControls`) — unchanged.
  2. **New, always visible:** "Your items that offer this game" — a checklist of
     all `myListings`, empty by default. Each row toggles the game group for
     that listing.
  3. "Copies you'd accept" (`GameCopies`, selectable) — unchanged otherwise.
- **Bootstrap rule.** Ticking an owned item in checklist (2) when no copies are
  staged yet stages "any copy" for that item (fetch the game's other-owned
  copies and turn them on for that one item), reusing the `toggleWant` fetch
  logic. After copies are staged, item ticks toggle the staged copies.

### Persistence / indicators

- A game with staged copies but zero offering items does not persist (existing
  `persistChanges` only writes targets that are on for some listing) — this is
  the intended conscious-add state.
- The "Wanted ✓" / purple-ring indicator stays defined as "at least one of my
  items offers this game."

No backend change.

---

## Out of scope

- No new DB columns: `submissions_locked` and `is_in_active_event` are computed
  properties; no migration.
- No change to the solver, matching, or money-trade resolution logic.
