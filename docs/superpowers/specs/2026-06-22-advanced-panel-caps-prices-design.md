# Advanced Panel: Manual Caps + Per-Copy Bid Tuning (#5) — Design

## Summary

Two additions to the advanced X-to-Y builder (`WantListBuilderPage`):

- **Part A — Manual `takecap`/`givecap` (new):** a user defines their own caps over
  an arbitrary list of items (event listings and/or combos): receive at most N
  (`takecap`) or give at most N (`givecap`). Persisted in a new `TradeCap` model
  and emitted to the solver alongside the existing auto caps.
- **Part B — Per-copy bid tuning (UI surfacing of existing model):** in the
  advanced builder, set your own max **bid** on a specific copy you want,
  overriding your canonical per-game default bid. Buyer-side only — it never
  touches a copy's ask (the owner's price).

**Repo:** Emporium. **Builds on:** merged solver `takecap`/`givecap` (#1) and the
pricing model (`UserGamePrice` default + `WantBid`/`EventListing.sell_price`
overrides). **Implementation:** two plans — 5a (caps backend), 5b (advanced UI).

## Background

The solver accepts `takecap <user> <N> <items>` (receive ≤ N) and
`givecap <user> <N> <items>` (give ≤ N), counting swaps + cash. Today the
exporter only auto-emits caps: `dupcap` (= `takecap … 1`) from
`WantGroup.duplicate_protection`, and `givecap` per combo member. There is no
user-defined cap.

Pricing (`trades/pricing.py`): a copy's **ask** = `EventListing.sell_price` ??
`UserGamePrice(owner, game)` ?? barter. A user's **bid** for a want target =
`WantBid(user, event_listing)` ?? `UserGamePrice(user, game)` ?? none. The
advanced builder's `WantGroupEditor` already writes per-item bids via `setWantBid`
keyed on `event_listing`; `WantGroupItem` already returns `resolved_bid` /
`bid_is_override`. So Part B reuses existing endpoints — it only adds a clearer
dedicated panel.

Offer/want items already use a two-target shape (`event_listing` XOR `combo`,
exactly-one CheckConstraint); caps reuse that shape.

## Part A — Manual caps

### Model (`trades` app)

```python
class TradeCap(models.Model):
    class Kind(models.TextChoices):
        TAKE = "TAKE", "Take (receive at most N)"
        GIVE = "GIVE", "Give (send at most N)"
    event   = FK("events.TradeEvent", related_name="trade_caps", on_delete=CASCADE)
    user    = FK(AUTH_USER_MODEL, related_name="trade_caps", on_delete=CASCADE)
    kind    = CharField(max_length=4, choices=Kind.choices)
    n       = PositiveIntegerField()           # >= 1
    created, updated

class TradeCapItem(models.Model):
    cap            = FK(TradeCap, related_name="items", on_delete=CASCADE)
    event_listing  = FK("events.EventListing", null=True, blank=True, on_delete=CASCADE)
    combo          = FK("events.Combo", null=True, blank=True, on_delete=CASCADE)
    class Meta:
        constraints = [CheckConstraint(  # exactly one target, same shape as offer/want items
            check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True)  & Q(combo__isnull=False)),
            name="capitem_exactly_one_target")]
```

### Validation (serializer)

- `kind` ∈ {TAKE, GIVE}; `n` ≥ 1; ≥ 1 item; every item belongs to this event.
- **GIVE**: every item is owned by the user (`event_listing.copy.owner == user`,
  `combo.owner == user`) — raise otherwise. **TAKE**: any items (no ownership
  requirement).
- Blocked when `event.inputs_locked`; owner-only writes.

### Endpoints (`trades`, nested under the event, mirroring offer-groups)

- `GET/POST /api/events/{slug}/caps/` — list the user's own caps / create.
- `GET/PATCH/DELETE /api/events/{slug}/caps/{id}/` — owner-only, locked-gated.

Serializer read shape per cap: `id, kind, n, items: [{id, event_listing,
listing_code, board_game_name, combo, combo_code, combo_name}], created`. Write:
`kind, n, item_listing_ids[], item_combo_ids[]` (mirrors OfferGroup's id-list
write style).

### Export (`matching/external_solver.build_wants`)

After the existing `dupcap`/combo-`givecap` block, emit one line per active
`TradeCap` for the event:

```
takecap <username> <n> <token...>     # kind == TAKE
givecap <username> <n> <token...>     # kind == GIVE
```

Tokens = each cap item's `listing_code` (active listing) or `combo_code` (active
combo); skip items whose listing/combo isn't in the active export index. Skip a
cap that ends up with no tokens. These are **additive** to the auto caps — the
solver applies every cap constraint; where they overlap, the most restrictive
binds. (No reconciliation logic; that's the user's responsibility.)

