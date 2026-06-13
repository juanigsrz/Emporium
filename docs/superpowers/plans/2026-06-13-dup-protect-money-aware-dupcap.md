# Money-Aware Duplicate Protection via `dupcap` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make duplicate protection hold across cash as well as swaps by replacing the `__DUMMY` swap nodes with a receiver-side capacity constraint (`dupcap`) in the solver.

**Architecture:** The solver (`FastTradeMaximizer/main.py`) already exposes per-(user,copy) swap-receive (`spend_swap`) and cash-buy (`buy`) indicators, plus a seller-side single-slot constraint. We add a `dupcap <user> <items...>` input directive and one MIP constraint summing those indicators over a game's copies ≤ 1. The exporter (`mathtrade-app/backend/matching/external_solver.py`) stops emitting dummy nodes and emits `dupcap` lines instead. Output parsing is unchanged.

**Tech Stack:** Python 3.14, gurobipy (solver, run from `FastTradeMaximizer/venv`); Django + its test runner (exporter, run from `mathtrade-app/backend`, venv at `backend/venv`).

**Spec:** `docs/superpowers/specs/2026-06-13-dup-protect-money-aware-dupcap-design.md` (supersedes the `__DUMMY` design).

---

## File Structure

- `FastTradeMaximizer/main.py` — add `dup_groups` global, parse `dupcap`, add the cap constraint.
- `FastTradeMaximizer/test_dupcap.py` (new) — subprocess-driven test (no test framework in that repo).
- `mathtrade-app/backend/matching/external_solver.py` — delete `_dup_protect_take`; rewrite `_build_xtoy` to emit real copies + `dupcap` lines.
- `mathtrade-app/backend/matching/test_external_solver.py` — rewrite `DupProtectExportTests`.
- `mathtrade-app/backend/events/test_event_cycle_qa.py` — update the export assertions.

Two repos. Task 1 = solver (self-contained). Task 2 = exporter (self-contained; its tests do not invoke the solver). Independent; do Task 1 first.

---

## Task 1: Solver — `dupcap` directive + constraint

**Repo:** `/home/juanigsrz/Desktop/FastTradeMaximizer` (branch `gurobi-experimental`). Run via `./venv/bin/python` (has gurobipy + license).

**Files:**
- Create: `FastTradeMaximizer/test_dupcap.py`
- Modify: `FastTradeMaximizer/main.py` (globals ~line 16; `parse_file` ~line 68-96; after `buy` built, ~line 198)

- [ ] **Step 1: Branch the solver repo**

```bash
cd /home/juanigsrz/Desktop/FastTradeMaximizer && git checkout -b feat/dupcap
```

- [ ] **Step 2: Write the failing test**

Create `FastTradeMaximizer/test_dupcap.py`:

```python
"""dupcap directive: a user receives at most one copy of a protected game,
counting swaps and cash buys together. Runs main.py as a subprocess."""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, "main.py")

# alice can buy either copy of game G (C1 from bob, C2 from carol).
BUY_BUY = """\
item C1 owner bob ask 10
item C2 owner carol ask 10
bid alice C1 20
bid alice C2 20
"""

# alice swaps her W for C1 and could also buy C2.
SWAP_BUY = """\
item C1 owner bob ask 10
item C2 owner carol ask 10
item W owner alice ask 0
bob : (1for1) C1 -> W
alice : (1for1) W -> C1
bid alice C2 20
"""


def run(text):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(text)
        path = f.name
    try:
        return subprocess.run(
            [sys.executable, MAIN, path],
            capture_output=True, text=True, check=True,
        ).stdout
    finally:
        os.unlink(path)


def alice_g_copies(out):
    """Copies of game G (C1/C2) alice ends up with: swap receipts + cash buys."""
    lines = out.splitlines()
    swap = sum(1 for l in lines
               if l.strip().endswith("-> C1") or l.strip().endswith("-> C2"))
    buys = sum(1 for l in lines if "-> alice" in l and "pays" in l)
    return swap + buys


def test_buy_buy_without_cap_gets_two():
    assert alice_g_copies(run(BUY_BUY)) == 2


def test_buy_buy_with_cap_gets_one():
    assert alice_g_copies(run(BUY_BUY + "dupcap alice C1 C2\n")) == 1


def test_swap_buy_without_cap_gets_two():
    assert alice_g_copies(run(SWAP_BUY)) == 2


def test_swap_buy_with_cap_gets_one():
    assert alice_g_copies(run(SWAP_BUY + "dupcap alice C1 C2\n")) == 1


if __name__ == "__main__":
    test_buy_buy_without_cap_gets_two()
    test_buy_buy_with_cap_gets_one()
    test_swap_buy_without_cap_gets_two()
    test_swap_buy_with_cap_gets_one()
    print("OK: dupcap tests passed")
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/FastTradeMaximizer && ./venv/bin/python test_dupcap.py`
Expected: FAIL — the `*_with_cap_*` cases raise `subprocess.CalledProcessError` because `main.py` hits `raise ValueError("Unrecognized line: dupcap ...")` (exit 1) on the unknown directive. (The first `without_cap` assertion may pass on its own; the script aborts at the first cap case.)

