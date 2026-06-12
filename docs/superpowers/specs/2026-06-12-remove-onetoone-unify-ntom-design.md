# Remove ONETOONE, unify into N-to-M

**Date:** 2026-06-12
**Status:** Approved

## Goal

Delete the 1-to-1 (`ONETOONE`) trade-type concept entirely. Every event is N-to-M
(formerly `XTOY`). The 1-to-1 case is already solvable by the N-to-M algorithm; any
future 1-to-1 speedup belongs in the solver, not as a user-facing mode.

Removing `ONETOONE` also makes the hosted online ftm solver dead code (it only speaks
the OLWLG / 1-to-1 format), so it is deleted too. `FakeMatcher` is mode-agnostic
(respects `max_give`/`min_receive`, builds 2-/3-cycles) and stays as the offline
greedy matcher used by dev/CI and the backend test suite.

## Decisions

1. **Online ftm solver:** delete entirely (OLWLG export, `call_online_solver`,
   `parse_ftm`, `MATCHING_USE_ONLINE_SOLVER` + `SOLVER_URL`/`SOLVER_TIMEOUT` settings).
2. **`matching_mode` field:** drop the column via migration. Dev DB has 1 `ONETOONE`
   row; safe (dev-only data).
3. **Matching UI:** for every event, show the upload panel (`XToYSolvePanel`, the real
   gurobi N-to-M flow) **and** keep the offline `FakeMatcher` "Run matching" button
   (`TriggerRunButton`) as a quick dev/preview match. The `trigger` endpoint and
   `FakeMatcher` stay either way — ~20 backend tests call them directly.

## Changes

### Backend

**`events/models.py`**
- Delete the `MatchingMode` `TextChoices` class.
- Delete the `matching_mode` field.

**`events/migrations/`**
- New migration: `RemoveField(TradeEvent, "matching_mode")`.

**`events/serializers.py`**
- Remove `"matching_mode"` from `fields`.
- Delete `validate_matching_mode` and `_MODE_FROZEN_STATUSES`.

**`matching/external_solver.py`**
- `build_wants`: drop the `else` (ONETOONE) branch; always build the XTOY/gurobi
  export. Money block always uses `_build_xtoy_money_directives` when `money_enabled`.
- `_build_placeholder_header`: remove the `is_xtoy` distinction. Only the
  `#! DUP-PROTECT` lines remain; delete the ONETOONE-only `#! MONEY-ENABLED`,
  `#! BUDGET`, `#! MONEY-WANT`, `#! MONEY-OFFER` comment-directive plumbing (those
  were the 1-to-1 money path; XTOY money goes through real solver directives).
- Delete `_build_onetoone`, `call_online_solver`, `parse_ftm`, `_FTM_LINE`.
- `load_solution`: drop the `else: parse_ftm` branch (always `parse_gurobi`).
  Unconditionalize the three `if event.matching_mode == XTOY:` guards (cash purchases,
  cash-summary cross-check, settlement plan always run).
- Update the module docstring (no more ONETOONE/OLWLG/online-solver mentions).

**`matching/tasks.py`**
- Remove `use_online` / `MATCHING_USE_ONLINE_SOLVER` branch and the `ftm-online`
  algorithm path. `run_match` always runs `FakeMatcher`.

**`matching/views.py`**
- Remove the `matching_mode == XTOY` rejection guard in the `trigger` action (every
  event is now valid for a server-side FakeMatcher run). Fix the related docstring.

**`bgtrade/settings.py`**
- Delete `SOLVER_URL`, `SOLVER_TIMEOUT`, `MATCHING_USE_ONLINE_SOLVER` and the
  external-solver comment block.

**`events/views.py`**
- Fix the `wants_export` docstring (XTOY/`(NforM)` format only; no ONETOONE/OLWLG).

### Frontend

**`api/events.ts`**
- Delete `MatchingMode` type, `MATCHING_MODE_LABELS`, `MATCHING_MODE_FROZEN_STATUSES`.
- Remove `matching_mode` from the `TradeEvent` interface and the patch payload type.

**`features/events/EventDetailPage.tsx`**
- Delete the `MatchingModeCard` component and its render (line ~963).
- Remove the now-unused imports (`MATCHING_MODE_LABELS`, `MATCHING_MODE_FROZEN_STATUSES`,
  `MatchingMode`).

**`features/matching/MatchRunPage.tsx`**
- Replace the `event.matching_mode === 'XTOY' ? <XToYSolvePanel> : <TriggerRunButton>`
  branch with both rendered for every event: `XToYSolvePanel` (upload, primary) plus
  `TriggerRunButton` (offline FakeMatcher).

**`features/trades/MyWantsPage.tsx`**
- No change. Only comments say "1-to-1"; no functional reference.

### Tests

- `events/tests.py`: delete the `MatchingModeTests` class.
- `events/test_event_cycle_qa.py`: remove the `e["matching_mode"] == "ONETOONE"` assert.
- `matching/test_external_solver.py`, `matching/test_distance_block.py`: delete the
  `matching_mode = XTOY` setup lines and the `matching_mode=XTOY` event-creation kwarg
  (gurobi is now the only export/parse path).
- No new behavior tests: existing gurobi-export, FakeMatcher, and upload tests already
  cover the single unified path.

## Verification

- `cd backend && ./venv/bin/python manage.py makemigrations` produces the
  `RemoveField` migration.
- `cd backend && ./venv/bin/python manage.py test` green.
- Frontend `tsc` / build clean.
- `grep -rniE "ONETOONE|matching_mode|MatchingMode|call_online_solver|parse_ftm|MATCHING_USE_ONLINE"`
  returns only false positives (`OneToOneField` docstrings in `accounts/`, `MyWantsPage`
  comments).

## Out of scope

- No change to money trading, pricing, distance/block logic, settlement, or the gurobi
  solver itself.
- The deployed modal endpoint is not torn down by this change (infra, separate).
