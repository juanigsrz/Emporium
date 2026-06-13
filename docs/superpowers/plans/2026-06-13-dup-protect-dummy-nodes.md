# Duplicate Protection via Dummy Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `DUP-PROTECT` inline tag in the wants export with structural `__DUMMY` nodes that route a game's interchangeable copies through one shared node, so "at most one copy of that game" falls out of the trade graph.

**Architecture:** Change only the export side in `backend/matching/external_solver.py`. A duplicate-protected want group groups its expanded take codes by board game; a game with ≥2 copies is collapsed behind a single `__DUMMY_<wantgroup_id>_<board_game_id>` token on the wish line, with a `(1for1) dummy -> copies` leg emitted once. Single-copy games pass through. `load_solution`, the parsers, and the money directives are untouched.

**Tech Stack:** Python 3.14, Django, Django test runner. Backend venv at `backend/venv` (run tests from `backend/`).

**Spec:** `docs/superpowers/specs/2026-06-13-dup-protect-dummy-nodes-design.md`

---

## File Structure

- Modify: `backend/matching/external_solver.py`
  - Add helper `_dup_protect_take(take, want_group_id, by_code)`.
  - Rewrite `_build_xtoy(...)` — add `by_code` param, drop the `DUP-PROTECT` tag, emit dummy nodes + legs.
  - Update the `build_wants` call site to pass `by_code`.
- Modify (tests): `backend/matching/test_external_solver.py`
  - Rewrite class `DupProtectExportTests`; add a `trades.models` import.
- Modify (tests): `backend/events/test_event_cycle_qa.py`
  - Fix the one tag assertion at line ~208 (terra has a single copy there → passthrough, no tag, no dummy).

---

## Task 1: Dummy-node export transform

**Files:**
- Modify: `backend/matching/external_solver.py` (`_build_xtoy` ~line 230, `build_wants` line 144, new helper)
- Test: `backend/matching/test_external_solver.py` (class `DupProtectExportTests` ~lines 264-289, imports ~line 14-19)
- Test: `backend/events/test_event_cycle_qa.py` (line ~208)

- [ ] **Step 1: Rewrite the `DupProtectExportTests` tests (failing)**

In `backend/matching/test_external_solver.py`, add this import near the top (after line 16, with the other model imports):

```python
from trades.models import OfferGroup, OfferGroupItem, TradeWish
```

Replace the entire existing `DupProtectExportTests` class (the block under the `# Duplicate-protection inline flag ...` banner, lines ~264-289) with:

```python
# ---------------------------------------------------------------------------
# Duplicate protection via __DUMMY nodes
# ---------------------------------------------------------------------------

class DupProtectExportTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice offers brass (el_a1), wants terra — 2 active copies exist
        # (bob's el_b1 / copy_b1, carol's el_c2 / copy_c2).
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_a.want_group.duplicate_protection = True
        cls.wish_a.want_group.save(update_fields=["duplicate_protection"])

    def _dummy_code(self, wish, game):
        return f"__DUMMY_{wish.want_group_id}_{game.id}"

    def test_multi_copy_game_routed_through_dummy(self):
        text = external_solver.build_wants(self.event)
        dummy = self._dummy_code(self.wish_a, self.game_terra)
        # alice's wish line (the one carrying her brass offer)
        main = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a1.listing_code in l
        )
        # take side points at the dummy, not the raw terra copies
        self.assertIn(dummy, main.split(" -> ")[1])
        self.assertNotIn(self.copy_b1.listing_code, main)
        self.assertNotIn(self.copy_c2.listing_code, main)
        # a (1for1) dummy leg lists both real terra copies
        leg = next(l for l in text.splitlines() if f"(1for1) {dummy} ->" in l)
        self.assertIn(self.copy_b1.listing_code, leg)
        self.assertIn(self.copy_c2.listing_code, leg)

    def test_dup_protect_tag_removed(self):
        text = external_solver.build_wants(self.event)
        self.assertNotIn("DUP-PROTECT", text)

    def test_single_copy_game_passes_through(self):
        # alice offers ark (el_a2), wants brass — expands to carol's brass
        # (el_c1 / copy_c1) only; alice's own brass is excluded -> 1 copy.
        wish = self._make_wish(self.user_a, self.el_a2, want_game=self.game_brass)
        wish.want_group.duplicate_protection = True
        wish.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn(self._dummy_code(wish, self.game_brass), text)
        line = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a2.listing_code in l
        )
        self.assertIn(self.copy_c1.listing_code, line.split(" -> ")[1])

    def test_shared_want_group_emits_single_dummy_leg(self):
        # a second wish (alice's ark) reuses wish_a's dup-protected terra group
        og2 = OfferGroup.objects.create(
            event=self.event, user=self.user_a, name="OG-a-shared", max_give=1,
        )
        OfferGroupItem.objects.create(offer_group=og2, event_listing=self.el_a2)
        TradeWish.objects.create(
            event=self.event, user=self.user_a, offer_group=og2,
            want_group=self.wish_a.want_group, active=True,
        )
        text = external_solver.build_wants(self.event)
        dummy = self._dummy_code(self.wish_a, self.game_terra)
        legs = [l for l in text.splitlines() if f"(1for1) {dummy} ->" in l]
        self.assertEqual(len(legs), 1)

    def test_no_dummy_when_disabled(self):
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn("__DUMMY", text)
        self.assertNotIn("DUP-PROTECT", text)

    def test_dummy_export_does_not_break_gurobi_parser(self):
        text = external_solver.build_wants(self.event)
        self.assertEqual(external_solver.parse_gurobi(text), [])
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd backend && python manage.py test matching.test_external_solver.DupProtectExportTests -v 2`
Expected: FAIL — `test_multi_copy_game_routed_through_dummy` / `test_shared_want_group_emits_single_dummy_leg` raise `StopIteration` (no `__DUMMY` leg) and `test_dup_protect_tag_removed` fails because the current code still emits `DUP-PROTECT`.