- [ ] **Step 4: Add the `dup_groups` global**

In `FastTradeMaximizer/main.py`, after the `bids = {}` line (~line 15), add:

```python
dup_groups = []  # list of (user, [item_id, ...]); user receives <=1 of these copies
```

- [ ] **Step 5: Parse the `dupcap` directive**

In `parse_file`, add the matcher next to the others (after the `m_bid = ...` line, ~line 70):

```python
            m_dup = re.fullmatch(r'dupcap\s+(\S+)\s+(.+)', line)
```

and add this branch immediately before the `elif ':' in line:` branch (~line 87):

```python
            elif m_dup:
                u = m_dup.group(1)
                users.add(u)
                dup_groups.append((u, [intern(t) for t in m_dup.group(2).split()]))
```

- [ ] **Step 6: Add the cap constraint**

In `FastTradeMaximizer/main.py`, right after `real_item_ids = set(item_to_id.values())` (~line 198), add:

```python
# Duplicate protection: a user receives at most one copy of a protected game,
# counting swap receipts and cash buys together. Demand-side mirror of the
# per-item seller slot (out_sum + buys <= 1) built in the loop below.
for u, iids in dup_groups:
    grp = set(iids)
    terms = [v for (it, v) in spend_swap.get(u, []) if it in grp]
    terms += [buy[(u, it)] for it in grp if (u, it) in buy]
    if len(terms) > 1:
        model.addConstr(gp.quicksum(terms) <= 1)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd /home/juanigsrz/Desktop/FastTradeMaximizer && ./venv/bin/python test_dupcap.py`
Expected: `OK: dupcap tests passed`

- [ ] **Step 8: Confirm pure-barter / money-free files are unaffected**

Run: `cd /home/juanigsrz/Desktop/FastTradeMaximizer && printf 'alice : (1for1) A -> B\nbob : (1for1) B -> A\n' > /tmp/barter.txt && ./venv/bin/python main.py /tmp/barter.txt`
Expected: a `Trade Results:` section with `A -> B` and `B -> A` (no errors, no money sections). Confirms the new global/branch didn't disturb the barter path.

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/FastTradeMaximizer
git add main.py test_dupcap.py
git commit -m "feat: dupcap directive — receiver-side duplicate protection across swap and cash"
```

IMPORTANT: do NOT add any `Co-Authored-By` trailer.

---

## Task 2: Exporter — emit `dupcap`, retire `__DUMMY`

**Repo:** `/home/juanigsrz/Desktop/mathtrade-app` (branch `feat/dup-protect-dupcap`, already created). Run tests from `backend/` via `./venv/bin/python manage.py test ...`.

**Files:**
- Modify: `backend/matching/external_solver.py` (delete `_dup_protect_take` ~lines 230-256; rewrite `_build_xtoy` ~lines 259-300)
- Modify: `backend/matching/test_external_solver.py` (class `DupProtectExportTests`)
- Modify: `backend/events/test_event_cycle_qa.py` (export assertions ~lines 208-214)

- [ ] **Step 1: Confirm on the right branch**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app && git branch --show-current`
Expected: `feat/dup-protect-dupcap`. If not: `git checkout feat/dup-protect-dupcap`.

- [ ] **Step 2: Rewrite the `DupProtectExportTests` tests (failing)**

In `backend/matching/test_external_solver.py`, replace the entire `DupProtectExportTests` class with:

```python
# ---------------------------------------------------------------------------
# Duplicate protection via dupcap directives
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

    def test_multi_copy_game_emits_dupcap(self):
        text = external_solver.build_wants(self.event)
        self.assertNotIn("__DUMMY", text)
        # wish line lists the real terra copies (no dummy indirection)
        main = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a1.listing_code in l
        )
        self.assertIn(self.copy_b1.listing_code, main)
        self.assertIn(self.copy_c2.listing_code, main)
        # a dupcap line caps alice over both terra copies
        cap = next(
            (l for l in text.splitlines()
             if l.startswith(f"dupcap {self.user_a.username} ")),
            None,
        )
        self.assertIsNotNone(cap)
        self.assertIn(self.copy_b1.listing_code, cap)
        self.assertIn(self.copy_c2.listing_code, cap)

    def test_single_copy_game_no_dupcap(self):
        # alice offers ark (el_a2), wants brass -> carol's brass only (1 copy)
        wish = self._make_wish(self.user_a, self.el_a2, want_game=self.game_brass)
        wish.want_group.duplicate_protection = True
        wish.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        # no dupcap line mentions the single brass copy
        self.assertFalse(
            any(l.startswith("dupcap") and self.copy_c1.listing_code in l
                for l in text.splitlines())
        )
        # the real copy still appears on a wish line's take side
        line = next(
            l for l in text.splitlines()
            if l.startswith(f"{self.user_a.username} :")
            and self.copy_a2.listing_code in l
        )
        self.assertIn(self.copy_c1.listing_code, line.split(" -> ")[1])

    def test_dupcap_unions_across_want_groups_same_game(self):
        # a second dup-protected want group for terra, same user (offers ark)
        wish2 = self._make_wish(self.user_a, self.el_a2, want_game=self.game_terra)
        wish2.want_group.duplicate_protection = True
        wish2.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        caps = [l for l in text.splitlines()
                if l.startswith(f"dupcap {self.user_a.username} ")]
        # exactly one dupcap for alice (terra), unioning both copies
        self.assertEqual(len(caps), 1)
        self.assertIn(self.copy_b1.listing_code, caps[0])
        self.assertIn(self.copy_c2.listing_code, caps[0])

    def test_no_dupcap_when_disabled(self):
        self.wish_a.want_group.duplicate_protection = False
        self.wish_a.want_group.save(update_fields=["duplicate_protection"])
        text = external_solver.build_wants(self.event)
        self.assertNotIn("dupcap", text)
        self.assertNotIn("__DUMMY", text)

    def test_dupcap_export_does_not_break_gurobi_parser(self):
        text = external_solver.build_wants(self.event)
        self.assertEqual(external_solver.parse_gurobi(text), [])
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app/backend && ./venv/bin/python manage.py test matching.test_external_solver.DupProtectExportTests -v 2`
Expected: FAIL — current code still emits `__DUMMY` and no `dupcap`, so `test_multi_copy_game_emits_dupcap` (StopIteration / assertIsNotNone) and `test_dupcap_unions_across_want_groups_same_game` fail.

