# Remove ONETOONE, unify into N-to-M — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the user-facing 1-to-1 (`ONETOONE`) trade-type concept and the dead hosted online ftm solver; every event becomes N-to-M (the former `XTOY`).

**Architecture:** This is a deletion/refactor, not greenfield — there is no new behavior to TDD. The existing test suite is the verification gate: each task makes a coherent set of edits (production code + the tests that reference the removed surface) and must leave `manage.py test` green. Tasks are ordered so the field removal lands last, after every code reference is gone. `FakeMatcher` (mode-agnostic offline greedy matcher) and the gurobi upload path are untouched.

**Tech Stack:** Django 5 + DRF (backend, `./venv/bin/python`), Vite + React + TypeScript (frontend), gurobi local solver (unchanged).

> **NOTE — spec test surface was under-counted.** The approved spec's "Tests" section listed only `MatchingModeTests`, the `cycle_qa` assert, and the `matching_mode=XTOY` setup lines. Mapping the code found more 1-to-1-coupled tests in `matching/test_external_solver.py`: `ExportOneToOneTests`, the two `parse_ftm` parser tests, `OnlineRunTests`, `test_post_matches_on_xtoy_event_400`, and `PlaceholderHeaderTests`. This plan covers all of them.

---

## File Map

**Backend — production**
- `backend/matching/external_solver.py` — delete OLWLG/ftm/online funcs; unconditionalize gurobi branches.
- `backend/matching/tasks.py` — drop online branch; FakeMatcher is the only path.
- `backend/matching/views.py` — drop the XTOY-rejection guard in `trigger`.
- `backend/bgtrade/settings.py` — delete online-solver settings.
- `backend/events/views.py` — fix `wants_export` docstring.
- `backend/events/models.py` — delete `MatchingMode` enum + `matching_mode` field.
- `backend/events/serializers.py` — drop field + its validator.
- `backend/events/migrations/00XX_remove_matching_mode.py` — new (auto-generated).

**Backend — tests**
- `backend/matching/test_external_solver.py` — delete/rewrite 1-to-1-coupled tests.
- `backend/matching/test_distance_block.py` — drop XTOY setup lines.
- `backend/events/tests.py` — delete `MatchingModeTests`.
- `backend/events/test_event_cycle_qa.py` — drop ONETOONE assert.

**Frontend**
- `frontend/src/api/events.ts` — delete mode types/consts + field.
- `frontend/src/features/events/EventDetailPage.tsx` — delete `MatchingModeCard`.
- `frontend/src/features/matching/MatchRunPage.tsx` — render both panels.

---

## Task 1: Backend solver runtime — delete online/1-to-1 paths

**Files:**
- Modify: `backend/matching/external_solver.py`
- Modify: `backend/matching/tasks.py`
- Modify: `backend/matching/views.py`
- Modify: `backend/bgtrade/settings.py`
- Modify: `backend/events/views.py`
- Test: `backend/matching/test_external_solver.py`, `backend/matching/test_distance_block.py`

- [ ] **Step 1: external_solver.py — simplify `build_wants`**

Replace the body (lines ~143-156) with the always-XTOY version:

```python
def build_wants(event) -> str:
    listings, by_code, by_game, by_id = _listing_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(event, listings, wishes, by_game, by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_game, by_id, block_pairs)
    header = _build_placeholder_header(wishes)
    return money_block + header + body if (money_block or header) else body
```

- [ ] **Step 2: external_solver.py — simplify `_build_placeholder_header`**

Replace the whole function (lines ~159-205) — only DUP-PROTECT survives (the `#! MONEY-*` block and per-item money lines were the ONETOONE money path; XTOY money uses `_build_xtoy_money_directives`). Drop the `by_id` param and the `resolve_ask, resolve_bid` import:

