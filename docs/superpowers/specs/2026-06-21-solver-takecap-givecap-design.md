# Solver `takecap` / `givecap` — Design

## Summary

Generalize the solver's duplicate-protection directive and add its give-side
mirror, in the Pareto MIP solver only.

- `dupcap <user> <item...>` (receive at most one copy) becomes
  **`takecap <user> <N> <item...>`** — the user receives at most **N** of the
  listed copies. `N=1` is exactly the old `dupcap`.
- Add **`givecap <user> <N> <item...>`** — the user **gives** at most **N** of
  the listed copies (counting swap supply *and* cash sale).
- `dupcap` is kept as a **legacy alias** for `takecap <user> 1 <item...>` so the
  Emporium exporter (`backend/matching/external_solver.py`) keeps working
  unchanged until the platform-side items (#5, #12) migrate it.

**Repo:** `/home/juanigsrz/Desktop/Pareto` (`main.py`). No Emporium code changes
in this slice.

**Motivation:** `givecap` is the modelling primitive that lets the platform
guarantee a user never sends the same *physical* item twice — required for combos
/ bundles (#12) and the advanced-panel manual caps (#5). Example combo of items
`A` and `B` sold either standalone or as a synthetic combo item `AB`:

```
givecap u 1 A AB     # A leaves at most once: standalone OR inside the combo
givecap u 1 B AB     # B leaves at most once: standalone OR inside the combo
```

## Background — current model

In `main.py` an item node's directed edges are bookkept by `add_edge(i, j, var)`
as `out_terms[i]` and `in_terms[j]`, where an active edge `(i, j)` prints as
`j -> i` (item `j` is **given**, item `i` is **received**). Consequently:

- `in_terms[item]`  = swap edges where the item is **given** (supply leaving its
  owner), including combo and hub out-spokes.
- `out_terms[item]` = swap edges where the item is **received** (demand).
- `spend_swap[user]` = `(take_iid, var)` legs where `user` **receives** a copy.
- `buy[(user, iid)]` = cash buy var (user receives `iid` for cash).
- `buy_terms[iid]`  = all cash-buy vars for `iid` (the copy sold for cash).

Per-copy invariants already enforced: swap balance `sum(in)==sum(out)`, given at
most once `sum(in) <= 1`, and the seller slot `sum(out) + sum(buys) <= 1`. So a
copy leaves its owner at most once total, via swap **or** cash.

`dupcap` today (receiver side): for each `(user, copies)` group, sum the user's
swap receipts (`spend_swap`) and cash buys (`buy`) over the group and constrain
`<= 1`.

## Design

### Directives & parsing (`parse_file`)

| Directive | Regex | Effect |
|---|---|---|
| `takecap <u> <N> <item...>` | `r'takecap\s+(\S+)\s+(\d+)\s+(.+)'` | `take_groups.append((u, N, [ids]))` |
| `givecap <u> <N> <item...>` | `r'givecap\s+(\S+)\s+(\d+)\s+(.+)'` | `give_groups.append((u, N, [ids]))` |
| `dupcap <u> <item...>` (legacy) | existing `r'dupcap\s+(\S+)\s+(.+)'` | `take_groups.append((u, 1, [ids]))` |

Globals: rename `dup_groups` → `take_groups` (now carrying `N`); add
`give_groups`. Both `users.add(u)` on parse, as `dupcap` does today.

### Take constraint (generalize existing `<=1` loop)

For each `(u, N, iids)` in `take_groups`:

```python
grp = set(iids)
terms = [v for (it, v) in spend_swap.get(u, []) if it in grp]
terms += [buy[(u, it)] for it in grp if (u, it) in buy]
if len(terms) > N:                      # skip vacuous rows
    model.addConstr(gp.quicksum(terms) <= N)
```

`N=1` reproduces `dupcap` exactly (the `> 1` skip becomes `> N`).

### Give constraint (new mirror)

Built after the take loop, in the same constraint-building phase where the
`owner` map is complete. For each `(u, N, iids)` in `give_groups`:

```python
grp = set(iids)
for it in grp:                          # ownership validation
    if owner.get(it) != u:
        raise ValueError(
            f"givecap user '{u}' lists item '{id_to_item[it]}' "
            f"owned by '{owner.get(it)}'")
terms = []
for it in grp:
    terms += in_terms.get(it, [])       # given via swap (incl. combo/hub out-spokes)
    terms += buy_terms.get(it, [])      # sold for cash
if len(terms) > N:
    model.addConstr(gp.quicksum(terms) <= N)
```

Counting `buy_terms` is required, not optional: without it a copy could leave via
a combo swap **and** be sold standalone for cash — the same physical item gone
twice. The seller-slot/balance invariants make `sum(in_terms[it]) +
sum(buy_terms[it])` the 0/1 indicator "item `it` left its owner", so the group
sum is the number of listed copies given, bounded by `N`.

Ownership validation raises on `owner.get(it) != u` (including unset owner),
mirroring the `set_owner` conflict error — catches typos and prevents silently
capping another user's give-edges.

### Hub compaction — unchanged behavior

The hub builds `_dup_sets` from the cap groups. Source it from `take_groups`
using frozenset membership only (ignore `N`); the existing "merge the dup-capped
multi-give pattern" win-case detection is unchanged. The cap row it relies on is
now `<= N` instead of `<= 1`; balance (`sum(in)==sum(out)`) plus the `<= N` cap
keep the merged structure correct for `N >= 1`. `givecap` needs no hub-specific
handling: hub out-spokes (`add_edge(_hub, _g, _v)`) already register in
`in_terms[_g]`, so they are counted by the give constraint automatically.

## Testing

New `test_takecap.py`, subprocess style matching `test_dupcap.py`
(no test framework; runs `main.py` on temp input, parses stdout):

1. **takecap N=1 == dupcap** — `BUY_BUY + "takecap alice 1 C1 C2"` → alice ends
   with 1 copy (same fixture/assert as `test_dupcap.py`).
2. **takecap N=2** — three copies of a game alice can acquire, `takecap alice 2
   ...` → alice ends with 2.
3. **givecap N=1 (swap)** — `u` owns `A`, `B`, both wanted by other users;
   without cap both leave; with `givecap u 1 A B` exactly one of `A`,`B` is given.
4. **givecap counts cash sale** — `u` owns `A` (cash-sellable) and `B` (swap-
   wanted); `givecap u 1 A B` → selling `A` for cash blocks giving `B` (total
   gives = 1).
5. **givecap bad owner raises** — `givecap u 1 X` where `X` is owned by someone
   else → `main.py` exits non-zero (ValueError).

`test_dupcap.py` is left unchanged and must stay green (legacy-alias proof).

## Docs

`README.md`: rename the "Duplicate cap" section to "Take / give caps",
documenting `takecap`, `givecap`, and the `dupcap` alias; update the Features
bullet and the "How it works" `dupcap` bullet to cover both sides.

## Files

- `Pareto/main.py` — parsing, `take_groups`/`give_groups`, generalized take
  constraint, new give constraint, hub sources `take_groups`.
- `Pareto/test_takecap.py` — new.
- `Pareto/README.md` — doc update.

## Out of scope

- Platform export / UI for caps (#5), combos (#12), per-copy price tuning.
- Emporium `external_solver.py` (still emits `dupcap`; covered by the alias).
```