## Part B — Per-copy bid tuning (advanced builder)

No backend change. A new **Prices** panel in `WantListBuilderPage`:

- **Per-game default bid:** list/edit the user's `UserGamePrice` rows (the
  canonical per-game price that defaults `resolve_bid`) via existing
  `listGamePrices` / `setGamePrice` / `deleteGamePrice`.
- **Per-copy bid override:** for the copies the user wants (their `WantGroupItem`
  listing targets), show `resolved_bid` (greyed when it's the canonical default,
  i.e. `bid_is_override === false`) and an editable field that writes a
  `WantBid(event_listing)` via `setWantBid`, or clears it via `deleteWantBid`
  (reverting to the canonical default).
- **Never writes an ask.** The panel only touches `WantBid` (buyer-side) and
  `UserGamePrice` (the user's own per-game number). It does not set any
  `EventListing.sell_price` — a wanted copy's ask belongs to its owner.
- Money-enabled events only; hidden otherwise.

## Frontend (advanced builder, `WantListBuilderPage`)

Extend the tab set `'offers' | 'wants' | 'wishes'` with `'caps'` and `'prices'`.

- **Caps panel:** list the user's caps (kind badge, N, item chips — listing
  thumbnails / `🎁` combo chips); create/edit form (kind toggle, N input,
  multi-select of items: for GIVE, the user's own listings + own combos; for
  TAKE, any event listings + combos), delete-with-confirm. New `api/caps.ts`
  client (types + CRUD + react-query hooks, mirroring `api/combos.ts`).
- **Prices panel:** the per-game default + per-copy bid editor described in Part B.

## Testing

**Plan 5a (backend):**
- Model/serializer: create cap (TAKE/GIVE), reject n<1, reject 0 items, reject
  GIVE item not owned by user, exactly-one-target enforced, blocked when locked,
  owner-only.
- Export: a TAKE cap emits `takecap <user> <n> <codes>`; a GIVE cap emits
  `givecap …`; combo items emit `combo_code`; inactive items skipped; empty cap
  skipped; additive to existing auto `dupcap`/combo `givecap`.

**Plan 5b (frontend):** typecheck (`npm run build`) + targeted eslint + a manual
QA checklist (create/edit/delete a cap; set/clear a per-copy bid and confirm it
overrides the canonical default and leaves asks untouched). No test runner is
added.

## Files

**Plan 5a:** `backend/trades/models.py`, `backend/trades/serializers.py`,
`backend/trades/views.py`, `backend/trades/urls.py`,
`backend/matching/external_solver.py`, `backend/trades/test_caps.py`, migration.

**Plan 5b:** `frontend/src/api/caps.ts` (new),
`frontend/src/features/trades/WantListBuilderPage.tsx`.

## Out of scope

- Caps over board-game targets (only specific listings/combos).
- Reconciling user caps that contradict the auto `dupcap`/combo-`givecap`.
- Per-copy **ask** override in the advanced builder (it exists on the event page;
  Part B is bid-only).
