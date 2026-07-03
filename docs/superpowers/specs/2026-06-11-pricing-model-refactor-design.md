# Pricing Model Refactor — Design

**Date:** 2026-06-11
**Status:** Approved (design); implementation plan pending
**Scope item:** #2 from the 2026-06-11 manual-review backlog

## Problem

Money prices currently live on the X-to-Y group rows:

- `OfferGroupItem.money_amount` — the sell ask (Q), per `(offer_group, event_listing)`.
- `WantGroupItem.money_amount` — the buy bid (P), per want item.

A single copy can belong to multiple `OfferGroup`s, and a single game can be
wanted across multiple `WantGroup`s, so the price is duplicated and can conflict.
The solver export papers over this: ask = `min(money_amount)` across a listing's
`OfferGroupItem`s; bid = per-`WantGroupItem`, deduped to `max` per `(user, code)`
(`backend/matching/external_solver.py`). The price a user wants is conceptually
**one number per copy** (sell) and **one number per wanted game** (buy), not per
group membership.

Users also have no easy place to set/see prices. Most users want to set one price
per game and have it apply to every copy — entered in the Catalog (game-browse)
view.

## Decisions (from brainstorming)

1. **Catalog price = stored per-game default**, not a one-shot bulk write. Saved
   per user, per event, per game; auto-applies to current and future copies/wants
   unless a specific copy/want overrides it.
2. **Buy side keeps a per-want override** on top of the per-game default (for the
   advanced X-to-Y builder).
3. `UserGamePrice` is **event-scoped** (matches `money_enabled` and per-event
   budgets).
4. Catalog edits the **default only**; existing per-copy/per-want overrides
   persist (override wins). "Applies to every copy" holds for the common case
   where copies carry no override. No "wipe overrides" action in v1.
5. Per-copy **barter-only opt-out** while a game default exists (a sentinel
   value) is **out of scope** for v1.
6. DB reset on migration is acceptable (non-released project).

## Data model

Three storage points, two resolution chains.

### New model `UserGamePrice` (canonical per-game price; defaults both sides)

| field | type |
|---|---|
| `user` | FK `AUTH_USER_MODEL` |
| `event` | FK `events.TradeEvent` |
| `board_game` | FK `catalog.BoardGame` |
| `price` | `DecimalField(max_digits=10, decimal_places=2)` |

- `unique_together = (user, event, board_game)`

### `EventListing.sell_price` (per-copy sell override)

- `DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)`
- `null` = no per-copy override (fall through to the game default).

### New model `WantBid` (per-target bid override; mirrors `WantGroupItem` shape)

| field | type |
|---|---|
| `user` | FK `AUTH_USER_MODEL` |
| `event` | FK `events.TradeEvent` |
| `target_type` | `BOARD_GAME` \| `LISTING` |
| `board_game` | FK `catalog.BoardGame`, null |
| `event_listing` | FK `events.EventListing`, null |
| `amount` | `DecimalField(max_digits=10, decimal_places=2)` |

- `unique_together = (user, event, board_game)` and `(user, event, event_listing)`.
- `clean()`: exactly one of `board_game` / `event_listing` set, matching
  `target_type` (same validation pattern as `WantGroupItem.clean`).

### Resolution (`backend/trades/pricing.py`)

```
resolve_ask(event_listing) =          # the copy's listing in THIS event
    event_listing.sell_price           # per-copy override
    ?? UserGamePrice(owner, event, game)  # game default
    ?? None                            # None => barter-only (no ask line)

resolve_bid(user, event, target) =
    WantBid(user, event, target)       # per-want override
    ?? UserGamePrice(user, event, target.board_game)  # game default
    ?? None                            # None => no bid
```

`event_listing` carries both the copy (`owner`, `board_game`) and the `event`, so
the ask resolution is unambiguously event-scoped.

`target.board_game` for a `LISTING` target is `event_listing.copy.board_game`.

### Migration

- Remove `OfferGroupItem.money_amount` and `WantGroupItem.money_amount`.
- Add `UserGamePrice`, `WantBid`, `EventListing.sell_price`.
- DB reset + reseed (no data migration).

## API

- **EventListing write path** (events app): the listing's owner may PATCH
  `sell_price`. Reject writes from non-owners.
- **`UserGamePrice` upsert:** `PUT /events/{slug}/game-prices/` with
  `{board_game, price}`, scoped to `request.user`. Idempotent upsert on the
  unique key.
- **`WantBid` upsert:** keyed by target (`board_game` or `event_listing`),
  scoped to `request.user`.
- **Reads:** the My Listings, Catalog game-view, and builder list endpoints
  return the **resolved** ask/bid plus an `is_override` flag, so the UI can show
  the effective price and whether it comes from a per-copy/per-want override or
  the game default.

## Solver export (`backend/matching/external_solver.py`)

- `item <code> owner <user> [ask <cents>]` — ask from `resolve_ask(copy)`,
  replacing the `min(OfferGroupItem.money_amount)` query.
- `bid <user> <code> <cents>` — from `resolve_bid(target)`, kept deduped to the
  `max` per `(user, code)` as today.
- `_build_placeholder_header` MONEY-WANT / MONEY-OFFER comment lines use the
  resolved values.

## Frontend

- **My Listings in This Event** (`EventDetailPage` / `HomePage`): a per-copy
  `sell_price` input column.
- **Catalog** (`MyWantsPage` + catalog game detail): one per-game price field
  bound to `UserGamePrice`. Reuse the existing `baseMoneyByGame` plumbing in
  `MyWantsPage`; extend it to the sell side and persist server-side.
- **Advanced X-to-Y builder** (`WantListBuilderPage`): Wishes tab gets a
  per-target bid input bound to `WantBid`. The OfferGroup per-item price input is
  **removed**; show the read-only resolved sell price instead.

## Testing

- BE unit: `resolve_ask` / `resolve_bid` chains (override > default > none);
  upsert serializers; uniqueness constraints; non-owner write rejection.
- Rewrite `backend/matching/test_external_solver.py` money cases — they currently
  assert on `money_amount` and must move to the new model.

## Out of scope (v1)

- Multi-currency.
- Per-copy barter-only opt-out via sentinel.
- Asymmetric default spread (separate sell/buy defaults per game).
- "Apply to all copies, wiping overrides" action.