```python
def _build_placeholder_header(wishes) -> str:
    """Duplicate-protection comment lines (#! DUP-PROTECT). Ignored by parse_gurobi."""
    lines = [
        f"#! DUP-PROTECT ({w.user.username}) wish={w.id}"
        for w in wishes if w.want_group.duplicate_protection
    ]
    return ("\n".join(lines) + "\n") if lines else ""
```

- [ ] **Step 3: external_solver.py — delete dead functions**

Delete entirely:
- `_build_onetoone` (lines ~290-313).
- `call_online_solver` (lines ~345-368) and its section header comment.
- `parse_ftm` (lines ~380-409) and the `_FTM_LINE` regex (lines ~375-377).

- [ ] **Step 4: external_solver.py — unconditionalize `load_solution` gurobi branches**

In `load_solution`:
- Replace the parser selection (lines ~564-567):
  ```python
  parsed = parse_gurobi(raw_output)
  ```
- Remove the `if event.matching_mode == TradeEvent.MatchingMode.XTOY:` guard wrapping the cash-purchases block (line ~584) — keep the block body, de-indented one level.
- Remove the `if event.matching_mode == TradeEvent.MatchingMode.XTOY:` guard wrapping the cash-summary cross-check + settlement block (line ~642) — keep the body, de-indented.

- [ ] **Step 5: external_solver.py — update module docstring**

Edit the top docstring (lines ~1-24): `build_wants` now only describes the `(NforM) give -> take` gurobi format; remove the ONETOONE/OLWLG bullet, the `call_online_solver` entry, and `parse_ftm` mentions. Remove the now-unused `from events.models import TradeEvent` import if no other reference to `TradeEvent` remains in the file (grep to confirm).

- [ ] **Step 6: tasks.py — FakeMatcher is the only path**

In `run_match` (lines ~41-59), replace the try-body solver selection with:

```python
    try:
        matcher = FakeMatcher(match_run)
        result, summary, matcher_log = matcher.run()
```

Delete the `use_online` line, the `if ONETOONE and use_online:` online branch, and the now-unused imports `from django.conf import settings`, `from events.models import TradeEvent`, `from matching import external_solver` (lines ~23, 25, 28). Keep `MatchRun` and `FakeMatcher` imports.

- [ ] **Step 7: views.py — drop the XTOY-rejection guard in `trigger`**

Delete the block (lines ~101-106):

```python
        # X-to-Y events are solved locally by the organizer and uploaded.
        if event.matching_mode == TradeEvent.MatchingMode.XTOY:
            raise ValidationError(
                {"detail": "X-to-Y events are matched by uploading a solution to "
                           "/matches/upload/, not by triggering an online run."}
            )
```

Leave the rest of `trigger` (organizer check, MATCHING-status check, MatchRun create, `run_match.delay`) intact. `TradeEvent` import stays (still used for `Status`).

- [ ] **Step 8: settings.py — delete online-solver settings**

Delete lines ~230-241 (the `External matching solver` comment block, `SOLVER_URL`, `SOLVER_TIMEOUT`, `MATCHING_USE_ONLINE_SOLVER`).

- [ ] **Step 9: events/views.py — fix `wants_export` docstring**

Edit the docstring (lines ~420-424) to:

```python
        """Organizer-only export of the active wishes as a solver wants file
        in `(NforM) give -> take` format for the local gurobi solver.
        """
```

- [ ] **Step 10: test_external_solver.py — delete/rewrite 1-to-1-coupled tests**

- Delete class `ExportOneToOneTests` (lines ~46-99) **except** `test_export_endpoint_organizer_only`: move that method into `ExportXToYTests` (it tests the mode-agnostic wants-export endpoint permissions).
- In `ExportXToYTests.setUpTestData` (lines ~111-112), delete:
  ```python
  cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
  cls.event.save(update_fields=["matching_mode"])
  ```
