# Combos — Design

## Summary

Add **Combos**: a user-defined bundle of ≥2 of their own `EventListing`s in an
event, traded as a single unit. A combo appears as an additional tradeable item
under each of its member games when browsing, so it can be traded whole *or* its
members traded standalone — never the same physical copy twice. The "never
twice" guarantee uses the solver's `givecap` directive (feature #1).

Combos are a first-class tradeable, **not** a synthetic `Copy`: they have their
own model and solver token. Cash is supported in v1 — a combo can carry a bundle
sell price and receive bids.

**Repos:** Emporium only (the solver already supports `givecap`).

**Implementation:** two plans — (1) backend engine, (2) frontend.

## Background

The X-to-Y trade model: a user's copy barters only if its owner offers it
(give side of a `TradeWish`'s `OfferGroup`) **and** someone wants it (take side
of another wish's `WantGroup`); cash sales are passive (a bid clearing an ask).
Every solver token is `Copy.listing_code`; `giver`/`receiver` are resolved from
listing ownership. A combo spans multiple games and is not a physical copy, so it
needs its own token and explicit offer/want/bid plumbing.

`givecap <user> <N> <items>` (solver) caps how many of the listed copies a user
gives (swap supply + cash sale) at N. For a combo `K` of members `A`, `B`:
`givecap u 1 A K` and `givecap u 1 B K` make each physical member leave at most
once — standalone or inside the combo.

## Data model (`events` app, beside `EventListing`)

```python
class Combo(models.Model):
    event       = FK(TradeEvent, related_name="combos", on_delete=CASCADE)
    owner       = FK(AUTH_USER_MODEL, related_name="combos", on_delete=CASCADE)
    name        = CharField(max_length=120)
    combo_code  = CharField(max_length=12, unique=True, db_index=True)  # "K-XXXXXX"
    active      = BooleanField(default=True)
    sell_price  = DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created, updated
```

`combo_code` is generated server-side exactly like `Copy.listing_code` but with
prefix `"K-"` (copies use `"C-"`); collision-retry loop, raise `IntegrityError`
after `MAX_CODE_RETRIES`. `sell_price` null = barter-only (no per-game fallback —
a combo has no single game).

```python
class ComboItem(models.Model):
    combo          = FK(Combo, related_name="items", on_delete=CASCADE)
    event_listing  = FK(EventListing, related_name="combo_memberships", on_delete=CASCADE)
    class Meta:
        unique_together = [("combo", "event_listing")]
```

### Combo validation (serializer)

- **≥2** members.
- Every member listing is owned by `owner` and belongs to `event` (mirror
  `OfferGroupSerializer._resolve_listings`).
- Each member listing appears in **≤1 combo** of that owner: on create/update,
  reject any member already in another `Combo` (same owner, this event).
- Blocked when `event.inputs_locked` (read-only once matching starts).
- `sell_price`, if given, > 0.

## Offer / want / bid targeting (`trades` app)

Add a nullable `combo` FK to **`OfferGroupItem`**, **`WantGroupItem`**, and
**`WantBid`**; make their existing `event_listing` FK nullable. Enforce **exactly
one** of `{event_listing, combo}` is set per row, via:

```python
class Meta:
    constraints = [
        models.CheckConstraint(
            check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True)  & Q(combo__isnull=False)),
            name="<table>_exactly_one_target",
        ),
    ]
```

`combo` FK uses `on_delete=CASCADE`. `OfferGroupItem`/`WantBid` `unique_together`
gain combo variants where present (e.g. `WantBid` becomes unique per
`(user, event, event_listing)` **or** `(user, event, combo)` — enforced as two
partial unique constraints).

Serializers accept either `event_listing` (int) **or** `combo` (int) on write,
validate exactly-one, and on read expose combo identity companions
(`combo_code`, `combo_name`, and the member games for grouping). The combo's
event/owner must match the surrounding group's event; a want item may not target
the wisher's own combo.

This is the only change to the offer/want/wish machinery — combos flow through
the existing `OfferGroup → TradeWish → WantGroup` structures.

## Pricing (`trades/pricing.py`)

`resolve_ask` and `resolve_bid` accept combo targets:

- Combo **ask** = `combo.sell_price` (no fallback). Used by export `item … ask`.
- Combo **bid** = `WantBid(user, event, combo).amount` (no fallback). Used by
  export `bid` lines.

`load_bids` is extended (or a parallel `load_combo_bids`) to preload
`(user_id, combo_id) -> amount` for bulk export. A want item targeting a combo
resolves its bid via the combo branch.

## Solver export (`external_solver.py`)

`_listing_index` gains a combo index: active `Combo`s of the event with members
prefetched, keyed `combo_code -> combo` and `combo.id -> combo`.

1. **Money directives** (`_build_xtoy_money_directives`):
   - `item <combo_code> owner <username>` for every active combo, `+ ask <cents>`
     when `sell_price` set.
   - `bid <username> <combo_code> <cents>` per user who wants the combo with a
     resolved combo bid.
2. **Body** (`_build_xtoy`):
   - Give side: an `OfferGroupItem` with a combo target contributes `combo_code`.
   - Take side: `_expand` yields `combo_code` for combo want-targets, excluding
     the wisher's own combos and combos owned by a blocked user.
3. **givecap**: after the wish lines, for each active combo emit one
   `givecap <owner_username> 1 <member_listing_code> <combo_code>` per member.
4. **dup/takecap**: the existing `dupcap` grouping (by `board_game_id`) skips
   combo take-targets — combos have no single game. Cross-combo / combo-vs-
   standalone duplicate protection is **out of scope** (see below).

## Solver load (`load_solution`)

`TradeAssignment` gains a nullable `combo` FK; `event_listing` becomes nullable;
exactly-one check constraint (same shape as above).

Token resolution (`parse_gurobi` edges and cash moves) resolves a `combo_code`
to its `Combo`:

- A combo barter/cash move becomes **one** `TradeAssignment` with `combo` set,
  `event_listing` null, `giver = combo.owner`, `receiver` = the taker, carrying
  the combo cash on `cash_amount`/`item_value` (combo ask). One `Shipment` per
  combo move — the bundle ships as a single package.
- Listing moves are unchanged (one assignment per listing).

The money reconstruction / settlement cross-check treats the combo assignment's
`item_value` like any other (received − given per user).

Result JSON `cycles[].steps[]` for a combo step carries `combo_code`,
`combo_name`, and the member `listing_code`s/game names (so the UI can show what
physically moves), with `listing_code` null for that step.

## Browse (`events/views.py`)

New `GET /api/events/{slug}/combos/` returns active combos with members
(`combo_code`, `name`, `owner_username`, `sell_price`, and per member:
`event_listing` id, `listing_code`, `board_game_id`, `board_game_name`,
`board_game_thumbnail`). The frontend surfaces each combo under **every** member
game in the browse view.

Combo CRUD lives under `GET/POST /api/events/{slug}/combos/` and
`PATCH/DELETE /api/events/{slug}/combos/{id}/` (owner-only writes, blocked when
`inputs_locked`), mirroring the listings endpoints.

## Frontend (Plan 2)

- **Combo builder** in the listing section: select ≥2 of your own event
  listings, name the combo, set an optional bundle `sell_price`. Enforces the
  "a listing is in at most one combo" rule in the UI.
- **Browse**: a combo shows as an item belonging to its owner under each member
  game (alongside that owner's standalone copy).
- **Want**: a combo is addable to a want group (`WantGroupItem.combo`), with an
  optional bid (`WantBid.combo`) when money is enabled.
- **Offer**: a combo is selectable as an offer-group item in the advanced
  builder (`OfferGroupItem.combo`).

## Testing

**Backend (Plan 1):**
- Model/serializer: combo create rejects <2 members, non-owned members, members
  already in another combo; create blocked when `inputs_locked`; exactly-one
  target enforced on offer/want/bid rows.
- Export: combo emits `item`/`ask`/`bid` lines; `givecap <owner> 1 <member>
  <combo>` per member; combo appears in give/take where offered/wanted; own/
  blocked combos excluded from `_expand`.
- Solver round-trip (the solver subprocess, as `test_event_cycle_qa.py` does):
  a combo {A,B} that trades does **not** also trade A or B standalone (givecap
  holds); a combo move loads as one `TradeAssignment(combo=…)` with one shipment.
- Load: combo `item_value` flows into the money reconstruction/settlement.

**Frontend (Plan 2):** component/integration tests for the builder validation
and the browse surfacing under each member game.

## Files (Plan 1)

- `events/models.py` — `Combo`, `ComboItem`.
- `events/serializers.py` — combo serializers (read members + write validation).
- `events/views.py` — combos list/create/detail + browse endpoint.
- `events/urls.py` — routes.
- `trades/models.py` — `combo` FK + nullable `event_listing` + check constraints
  on `OfferGroupItem`, `WantGroupItem`, `WantBid`.
- `trades/serializers.py` — accept/expose combo targets; exactly-one validation.
- `trades/pricing.py` — combo ask/bid branches.
- `matching/external_solver.py` — combo index, item/bid/give/take, `givecap`,
  combo move → `TradeAssignment(combo=…)`.
- `matching/models.py` — `combo` FK + nullable `event_listing` + check constraint
  on `TradeAssignment`.
- migrations across `events`, `trades`, `matching`.

## Out of scope (v1)

- Duplicate protection spanning a combo and standalone copies of its member
  games (a wisher could receive both a Wingspan combo and a standalone Wingspan).
- Copy status / ownership transfer on event finalize — feature #11.
- Nested combos (a combo containing a combo).
