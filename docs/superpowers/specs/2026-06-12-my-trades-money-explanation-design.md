# My Trades — explainable money + settlement

Date: 2026-06-12
Status: Approved (pre-implementation)

## Problem

The "Payments" block in the My Trades tab (`frontend/src/features/matching/MatchRunPage.tsx`,
`MyTradesSection`) is built only from `TradeAssignment.cash_amount`. The backend sets that
field in one place — `parse_gurobi_cash()` reading the solver's `Cash Purchases:` section
(`backend/matching/external_solver.py`). That section lists **only pure cash-for-item buys**.

In money mode the solver charges the item's ask on *every* priced move, including barter
swap legs (`spend_swap` in `FastTradeMaximizer/main.py`). Those swap-leg flows appear in the
solver's `Cash Summary` / `Payments` / `Settlement plan` sections but never in
`Cash Purchases`, so `cash_amount` stays `null` on swap assignments. Result: the FE Payments
block structurally undercounts money whenever a priced item moves via a swap.

Goal: show the user (a) *why* they owe/are owed money — an item-level breakdown tied to their
own wishes — and (b) *what to actually do* — the minimal settlement transfers.

## Key facts that shape the design

- In money mode, for any `TradeAssignment` the receiver "buys" the moved item for
  `resolve_ask(moved_item)` and the giver "sells" it for the same amount — true for swap legs
  and direct cash buys alike (`main.py:227-238`).
- A user's net therefore = Σ(asks of items received) − Σ(asks of items given), which equals
  the solver's `Cash Summary` net **exactly**. So the per-item money breakdown is fully
  reconstructible on the backend from the assignments we already store + `resolve_ask`.
- `resolve_ask(listing)` is deterministic from the DB (`EventListing.sell_price ??
  UserGamePrice`). `build_wants` → solve → `load_solution` run back-to-back inside one
  `run_match` task, so the ask the solver used and the ask at load time are the same.
- The **only** thing not locally reconstructible is the `Settlement plan` (a global greedy
  over everyone's nets; its counterparties are arbitrary by design — see the NOTE at
  `main.py:374-376`). It is already printed by the solver; it just is not parsed yet.

Conclusion (Approach A, chosen over having the solver emit item values): the backend derives
item values from `resolve_ask`; the solver stays as-is; we add a parser for its existing
`Settlement plan` section.

## Backend changes

### 1. Model — `TradeAssignment.item_value`
- New `DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)`.
- Frozen at solve time = `resolve_ask(moved_el)` (dollars) or `null` for unpriced/barter-only.
- This is the money that moves *with the item*, set for both swap legs and direct cash buys.
- `cash_amount` is left untouched (still marks pure cash buys; used by the trade-list cash badge).
- Migration required.

### 2. `external_solver.load_solution` (XTOY money path)
- For every resolved row, compute and store `item_value = resolve_ask(moved_el)`.
- New `parse_gurobi_settlement(output)` — mirrors `parse_gurobi_cash`. Reads the
  `Settlement plan:` section to EOF; each line `  <from> pays <to> $<cents>` →
  `(from_username, to_username, amount_cents)`. Map usernames → users (reuse the existing
  `cash_moves` username-resolution pattern). Store on the result JSON:
  `result["settlement"] = [{"from_user": str, "to_user": str, "amount": "<dollars>"}]`
  (solver amounts are integer cents → divide by 100). Global list, not per-user.
- New `parse_gurobi_cash_summary(output)` — reads the `Cash Summary:` section; each line
  `  <user>: spent $<c>, earned $<c>, net $<c> (...)` → `{username: net_cents}` (net may be
  negative).
- **Validation guard:** reconstruct each user's net from `item_value`
  (Σ received − Σ given, in cents) and assert it equals the parsed `Cash Summary` net.
  On mismatch raise `ValueError` (the run fails loudly in `tasks.run_match` rather than
  shipping wrong money). **A2: hard-fail confirmed.**
- Barter-only runs (no asks / no `Settlement plan` section) skip all of the above:
  `item_value` is `null` everywhere and no `settlement` key is added.

### 3. Serializer
- Add `item_value` to `TradeAssignmentSerializer.fields` (read-only).
- `result["settlement"]` rides along in the existing `MatchRun.result` JSONField served by
  `useMatchResult` — no serializer change needed for settlement.

## Frontend changes

`frontend/src/features/matching/MatchRunPage.tsx`:

- `useMyAssignments` (the `mine/` query) requests `page_size=100` so the net and the itemized
  lists are not truncated at the default 24. (`>100` priced trades per user is out of scope —
  A3.)
- Pass `result.settlement` into `MyTradesSection`.
- Rebuild the Payments block (the trade list above it is unchanged):
  - **Bought** = my received assignments with `item_value != null`
    → "You bought {board_game_name} for ${item_value} from {giver_username}".
  - **Sold** = my given assignments with `item_value != null`
    → "You sold {board_game_name} for ${item_value} to {receiver_username}".
  - **Net** = Σbought − Σsold → "You owe $E" / "You're owed $E" / "Even". This is the *why*.
  - **Settlement** = `result.settlement` filtered to me → for `from_user == me`
    "Pay {to_user} ${amount}"; for `to_user == me` "Receive ${amount} from {from_user}".
    This is the *what to actually do*. Labeled as settlement/how-to-pay, visually separate
    from the item-level breakdown, since its counterparties are not item-traceable (A1).
- `TradeAssignment` TS type gains `item_value: string | null`; a settlement type is added for
  `result.settlement`.

## Testing

- BE: money-mode fixture (solver stdout with swaps + Cash Purchases + Cash Summary +
  Settlement plan) → `item_value` set on swap legs, `result["settlement"]` parsed correctly,
  reconstructed net == Cash Summary net. A deliberately inconsistent fixture → `ValueError`.
- BE: barter-only run → all `item_value` null, no `settlement` key.
- FE: net + settlement render correctly for both a payer and a receiver (lightweight).

## Assumptions / out of scope

- **A1** Settlement counterparties are not item-traceable by design; the UI keeps them
  separate from the item-level "why".
- **A2** Validation mismatch is a hard fail (`raise ValueError`).
- **A3** A user with >100 priced trades truncates the itemized list; net stays correct only
  while all rows are present. Accepted as out of scope.