- In `ParserTests`, delete `test_parse_ftm_edges_and_grouping` and `test_parse_ftm_blank_line_splits_loops`. Keep all `parse_gurobi*` tests.
- In `UploadXToYTests.setUpTestData` (lines ~257-258), delete the two `cls.event.matching_mode = XTOY` / save lines. In `test_upload_wrong_status_400`, delete the `matching_mode=TradeEvent.MatchingMode.XTOY,` kwarg (line ~343) from the `draft` event creation. Delete `test_post_matches_on_xtoy_event_400` (lines ~350-352).
- Delete class `OnlineRunTests` (lines ~359-390) and its `@override_settings(MATCHING_USE_ONLINE_SOLVER=True)` decorator + section comment.
- Rewrite `PlaceholderHeaderTests` (lines ~397-445). The event is now XTOY-only, so only `#! DUP-PROTECT` survives; money is covered by `ExportXToYTests.test_xtoy_money_directives`. Replace the three test methods with:

```python
    def test_header_has_dup_protect_line(self):
        text = external_solver.build_wants(self.event)
        self.assertIn(
            f"#! DUP-PROTECT ({self.user_a.username}) wish={self.wish_a.id}", text
        )

    def test_header_comments_do_not_break_gurobi_parser(self):
        text = external_solver.build_wants(self.event)
        self.assertEqual(external_solver.parse_gurobi(text), [])

    def test_no_dup_protect_when_disabled(self):
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        self.event.money_enabled = False
        self.event.save(update_fields=["money_enabled"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn("#! DUP-PROTECT", text)
```

Remove any now-unused imports in this class's `setUpTestData` only if they become unused (the `UserGamePrice` / sell_price money setup is no longer asserted — leave the setUp as-is; it is harmless and keeps the event realistic).

- [ ] **Step 11: test_distance_block.py — drop XTOY setup lines**

In the test setup (lines ~84-85), delete:
```python
cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
cls.event.save(update_fields=["matching_mode"])
```

- [ ] **Step 12: Run the matching test suite — expect green**

Run: `cd backend && ./venv/bin/python manage.py test matching -v1`
Expected: PASS (no failures, no errors). If a remaining test references `parse_ftm`, `call_online_solver`, `MATCHING_USE_ONLINE_SOLVER`, or `ftm-online`, it was missed in Steps 10-11 — remove it.

- [ ] **Step 13: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/tasks.py backend/matching/views.py backend/bgtrade/settings.py backend/events/views.py backend/matching/test_external_solver.py backend/matching/test_distance_block.py
git commit -m "refactor(matching): delete online ftm/1-to-1 solver paths"
```

---

## Task 2: Drop the `matching_mode` field

**Files:**
- Modify: `backend/events/models.py`
- Modify: `backend/events/serializers.py`
- Create: `backend/events/migrations/00XX_remove_matching_mode.py` (auto)
- Test: `backend/events/tests.py`, `backend/events/test_event_cycle_qa.py`

- [ ] **Step 1: models.py — delete enum + field**

Delete the `MatchingMode` `TextChoices` class (lines ~66-68) and the `matching_mode = models.CharField(...)` field (lines ~83-87).

- [ ] **Step 2: serializers.py — remove field + validator**

- Remove `"matching_mode",` from `fields` (line ~38).
- Delete `_MODE_FROZEN_STATUSES` (lines ~75-82) and `validate_matching_mode` (lines ~84-96).

- [ ] **Step 3: events/tests.py — delete MatchingModeTests**

Delete the entire `MatchingModeTests` class (lines ~580-607) and its leading section-comment banner.

- [ ] **Step 4: test_event_cycle_qa.py — drop ONETOONE assert**

Delete line ~133: `self.assertEqual(e["matching_mode"], "ONETOONE")`.

- [ ] **Step 5: Generate the migration**

Run: `cd backend && ./venv/bin/python manage.py makemigrations events`
Expected: creates `events/migrations/00XX_*.py` containing `migrations.RemoveField(model_name="tradeevent", name="matching_mode")`.

- [ ] **Step 6: Run the full backend suite — expect green**

Run: `cd backend && ./venv/bin/python manage.py test -v1`
Expected: PASS. Then confirm no stragglers:
Run: `grep -rniE "matching_mode|ONETOONE|MatchingMode" backend --include=*.py | grep -v venv | grep -v /migrations/`
Expected: no output (only `accounts/` `OneToOneField` docstrings are acceptable false positives — verify any hit is one of those).

- [ ] **Step 7: Commit**

```bash
git add backend/events/models.py backend/events/serializers.py backend/events/migrations/ backend/events/tests.py backend/events/test_event_cycle_qa.py
git commit -m "refactor(events): drop matching_mode field, unify on N-to-M"
```

---

## Task 3: Frontend — remove the mode concept, show both match panels

**Files:**
- Modify: `frontend/src/api/events.ts`
- Modify: `frontend/src/features/events/EventDetailPage.tsx`
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: api/events.ts — delete mode types/consts + field**

- Delete the `// ---- Matching mode (solver selection) ----` block (lines ~39-55): `MatchingMode` type, `MATCHING_MODE_LABELS`, `MATCHING_MODE_FROZEN_STATUSES`.
- Remove `matching_mode: MatchingMode` from the `TradeEvent` interface (line ~67).
- Remove `matching_mode?: MatchingMode` from the patch payload type (line ~129).

