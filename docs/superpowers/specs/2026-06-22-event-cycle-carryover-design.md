# Event-Cycle Carryover (#11) — Design

## Summary

Two additions that ease participating in repeated (e.g. monthly) events:

- **Part A — Carryover (automatic):** when an event is archived, the items that
  actually traded change status (giver's `Copy` → `TRADED`, unusable next event)
  and each received item appears in the receiver's library as a **fresh `Copy`**.
- **Part B — Import (user-triggered):** a user can import their **wants** (by
  canonical game) and **per-game prices** from a previous event into a new one,
  best-effort.

**Repo:** Emporium. **Implementation:** two plans — 11a (carryover backend), 11b
(import backend + a small frontend control).

## Background

- The transition action (`events/views.py`) only sets `event.status` and notifies;
  **no copy-status or ownership logic exists today**. `Copy.Status.TRADED` is
  defined but never set.
- A DONE `MatchRun` holds `TradeAssignment`s (`giver`/`receiver`, plus either
  `event_listing` or `combo`); `matching/services.py` lazily builds shipments and
  settlement payments. The accepted result for an event is its latest DONE run.
- Wants are listing-targeted (`WantGroupItem.event_listing`/`combo`, each carrying
  the canonical `board_game_id`). Prices: `UserGamePrice` (per-game default for
  both ask and bid) + per-copy overrides (`EventListing.sell_price`, `WantBid`).
- Lifecycle: `… → FINALIZATION → SHIPPING → ARCHIVED` (terminal).

## Part A — Carryover

### Trigger

In `TradeEventViewSet.transition`, when `target == ARCHIVED` (terminal, runs once),
after the status save call `apply_carryover(event)`. Wrap in a `try/except` that
logs and swallows errors so a carryover hiccup never blocks archiving; the
operation is idempotent, so a later manual re-invoke is safe.

### `apply_carryover(event)` (new, `matching/services.py`)

- New field **`MatchRun.carried_over`** (`BooleanField(default=False)`) as the
  idempotency guard.
- Resolve the **latest DONE `MatchRun`** for the event (`status=DONE`, ordered
  `-created`). If none, or `run.carried_over` is True, no-op.
- For each `TradeAssignment` of that run:
  - **moved copies** = if `event_listing_id` set → `[event_listing.copy]`; if
    `combo_id` set → `[ci.event_listing.copy for ci in combo.items.all()]`.
  - For each moved copy:
    - set `copy.status = Copy.Status.TRADED` (skip if already TRADED — defensive).
    - create a fresh `Copy`: `owner=assignment.receiver`,
      `board_game=copy.board_game`, `version=copy.version`,
      `condition=copy.condition`, `language=copy.language`,
      `status=Copy.Status.ACTIVE`, `import_source="carryover"`
      (auto-generated `listing_code`).
  - Wrap the whole pass in a `transaction.atomic`; set `run.carried_over = True`
    at the end.

### "Traded copies can't be used"

`_listings_create` (`events/views.py`) rejects entering a copy whose
`status != Copy.Status.ACTIVE` (a `TRADED`/`WITHDRAWN`/`RESERVED` copy can't be
listed in a new event; fresh carried-over copies are `ACTIVE` → listable). Returns
400 with a clear message.

## Part B — Import wants + prices

### `import_user_trades(user, source_event, target_event)` (new, `trades` service)

Returns a small summary dict `{"prices": n, "want_groups": m}`.

- **Per-game prices:** for each `UserGamePrice(user, source_event, game)`,
  `update_or_create` a `UserGamePrice(user, target_event, game, price)`. Counts
  toward `prices`. (Covers default ask and bid.)
- **Wants by game** — only if the user has **zero** `WantGroup`s in the target
  event (dedup guard against re-import). For each source `WantGroup`:
  - canonical games wanted = `{item.board_game_id for item in wg.items}` (listing
    and combo items expose `board_game_id`; combo items may be null → skipped).
  - target items = active `EventListing`s in `target_event` of those games, owned
    by someone other than the user (best-effort; mirrors `_expand`'s exclusions).
  - if no target items resolve, skip that group.
  - else create a `WantGroup(name, min_receive, duplicate_protection)` + its
    `WantGroupItem`s pointing at the resolved target listings. Counts toward
    `want_groups`.
- Offers, wishes, and per-copy overrides (`sell_price`, `WantBid`) are **not**
  imported (they reference gone copies / not-yet-created new listings).

### Endpoint

`POST /api/events/{target_slug}/import-trades/` body `{"from_event": "<source_slug>"}`.
- Auth required; the user must have an `EventParticipation` in **both** events.
- Target must not be `inputs_locked` (else 403).
- `from_event` must resolve to a different event the user joined (else 400).
- Returns the summary dict.

Mounted in `trades/urls.py` (event-scoped, alongside the other trade routes).

### Frontend

On `EventDetailPage` (near the want-list / "My Listings" area, when the event is
not locked and the user is a participant): an **"Import from a previous event"**
control — a `<select>` of the user's other joined events (from `useEvents` /
participation) + an **Import** button calling the endpoint. On success show a
toast/inline summary ("Imported N prices and M want groups"); on error surface the
message. New `importTrades(targetSlug, fromSlug)` in `api/trades.ts` + a hook.

## Testing

**Plan 11a (carryover):**
- A DONE run with a listing assignment → on archive, giver's copy is `TRADED` and
  a fresh `ACTIVE` copy owned by the receiver exists (same board_game).
- A combo assignment → every member copy `TRADED` + a fresh copy per member for
  the receiver.
- Idempotent: archiving / re-invoking doesn't double-mint (guarded by
  `carried_over`).
- Listing a `TRADED` copy into another event → 400.

**Plan 11b (import):**
- Per-game prices copied into the target (update_or_create; existing updated).
- Want groups re-created targeting the same games' target listings; games with no
  target listing skipped; want-import skipped when the user already has want
  groups in the target.
- Endpoint guards: non-participant → 403/400; locked target → 403; same-event /
  unknown from_event → 400.
- Frontend: typecheck + lint + manual checklist.

## Files

**Plan 11a:** `backend/matching/models.py` (+`carried_over`),
`backend/matching/services.py` (+`apply_carryover`), `backend/events/views.py`
(transition hook + listing-status guard), `backend/matching/test_carryover.py`,
migration.

**Plan 11b:** `backend/trades/services.py` (new, `import_user_trades`),
`backend/trades/views.py` (+import endpoint), `backend/trades/urls.py`,
`backend/trades/test_import.py`, `frontend/src/api/trades.ts` (+`importTrades`),
`frontend/src/features/events/EventDetailPage.tsx` (import control).

## Out of scope

- Importing per-copy `sell_price`/`WantBid` overrides (the referenced copies are
  gone).
- Importing offer groups / wishes (depend on the user's new listings).
- Per-shipment carryover (the whole accepted run is carried over at archive,
  regardless of individual shipment confirmation).
- Auto-listing the user's fresh carried-over copies into a new event.