- [ ] **Step 3: Add the `_dup_protect_take` helper**

In `backend/matching/external_solver.py`, add this function immediately above `_build_xtoy` (after the `_build_xtoy_money_directives` function, before the `def _build_xtoy(` line):

```python
def _dup_protect_take(take, want_group_id, by_code):
    """Collapse same-game copies behind dummy nodes for duplicate protection.

    Groups `take` codes by board game. A game with >=2 acceptable copies is
    replaced in the take set by a single `__DUMMY_<wantgroup>_<boardgame>` token,
    and its real copies move onto a dummy leg (dummy -> copies). A single-copy
    game passes through unchanged. Returns (take_tokens, dummy_legs), where
    take_tokens is sorted and dummy_legs maps dummy_code -> sorted copy codes.
    """
    by_bg = defaultdict(list)
    for code in take:
        by_bg[by_code[code].copy.board_game_id].append(code)
    take_tokens = []
    dummy_legs = {}
    for bg_id, codes in by_bg.items():
        if len(codes) >= 2:
            dummy = f"__DUMMY_{want_group_id}_{bg_id}"
            take_tokens.append(dummy)
            dummy_legs[dummy] = sorted(codes)
        else:
            take_tokens.append(codes[0])
    return sorted(take_tokens), dummy_legs
```

(`defaultdict` is already imported at the top of the file.)

- [ ] **Step 4: Rewrite `_build_xtoy` to emit dummies and drop the tag**

In `backend/matching/external_solver.py`, replace the entire current `_build_xtoy` function (lines ~230-257) with:

```python
def _build_xtoy(wishes, by_game, by_id, by_code, block_pairs) -> str:
    """gurobi: one `username : (NforM) give -> take` line per active wish.

    A duplicate-protected want group routes each game that has >=2 acceptable
    copies through a single `__DUMMY_<wantgroup>_<boardgame>` node — the wish's
    take side points at the dummy, and a `(1for1) dummy -> copies` leg points at
    the real copies. Because a dummy is one node, at most one copy of that game
    can flow through any single trade chain. Dummy legs are emitted once (after
    all wish lines, sorted by code), so a want group shared across wishes
    collapses to one leg.
    """
    blocked_cache = {}
    coords = _load_coords()
    lines = []
    dummy_legs = {}  # dummy_code -> (username, [copy codes])
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        give = sorted(
            ogi.event_listing.copy.listing_code
            for ogi in w.offer_group.items.all()
            if ogi.event_listing.active
        )
        take = [c for c in _expand(w.want_group.items.all(), w.user_id, by_game, by_id, blocked)
                if c not in give]
        if not give or not take:
            continue
        n = w.offer_group.max_give
        m = w.want_group.min_receive
        if w.want_group.duplicate_protection:
            take, legs = _dup_protect_take(take, w.want_group_id, by_code)
            for dummy, codes in legs.items():
                dummy_legs[dummy] = (w.user.username, codes)
        lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    for dummy in sorted(dummy_legs):
        username, codes = dummy_legs[dummy]
        lines.append(f"{username} : (1for1) {dummy} -> {' '.join(codes)}")
    return ("\n".join(lines) + "\n") if lines else ""
```

- [ ] **Step 5: Pass `by_code` from `build_wants`**

In `backend/matching/external_solver.py`, in `build_wants` (line ~144), change the `_build_xtoy` call from:

```python
    body = _build_xtoy(wishes, by_game, by_id, block_pairs)
```

to:

```python
    body = _build_xtoy(wishes, by_game, by_id, by_code, block_pairs)
```

(`by_code` is already returned by `_listing_index` and bound at the top of `build_wants`.)

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd backend && python manage.py test matching.test_external_solver.DupProtectExportTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 7: Fix the QA cycle test's tag assertion**

In `backend/events/test_event_cycle_qa.py` (line ~208), terra has a single active copy there, so the dup-protected wish passes through with no tag and no dummy. Replace:

```python
        self.assertIn("DUP-PROTECT : (", text)
```

with:

```python
        # dup protection no longer emits a tag; t1's single terra copy passes
        # through with no dummy node.
        self.assertNotIn("DUP-PROTECT", text)
        self.assertNotIn("__DUMMY", text)
```

(Leave the `assertNotIn("DUP-PROTECT", text)` at line ~283 as-is — still valid.)

- [ ] **Step 8: Run the affected suites**

Run: `cd backend && python manage.py test matching events -v 1`
Expected: PASS (no failures, no errors).

- [ ] **Step 9: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py backend/events/test_event_cycle_qa.py
git commit -m "feat(matching): export duplicate protection as __DUMMY nodes"
```

---

## Final verification

- [ ] **Confirm no stray `DUP-PROTECT` emitter remains**

Run: `cd backend && grep -rn "DUP-PROTECT" --include='*.py' . | grep -v venv`
Expected: zero hits in `external_solver.py` and test files. (Hits only allowed if they are in unrelated docs/comments — there should be none after this change.)

- [ ] **Run the full backend suite**

Run: `cd backend && python manage.py test -v 1`
Expected: all green (baseline was 182 tests green; net test count changes by the rewritten `DupProtectExportTests`).