- [ ] **Step 2: EventDetailPage.tsx — delete MatchingModeCard**

- Delete the `MatchingModeCard` component (lines ~254-295, the `// ---- Organizer: matching mode selector ----` block through the component's close).
- Delete its render: `{event.is_organizer && <MatchingModeCard event={event} />}` (line ~963).
- Remove the now-unused imports: `MATCHING_MODE_LABELS`, `MATCHING_MODE_FROZEN_STATUSES` (lines ~22-23) and `MatchingMode` from the type import (line ~25).

- [ ] **Step 3: MatchRunPage.tsx — render both panels for every event**

Replace the `matching_mode` branch (lines ~1162-1168):

```tsx
        {canTrigger && token && (
          event.matching_mode === 'XTOY' ? (
            <XToYSolvePanel slug={slug!} onUploaded={handleTriggered} />
          ) : (
            <TriggerRunButton slug={slug!} onTriggered={handleTriggered} />
          )
        )}
```

with both panels (upload is the real N-to-M flow; the offline FakeMatcher Run button stays as a quick dev/preview match):

```tsx
        {canTrigger && token && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <XToYSolvePanel slug={slug!} onUploaded={handleTriggered} />
            <TriggerRunButton slug={slug!} onTriggered={handleTriggered} />
          </div>
        )}
```

- [ ] **Step 4: Typecheck + build — expect clean**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors (no remaining `matching_mode` / `MatchingMode` references), build succeeds.

- [ ] **Step 5: Confirm no frontend stragglers**

Run: `grep -rniE "matching_mode|MatchingMode|MATCHING_MODE" frontend/src`
Expected: no output (the `MyWantsPage.tsx` "1-to-1" hits are plain comments with no `matching_mode` token — acceptable, leave them).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/events.ts frontend/src/features/events/EventDetailPage.tsx frontend/src/features/matching/MatchRunPage.tsx
git commit -m "refactor(frontend): remove matching-mode selector, unify on N-to-M"
```

---

## Final Verification

- [ ] `cd backend && ./venv/bin/python manage.py test` — full suite green.
- [ ] `cd backend && ./venv/bin/python manage.py makemigrations --check --dry-run` — no pending model/migration drift.
- [ ] `cd frontend && npx tsc --noEmit && npm run build` — clean.
- [ ] `grep -rniE "ONETOONE|matching_mode|MatchingMode|call_online_solver|parse_ftm|MATCHING_USE_ONLINE|SOLVER_URL|ftm-online" backend frontend/src --include=*.py --include=*.ts --include=*.tsx | grep -v venv | grep -v /migrations/` — only `accounts/` `OneToOneField` docstrings and `MyWantsPage` "1-to-1" comments remain.
