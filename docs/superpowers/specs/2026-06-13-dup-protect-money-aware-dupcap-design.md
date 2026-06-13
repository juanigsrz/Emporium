# Money-Aware Duplicate Protection via `dupcap` — Design

**Date:** 2026-06-13
**Status:** Approved
**Supersedes:** the dummy-node approach in `2026-06-13-dup-protect-dummy-nodes-design.md` (retired).
**Scope:** two repos —
- `FastTradeMaximizer/main.py` (gurobi-experimental): parse a new `dupcap` directive + add one MIP constraint.
- `mathtrade-app/backend/matching/external_solver.py`: stop emitting `__DUMMY` nodes; emit `dupcap` directives instead.

## Problem

Duplicate protection was implemented as structural `__DUMMY` swap nodes: a user's
acceptable copies of a game route through one node, so at most one copy can flow
through a single swap chain. This works for **barter** but **leaks through money**.

Cash purchases ride a `buy[(u, i)]` variable on the **real** copy
(`main.py:178, :192`), and bids/asks target real copies — none of that touches
the dummy's single slot. So a user can buy both copies, or swap one (via the
dummy) and buy the other. Duplicate protection holds for swaps, not for cash.

"Bid on the dummy" doesn't rescue it: pricing is pay-the-ask, which needs one
concrete ask, but a dummy aggregates copies with different owners and asks.

## Key finding: the needed handles already exist

Reading `main.py` (gurobi-experimental):

- **`spend_swap[user]`** (`main.py:130` for 1-to-1, `:145` for N-to-M combos) is a
  list of `(received_item_id, var)` — the per-`(user, copy)` **swap-receive**
  indicator.
- **`buy[(u, iid)]`** (`main.py:178`, `:192`) is the per-`(user, copy)` **cash-buy**
  indicator (including the implicit buy for wish take-items).
- **`out_terms[i]`** are the swap edges by which copy `i` leaves its owner. The
  seller-side single-slot constraint at `main.py:213`,
  `sum(outs) + sum(buy_terms[node]) <= 1`, already guarantees each physical copy
  reaches exactly one destination.

Duplicate protection is the **demand-side mirror** of `main.py:213`, expressed
over variables that already exist.

## Solution: `dupcap` — a receiver-side capacity constraint

### Input directive

```
dupcap <username> <item> <item> ...
```

Declares: this user receives **at most one** of these copies in total, counting
swaps and cash buys together. Emitted once per protected `(user, canonical game)`.

### Solver change (`FastTradeMaximizer/main.py`)

1. **Parse** (in `parse_file`, alongside the `m_user`/`m_item`/`m_bid` branches,
   ~line 68-96). Add a module-global `dup_groups = []` near the other globals
   (~line 16), and:

   ```python
   m_dup = re.fullmatch(r'dupcap\s+(\S+)\s+(.+)', line)
   ```

   handled before the `elif ':' in line` wish branch:

   ```python
   elif m_dup:
       u = m_dup.group(1)
       users.add(u)
       dup_groups.append((u, [intern(t) for t in m_dup.group(2).split()]))
   ```

2. **Constrain** — after `buy` is fully built (~after `main.py:196`):

   ```python
   # Duplicate protection: a user receives at most one copy of a protected game,
   # counting swap receipts and cash buys together (demand-side mirror of the
   # per-item seller slot at the loop above).
   for u, iids in dup_groups:
       grp = set(iids)
       terms  = [v for (it, v) in spend_swap.get(u, []) if it in grp]
       terms += [buy[(u, it)] for it in grp if (u, it) in buy]
       if len(terms) > 1:
           model.addConstr(gp.quicksum(terms) <= 1)
   ```

   Objective-independent, so it applies under both `--kpi` modes. No change to
   output, settlement, or budgets.

#### Why it's correct

The seller slot (`main.py:213`) already forces each physical copy to one
destination, so no single copy can be counted twice across the summed terms
(`spend_swap` vars for copy `c` are a subset of `out_terms[c]`, and `buy[(u,c)]`
competes in the same `out_terms[c] + buy_terms[c] <= 1` slot). Summing a user's
swap-receive and buy vars across a game's copies and capping at 1 therefore means
"the user receives at most one copy of that game, by any channel." All four cases
(swap+swap, swap+buy, buy+buy) are handled uniformly. Bids/asks stay on the real
copies — the "multiple asks" problem never arises; the cap limits only the count.

### Export change (`mathtrade-app/backend/matching/external_solver.py`)

- **Retire the dummy.** Delete `_dup_protect_take`. In `_build_xtoy`, a
  dup-protected wish emits a plain `username : (NforM) give -> take` line listing
  the **real** copies again (no `__DUMMY` tokens, no dummy legs).
- **Accumulate dup groups** while iterating wishes: for each dup-protected wish,
  group its expanded `take` codes by `by_code[code].copy.board_game_id` into a
  dict keyed by `(username, board_game_id)`. This unions a user's acceptable
  copies of a game across all their dup-protected wishes (same per-(user,game)
  grouping the dummy keying used).
- **Emit** one `dupcap <username> <sorted copies>` line per `(username, game)`
  group that has **≥2** copies (a 1-copy cap is vacuous), after the wish lines,
  sorted by key for deterministic output.
- **Bids/asks unchanged** — `_build_xtoy_money_directives` already emits bids on
  the real copies, which is exactly what the cap now governs.

### Output parsing (`mathtrade-app` `load_solution`)

Unchanged, and simpler: solver output contains no `__DUMMY` tokens, so no splice
step is ever needed.

## Testing

### Export side (`mathtrade-app`, Django) — rewrite `DupProtectExportTests`

- Multi-copy game → a `dupcap <user> <c1> <c2>` line lists both real copies; the
  wish line lists the real copies (assert no `__DUMMY` anywhere in the output).
- Single-copy game → no `dupcap` line for it (vacuous), real copy in `take`.
- Same user, two dup-protected want groups for the same game → exactly one
  `dupcap` line unioning the copies.
- Disabled (`duplicate_protection = False`) → no `dupcap` line.
- `parse_gurobi(build_wants(...)) == []` still holds.
- Update `events/test_event_cycle_qa.py`: assert no `__DUMMY`; assert a `dupcap`
  line exists for the brass game (two copies, wanted by t2) and none for the
  single-copy terra.

### Solver side (`FastTradeMaximizer`) — new `test_dupcap.py`

No test framework exists in the repo; run `main.py` as a subprocess and parse
stdout. Core scenario (buy+buy, the channel the dummy missed):

```
item C1 owner bob ask 10
item C2 owner carol ask 10
bid alice C1 20
bid alice C2 20
```

- **Without** a `dupcap alice C1 C2` line → solver maximizes trades → alice buys
  **both** (2 lines under `Cash Purchases:`). Asserts the test is real.
- **With** `dupcap alice C1 C2` → alice buys **exactly one**.

A second scenario covers swap+buy: alice swaps her offered item for C1 and could
buy C2; with the cap she ends with one copy of the game.

## Success criteria

- `main.py` accepts `dupcap` lines and enforces ≤1 receipt per protected
  (user, game) across swaps and buys; `test_dupcap.py` passes (with-cap = 1,
  without-cap = 2).
- `external_solver.py` emits `dupcap` directives and no `__DUMMY` tokens;
  rewritten `DupProtectExportTests` and the QA cycle test pass; full backend
  suite stays green.
- `_dup_protect_take` is deleted; no `__DUMMY` string remains in either repo.
