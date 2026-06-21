# Solver `takecap` / `givecap` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the solver's `dupcap` directive to `takecap <user> <N> <items>` (receive ≤ N) and add the mirror `givecap <user> <N> <items>` (give ≤ N), keeping `dupcap` as a legacy alias.

**Architecture:** All changes are in the Pareto MIP solver. Parse two new directives into `take_groups`/`give_groups`; the take constraint generalizes the existing `≤1` receiver cap to `≤N` over swap receipts + cash buys; the give constraint mirrors it over swap supply (`in_terms`, incl. combo/hub out-spokes) + cash sale (`buy_terms`), validating each listed item is owned by the user. `dupcap` parses to `takecap N=1`.

**Tech Stack:** Python 3, `gurobipy`. Tests are subprocess end-to-end runs of `main.py` (no test framework), matching `test_dupcap.py`.

**Spec:** `docs/superpowers/specs/2026-06-21-solver-takecap-givecap-design.md`

**Repo for all tasks:** `/home/juanigsrz/Desktop/Pareto`. Python interpreter: `./venv/bin/python`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Pareto && git checkout -b feat/takecap-givecap
```

Expected: `Switched to a new branch 'feat/takecap-givecap'`

---

### Task 1: `takecap` directive (rename `dupcap`, generalize to N)

**Files:**
- Create: `/home/juanigsrz/Desktop/Pareto/test_takecap.py`
- Modify: `/home/juanigsrz/Desktop/Pareto/main.py` (globals line 19; parsing ~line 76 + ~line 95; hub ~line 186; take-constraint loop ~line 299)

- [ ] **Step 1: Write the failing test**

Create `/home/juanigsrz/Desktop/Pareto/test_takecap.py`:

```python
"""takecap directive: a user receives at most N of the listed copies, counting
swaps and cash buys together. dupcap is the legacy N=1 alias. Runs main.py as a
subprocess, like test_dupcap.py."""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, "main.py")

