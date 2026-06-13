# Duplicate Protection via Dummy Nodes — Design

**Date:** 2026-06-13
**Status:** Approved
**Scope:** `backend/matching/external_solver.py` export side (`build_wants` / `_build_xtoy`) + its tests.

## Problem

Duplicate protection is currently expressed as an inline `DUP-PROTECT` tag on a
wish line:

```
alice DUP-PROTECT : (1for1) WINGSPAN MONOPOLY -> CATAN_A CATAN_B
```

The tag delegates the "no two copies of the same game" rule to a special
solver-side constraint. This is the wrong layer. The intent — a user wants
*one* CATAN, and `CATAN_A` / `CATAN_B` are interchangeable ways to satisfy it —
is naturally expressed in the trade graph itself, not as a flag the solver must
interpret.

## Solution: structural dummy nodes

For a duplicate-protected WantGroup, route the acceptable copies of a game
through a single synthetic **dummy node** instead of listing them directly as
the take set. The give-side items point at the dummy; the dummy points at the
real copies. Because a dummy is one node, it can participate in only one trade
chain, so at most one copy of that game flows to the user — duplicate protection
falls out of the graph structure.

```
alice : (1for1) WINGSPAN MONOPOLY -> __DUMMY_42_17
alice : (1for1) __DUMMY_42_17 -> CATAN_A CATAN_B
```

### Dummy marker convention

Dummies are identified purely by a reserved **code prefix**: `__DUMMY`. No
per-line keyword, no declaration directive. Both legs use the wisher's username
normally. Real listing codes are `C-XXXXXX`, so there is no collision risk.

The (future, out-of-scope) external solver will splice any `__DUMMY*` item out
of its output chains. This design only produces the dummy export.

### Dummy code format

```
__DUMMY_<wantgroup_id>_<board_game_id>
```

Deterministic and unique per `(want_group, board_game)`. Stable across repeated
exports of the same data.

## `_build_xtoy` transform

Per active wish (after computing give codes and the expanded take codes,
excluding give codes — unchanged from today):

1. `if not give or not take: continue` — unchanged.
2. **`duplicate_protection == False`** → emit a plain line:
   `username : (NforM) give -> take`. The `DUP-PROTECT` tag is removed entirely.
3. **`duplicate_protection == True`** → group the expanded take codes by
   `board_game_id` (looked up via `by_code[code].copy.board_game_id`):
   - A game with **≥2** copies → mint its dummy code, place the dummy token in
     the main line's take set, and record a dummy leg:
     `username : (1for1) __DUMMY_<wantgroup_id>_<board_game_id> -> <sorted copies of that game>`.
   - A game with exactly **1** copy → keep the real code in the take set
     (passes through, no dummy — a single copy cannot duplicate).
   - Emit the main line:
     `username : (NforM) give -> <sorted dummy tokens + singleton codes>`,
     where `N = offer_group.max_give`, `M = want_group.min_receive` (verbatim).

### Bounds

- Main line: `(max_give for min_receive)` — unchanged from today.
- Dummy legs: always `(1for1)` — one slot, one copy.

`min_receive` is emitted verbatim. If it exceeds the number of take tokens after
dummy collapse, the wish is infeasible; that is the solver's concern, not the
exporter's.

### Dedup of dummy legs

A WantGroup may be referenced by more than one wish (multiple offer groups
wanting the same game). All such wishes funnel into the *same* dummy code, which
correctly enforces "at most one copy across all of them." The dummy leg line
must therefore be emitted **once**. Collect dummy legs in a dict keyed by dummy
code; emit unique legs after all main lines, sorted by code, for deterministic
output.

## Output ordering

- Main wish lines in wish-iteration order (unchanged).
- Unique dummy legs appended after, sorted by dummy code.

## Signature change

`_build_xtoy` gains a `by_code` parameter (already constructed in
`build_wants`), needed to map an expanded take code back to its `board_game_id`.

## Out of scope / untouched

- `load_solution`, the gurobi parsers, and the money directives
  (`_build_xtoy_money_directives`). `bid` lines still target real copy codes,
  which remain present in the dummy leg's take list — bids need no change.
- The external solver's dummy-splicing logic (future, separate project). Running
  the *current* (un-updated) solver against dummy export will not trade
  correctly until that work lands. Accepted: this feature is mid-migration.

## Tests — rewrite `DupProtectExportTests`

Remove the `DUP-PROTECT` tag assertions. Add:

1. **Multi-copy game** → main line contains the `__DUMMY_<wantgroup_id>_<board_game_id>` token; a
   `(1for1) __DUMMY... -> <copies>` leg is present listing the real copies.
2. **Single-copy game** → real code passes through, no `__DUMMY` emitted.
3. **Shared WantGroup across wishes** → exactly one dummy leg line for the
   shared dummy code.
4. **Disabled** (`duplicate_protection == False`) → no `__DUMMY` anywhere.
5. **Parser safety** → `parse_gurobi(build_wants(...)) == []` still holds (no
   `Trade Results:` header in export, so no false edges).

## Success criteria

- `_build_xtoy` emits dummy pairs for ≥2-copy games in dup-protected groups,
  plain pass-through otherwise; no `DUP-PROTECT` tag anywhere in the codebase.
- Rewritten `DupProtectExportTests` pass; full backend suite stays green.