- [ ] **Step 4: Delete the `_dup_protect_take` helper**

In `backend/matching/external_solver.py`, delete the entire `_dup_protect_take` function (the `def _dup_protect_take(take, username, by_code):` block, ~lines 230-256, including its trailing blank lines down to the `def _build_xtoy` line).

- [ ] **Step 5: Rewrite `_build_xtoy`**

In `backend/matching/external_solver.py`, replace the entire `_build_xtoy` function with:

```python
def _build_xtoy(wishes, by_game, by_id, by_code, block_pairs) -> str:
    """gurobi: one `username : (NforM) give -> take` line per active wish.

    A duplicate-protected wish lists its real take copies and contributes a
    `dupcap <username> <copies>` directive per (user, canonical game) that has
    >=2 acceptable copies. The solver caps the user's total receipts (swap +
    cash) of those copies at one. dupcap lines are emitted after the wish lines,
    sorted by (username, board_game_id), and union a user's copies for a game
    across all of their dup-protected wishes.
    """
    blocked_cache = {}
    coords = _load_coords()
    lines = []
    dup_groups = {}  # (username, board_game_id) -> set of copy codes
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
            for code in take:
                key = (w.user.username, by_code[code].copy.board_game_id)
                dup_groups.setdefault(key, set()).add(code)
        lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    for (username, _bg_id), codes in sorted(dup_groups.items()):
        if len(codes) >= 2:
            lines.append(f"dupcap {username} {' '.join(sorted(codes))}")
    return ("\n".join(lines) + "\n") if lines else ""
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app/backend && ./venv/bin/python manage.py test matching.test_external_solver.DupProtectExportTests -v 2`
Expected: PASS (5 tests).

- [ ] **Step 7: Update the QA cycle export assertions**

In `backend/events/test_event_cycle_qa.py` (~lines 208-214), replace the duplicate-protection assertion block (the `assertNotIn("DUP-PROTECT", text)` plus the `assertFalse(any(... "__DUMMY_" ...))` it precedes) with:

```python
        self.assertNotIn("DUP-PROTECT", text)
        self.assertNotIn("__DUMMY", text)
        # terra has a single active copy (c2_terra) -> not capped.
        self.assertFalse(
            any(l.startswith("dupcap") and self.c2_terra.listing_code in l
                for l in text.splitlines()),
            "single-copy terra should not be capped",
        )
        # brass has two copies (t1, t3) and t2 wants it -> a dupcap for t2.
        self.assertTrue(
            any(l.startswith(f"dupcap {self.t2.username} ")
                for l in text.splitlines()),
            "two-copy brass want should emit a dupcap",
        )
```

- [ ] **Step 8: Run the affected suites**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app/backend && ./venv/bin/python manage.py test matching events -v 1`
Expected: PASS (no failures, no errors).

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/mathtrade-app
git add backend/matching/external_solver.py backend/matching/test_external_solver.py backend/events/test_event_cycle_qa.py
git commit -m "feat(matching): emit dupcap directives, retire __DUMMY export"
```

IMPORTANT: do NOT add any `Co-Authored-By` trailer.

---

## Final verification

- [ ] **No `__DUMMY` left in the exporter repo**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app && grep -rn "__DUMMY\|_dup_protect_take" --include='*.py' backend | grep -v venv`
Expected: zero hits.

- [ ] **Full backend suite green**

Run: `cd /home/juanigsrz/Desktop/mathtrade-app/backend && ./venv/bin/python manage.py test -v 1`
Expected: all green (baseline 383 tests; net count shifts by the rewritten `DupProtectExportTests`).

- [ ] **Solver tests green**

Run: `cd /home/juanigsrz/Desktop/FastTradeMaximizer && ./venv/bin/python test_dupcap.py`
Expected: `OK: dupcap tests passed`