# alice can buy three copies of game G (C1/C2/C3 from three sellers).
BUY3 = """\
item C1 owner bob ask 10
item C2 owner carol ask 10
item C3 owner dave ask 10
bid alice C1 20
bid alice C2 20
bid alice C3 20
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


def alice_buys(out):
    """Copies alice acquires by cash buy."""
    return sum(1 for l in out.splitlines() if "-> alice" in l and "pays" in l)


def test_takecap_n1_caps_at_one():
    assert alice_buys(run(BUY3 + "takecap alice 1 C1 C2 C3\n")) == 1


def test_takecap_n2_caps_at_two():
    assert alice_buys(run(BUY3 + "takecap alice 2 C1 C2 C3\n")) == 2


def test_takecap_uncapped_gets_three():
    assert alice_buys(run(BUY3)) == 3


def test_dupcap_alias_equals_takecap_one():
    assert alice_buys(run(BUY3 + "dupcap alice C1 C2 C3\n")) == 1


if __name__ == "__main__":
    test_takecap_uncapped_gets_three()
    test_takecap_n1_caps_at_one()
    test_takecap_n2_caps_at_two()
    test_dupcap_alias_equals_takecap_one()
    print("OK: takecap tests passed")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_takecap.py`
Expected: FAIL — the `takecap` cases raise `subprocess.CalledProcessError` because `main.py` hits `raise ValueError("Unrecognized line: takecap ...")` (exit 1) on the unknown directive.

- [ ] **Step 3: Rename the global**

In `main.py`, replace line 19:

```python
dup_groups = []  # list of (user, [item_id, ...]); user receives <=1 of these copies
```

with:

```python
take_groups = []  # list of (user, N, [item_id, ...]); user receives <= N of these copies
```

- [ ] **Step 4: Parse `takecap` (+ keep `dupcap` as N=1 alias)**

In `main.py` `parse_file`, find the `m_dup` match line (~line 76):

```python
            m_dup = re.fullmatch(r'dupcap\s+(\S+)\s+(.+)', line)
```

Insert the `takecap` matcher directly above it:

```python
            m_take = re.fullmatch(r'takecap\s+(\S+)\s+(\d+)\s+(.+)', line)
            m_dup = re.fullmatch(r'dupcap\s+(\S+)\s+(.+)', line)
```

Then find the `m_dup` handler (~line 95):

```python
            elif m_dup:
                u = m_dup.group(1)
                users.add(u)
                dup_groups.append((u, [intern(t) for t in m_dup.group(2).split()]))
```

Replace it with:

```python
            elif m_take:
                u = m_take.group(1)
                users.add(u)
                take_groups.append((u, int(m_take.group(2)),
                                    [intern(t) for t in m_take.group(3).split()]))
            elif m_dup:
                u = m_dup.group(1)
                users.add(u)
                take_groups.append((u, 1, [intern(t) for t in m_dup.group(2).split()]))
```

- [ ] **Step 5: Update the hub compaction to source `take_groups`**

In `main.py` find (~line 186):

```python
    _dup_sets = defaultdict(set)
    for _u, _iids in dup_groups:
        _dup_sets[_u].add(frozenset(_iids))
```

Replace the loop with (membership only; N ignored — the cap row still bounds it):

```python
    _dup_sets = defaultdict(set)
    for _u, _n, _iids in take_groups:
        _dup_sets[_u].add(frozenset(_iids))
```

- [ ] **Step 6: Generalize the take constraint to ≤ N**

In `main.py` find the dupcap constraint loop (~line 299):

```python
for u, iids in dup_groups:
    grp = set(iids)
    terms = [v for (it, v) in spend_swap.get(u, []) if it in grp]
    terms += [buy[(u, it)] for it in grp if (u, it) in buy]
    if len(terms) > 1:
        model.addConstr(gp.quicksum(terms) <= 1)
```

Replace with:

```python
for u, n, iids in take_groups:
    grp = set(iids)
    terms = [v for (it, v) in spend_swap.get(u, []) if it in grp]
    terms += [buy[(u, it)] for it in grp if (u, it) in buy]
    if len(terms) > n:
        model.addConstr(gp.quicksum(terms) <= n)
```

- [ ] **Step 7: Run the new test — verify it passes**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_takecap.py`
Expected: `OK: takecap tests passed`

- [ ] **Step 8: Run the legacy test — verify no regression**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_dupcap.py`
Expected: `OK: dupcap tests passed`

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/Pareto && git add main.py test_takecap.py
git commit -m "feat: takecap directive (generalize dupcap to receive <= N); dupcap kept as N=1 alias"
```

---

### Task 2: `givecap` directive (give ≤ N, owner-validated)

**Files:**
- Modify: `/home/juanigsrz/Desktop/Pareto/main.py` (global ~line 20; parsing ~line 76 + ~line 95; new give-constraint loop after the take loop ~line 305)
- Modify: `/home/juanigsrz/Desktop/Pareto/test_takecap.py` (append givecap tests)

- [ ] **Step 1: Write the failing tests**

Append to `/home/juanigsrz/Desktop/Pareto/test_takecap.py`, immediately before the `if __name__ == "__main__":` block:

```python
# u owns A and B; two other users each want one of them via swap.
GIVE_SWAP = """\
item A owner u ask 0
item B owner u ask 0
item P owner p ask 0
item Q owner q ask 0
u : (1for1) A -> P
u : (1for1) B -> Q
p : (1for1) P -> A
q : (1for1) Q -> B
"""

# u owns A (cash-sellable to buyer) and B (swap-wanted by q).
GIVE_CASH = """\
item A owner u ask 10
item B owner u ask 0
item Q owner q ask 0
bid buyer A 20
u : (1for1) B -> Q
q : (1for1) Q -> B
"""

# givecap names P, which is owned by p, not u -> must raise.
GIVE_BAD_OWNER = """\
item A owner u ask 0
item P owner p ask 0
u : (1for1) A -> P
p : (1for1) P -> A
givecap u 1 P
"""


def run_raw(text):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(text)
        path = f.name
    try:
        return subprocess.run(
            [sys.executable, MAIN, path], capture_output=True, text=True,
        )
    finally:
        os.unlink(path)


def u_gives_swap(out):
    """Times one of u's items (A or B) is given in a swap (left of '->')."""
    return sum(1 for l in out.splitlines()
               if l.strip().startswith(("A ", "B ")) and " -> " in l)


def u_gives_cash(out):
    """u's gives counting a cash sale of A and a swap give of B."""
    n = 0
    for l in out.splitlines():
        s = l.strip()
        if s.startswith("A:") and "u ->" in s:   # cash sale of A by u
            n += 1
        if s.startswith("B ") and " -> " in s:    # swap give of B
            n += 1
    return n


def test_givecap_swap_uncapped_gives_two():
    assert u_gives_swap(run(GIVE_SWAP)) == 2


def test_givecap_swap_caps_at_one():
    assert u_gives_swap(run(GIVE_SWAP + "givecap u 1 A B\n")) == 1


def test_givecap_counts_cash_sale():
    assert u_gives_cash(run(GIVE_CASH)) == 2
    assert u_gives_cash(run(GIVE_CASH + "givecap u 1 A B\n")) == 1


def test_givecap_bad_owner_raises():
    res = run_raw(GIVE_BAD_OWNER)
    assert res.returncode != 0
    assert "givecap" in res.stderr
```

Update the `if __name__ == "__main__":` block to also call the new tests:

```python
if __name__ == "__main__":
    test_takecap_uncapped_gets_three()
    test_takecap_n1_caps_at_one()
    test_takecap_n2_caps_at_two()
    test_dupcap_alias_equals_takecap_one()
    test_givecap_swap_uncapped_gives_two()
    test_givecap_swap_caps_at_one()
    test_givecap_counts_cash_sale()
    test_givecap_bad_owner_raises()
    print("OK: takecap/givecap tests passed")
```

- [ ] **Step 2: Run tests to verify the givecap ones fail**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_takecap.py`
Expected: FAIL — `givecap` is unrecognized, so `test_givecap_swap_caps_at_one` raises `subprocess.CalledProcessError` (exit 1) on the `givecap` line. (`test_givecap_bad_owner_raises` may pass coincidentally since any unrecognized line is also non-zero, but the cap cases fail.)

- [ ] **Step 3: Add the `give_groups` global**

In `main.py`, find (now, after Task 1):

```python
take_groups = []  # list of (user, N, [item_id, ...]); user receives <= N of these copies
```

Add directly below it:

```python
give_groups = []  # list of (user, N, [item_id, ...]); user gives <= N of these copies
```

- [ ] **Step 4: Parse `givecap`**

In `main.py` `parse_file`, find the `m_take` matcher added in Task 1:

```python
            m_take = re.fullmatch(r'takecap\s+(\S+)\s+(\d+)\s+(.+)', line)
```

Add the `givecap` matcher directly below it:

```python
            m_give = re.fullmatch(r'givecap\s+(\S+)\s+(\d+)\s+(.+)', line)
```

Then find the `m_take` handler:

```python
            elif m_take:
                u = m_take.group(1)
                users.add(u)
                take_groups.append((u, int(m_take.group(2)),
                                    [intern(t) for t in m_take.group(3).split()]))
```

Add the `m_give` handler directly below it:

```python
            elif m_give:
                u = m_give.group(1)
                users.add(u)
                give_groups.append((u, int(m_give.group(2)),
                                    [intern(t) for t in m_give.group(3).split()]))
```

- [ ] **Step 5: Add the give constraint**

In `main.py`, find the end of the take-constraint loop from Task 1:

```python
for u, n, iids in take_groups:
    grp = set(iids)
    terms = [v for (it, v) in spend_swap.get(u, []) if it in grp]
    terms += [buy[(u, it)] for it in grp if (u, it) in buy]
    if len(terms) > n:
        model.addConstr(gp.quicksum(terms) <= n)
```

Add directly below it:

```python
# Give cap: a user gives at most N of the listed copies, counting swap supply
# (in_terms, incl. combo/hub out-spokes) and cash sale (buy_terms). Mirror of
# takecap. Items must be owned by the user.
for u, n, iids in give_groups:
    grp = set(iids)
    for it in grp:
        if owner.get(it) != u:
            raise ValueError(
                f"givecap user '{u}' lists item '{id_to_item[it]}' "
                f"owned by '{owner.get(it)}'")
    terms = []
    for it in grp:
        terms += in_terms.get(it, [])
        terms += buy_terms.get(it, [])
    if len(terms) > n:
        model.addConstr(gp.quicksum(terms) <= n)
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_takecap.py`
Expected: `OK: takecap/givecap tests passed`

- [ ] **Step 7: Run the legacy test — verify no regression**

Run: `cd /home/juanigsrz/Desktop/Pareto && ./venv/bin/python test_dupcap.py`
Expected: `OK: dupcap tests passed`

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Pareto && git add main.py test_takecap.py
git commit -m "feat: givecap directive — give <= N copies (owner-validated), mirror of takecap"
```

---

### Task 3: README docs

**Files:**
- Modify: `/home/juanigsrz/Desktop/Pareto/README.md` (features bullet ~line 23; cap section ~line 94; how-it-works bullet ~line 162)

- [ ] **Step 1: Update the Features bullet**

In `README.md` find (~line 23):

```markdown
- **Duplicate protection (`dupcap`)** — a user receives at most one copy of a
  given game, counting swap receipts and cash buys together.
```

Replace with:

```markdown
- **Take / give caps (`takecap` / `givecap`)** — bound how many of a listed set
  of copies a user may **receive** (`takecap`) or **give** (`givecap`),
  counting swaps and cash together. `dupcap` is the legacy `takecap … 1` alias.
```

- [ ] **Step 2: Replace the cap section**

In `README.md` find (~line 94):

```markdown
### Duplicate cap

```
dupcap <user> <item...>     # user receives at most ONE of these copies
```

Use it when several listed items are copies of the *same* game and the user
wants only one, regardless of whether it arrives by swap or by cash.
```

Replace with:

```markdown
### Take / give caps

```
takecap <user> <N> <item...>   # user RECEIVES at most N of these copies
givecap <user> <N> <item...>   # user GIVES   at most N of these copies
dupcap  <user> <item...>       # legacy alias for: takecap <user> 1 <item...>
```

Both count swaps and cash together. `takecap` is receiver-side duplicate
protection: list copies of the same game so the user ends up with at most N
regardless of whether they arrive by swap or cash. `givecap` is the give-side
mirror over the user's **own** copies — list a physical item alongside every
combo/bundle item that contains it so it can leave at most N times in total
(e.g. `givecap u 1 A AB` lets `A` go out standalone *or* inside combo `AB`, not
both). Every `givecap` item must be owned by the named user.
```

- [ ] **Step 3: Update the "How it works" bullet**

In `README.md` find (~line 162):

```markdown
- `dupcap` adds one constraint summing a user's swap-receive and buy indicators
  over the protected copies to ≤ 1.
```

Replace with:

```markdown
- `takecap` / `givecap` each add one constraint per group: `takecap` sums a
  user's swap-receive and buy indicators over the listed copies to ≤ N;
  `givecap` sums the swap-supply and cash-sale indicators of the user's own
  copies to ≤ N.
```

- [ ] **Step 4: Update the Testing section**

In `README.md` find (~line 185):

```markdown
`dupcap` has a self-contained subprocess test (no test framework needed):

```bash
python test_dupcap.py
```
```

Replace with:

```markdown
The caps have self-contained subprocess tests (no test framework needed):

```bash
python test_dupcap.py
python test_takecap.py
```
```

- [ ] **Step 5: Commit**

```bash
cd /home/juanigsrz/Desktop/Pareto && git add README.md
git commit -m "docs: document takecap/givecap directives and dupcap alias"
```

---

## Self-Review

**Spec coverage:**
- `takecap` parse + ≤N constraint → Task 1 ✔
- `dupcap` legacy alias (N=1) → Task 1 (parse) + `test_dupcap.py` unchanged ✔
- `givecap` parse + ≤N constraint + owner validation → Task 2 ✔
- givecap counts cash sale → Task 2 test `test_givecap_counts_cash_sale` ✔
- hub sources `take_groups` → Task 1 Step 5 ✔
- tests (takecap N=1/N=2, givecap swap/cash/bad-owner, dupcap green) → Tasks 1–2 ✔
- README → Task 3 ✔
- No Emporium changes → respected (all paths under `/Pareto`) ✔

**Type/name consistency:** `take_groups`/`give_groups` are `(user, N, [ids])` everywhere; loops unpack `for u, n, iids`; hub unpacks `for _u, _n, _iids`. `m_take`/`m_give`/`m_dup` matchers and handlers aligned. ✔

**Placeholder scan:** none.
