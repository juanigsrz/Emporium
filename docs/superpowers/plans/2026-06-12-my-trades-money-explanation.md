# My Trades — Explainable Money + Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the My Trades "Payments" block (which only reflects pure cash buys) with an item-level money breakdown ("you sold/bought X for $Y, net $Z") plus the minimal settlement transfers the user must actually make.

**Architecture:** The backend already stores one `TradeAssignment` per moved item and can resolve each item's ask (`resolve_ask`). In money mode the solver charges that ask on every priced move (swap leg or cash buy), so per-user net = Σ(received asks) − Σ(given asks) = the solver's own `Cash Summary` net. We freeze each item's value on the assignment (`item_value`), parse the solver's already-printed `Settlement plan` into `result["settlement"]`, and cross-check the reconstruction against the solver's `Cash Summary` (hard-fail on mismatch). The FE renders the breakdown from assignments and the transfers from `result.settlement`.

**Tech Stack:** Django REST Framework (backend), React + TypeScript + TanStack Query (frontend). Solver = external FastTradeMaximizer (`gurobi`), unchanged.

**Spec:** `docs/superpowers/specs/2026-06-12-my-trades-money-explanation-design.md`

**Test commands:**
- Backend: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 2`
- Frontend: `cd frontend && npm run build && npm run lint`

---

### Task 1: Add `item_value` to TradeAssignment

**Files:**
- Modify: `backend/matching/models.py:88` (after `cash_amount`)
- Migration: generated under `backend/matching/migrations/`
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing test**

Add this method inside the existing `class UploadXToYTests(MatchingTestBase):` in `backend/matching/test_external_solver.py`:

```python
    def test_trade_assignment_has_item_value_field(self):
        f = TradeAssignment._meta.get_field("item_value")
        self.assertTrue(f.null)
        self.assertEqual(f.max_digits, 10)
        self.assertEqual(f.decimal_places, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.UploadXToYTests.test_trade_assignment_has_item_value_field -v 2`
Expected: FAIL — `FieldDoesNotExist: TradeAssignment has no field named 'item_value'`

- [ ] **Step 3: Add the field**

In `backend/matching/models.py`, immediately after the `cash_amount` field (line 88):

```python
    # Money that moves with this item = its ask. Set for BOTH swap legs and cash
    # buys (cash buys reuse the parsed Cash Purchases amount). null = unpriced /
    # barter-only. Frozen at solve time, like cash_amount.
    item_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend && venv/bin/python manage.py makemigrations matching`
Expected: `Migrations for 'matching': ... Add field item_value to tradeassignment`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.UploadXToYTests.test_trade_assignment_has_item_value_field -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/models.py backend/matching/migrations/ backend/matching/test_external_solver.py
git commit -m "feat(matching): add TradeAssignment.item_value (frozen item ask)"
```

---

### Task 2: `parse_gurobi_cash_summary` parser

Parses the solver's `Cash Summary:` section into `{username: net_cents}`, used only to cross-check the per-item reconstruction in Task 4.

**Files:**
- Modify: `backend/matching/external_solver.py` (after `parse_gurobi_cash`, ~line 465)
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing test**

Add a new test class at the end of `backend/matching/test_external_solver.py`:

```python
class MoneyParserTests(MatchingTestBase):

    def test_parse_cash_summary_signed_nets(self):
        out = (
            "Cash Summary:\n"
            "  alice: spent $3000, earned $2000, net $1000 (owes) (cap $inf)\n"
            "  bob: spent $2000, earned $3000, net $-1000 (receives) (cap $inf)\n"
            "\nSettlement plan:\n  alice pays bob $1000\n"
        )
        nets = external_solver.parse_gurobi_cash_summary(out)
        self.assertEqual(nets, {"alice": 1000, "bob": -1000})

    def test_parse_cash_summary_tolerates_missing_direction(self):
        # Hand-written fixtures omit the "(owes)" word; parser must not require it.
        out = "Cash Summary:\n  bob: spent $500, earned $0, net $500 (cap $inf)\n"
        self.assertEqual(external_solver.parse_gurobi_cash_summary(out), {"bob": 500})

    def test_parse_cash_summary_absent_section(self):
        self.assertEqual(external_solver.parse_gurobi_cash_summary("Trade Results:\nX -> Y\n"), {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneyParserTests -v 2`
Expected: FAIL — `AttributeError: module 'matching.external_solver' has no attribute 'parse_gurobi_cash_summary'`

- [ ] **Step 3: Implement the parser**

In `backend/matching/external_solver.py`, after `parse_gurobi_cash` (just before `_assign_components`, around line 466):

```python
_CASH_SUMMARY_LINE = re.compile(
    r"^(\S+):\s+spent\s+\$-?\d+,\s+earned\s+\$-?\d+,\s+net\s+\$(-?\d+)\b"
)


def parse_gurobi_cash_summary(output: str):
    """gurobi `Cash Summary:` section -> {username: net_cents}.

    Line form: `  <user>: spent $A, earned $B, net $N ...` with amounts in integer
    cents (net may be negative). The trailing `(direction)`/`(cap ...)` are ignored.
    Used only to cross-check the per-item money reconstruction in load_solution.
    """
    nets = {}
    in_summary = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Cash Summary"):
            in_summary = True
            continue
        if line.startswith("Payments") or line.startswith("Settlement plan"):
            break
        if not in_summary or not line:
            continue
        m = _CASH_SUMMARY_LINE.match(line)
        if m:
            nets[m.group(1)] = int(m.group(2))
    return nets
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneyParserTests -v 2`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat(matching): parse gurobi Cash Summary nets"
```

---

### Task 3: `parse_gurobi_settlement` parser

Parses the solver's `Settlement plan:` section (the minimal-transfer plan) into `[(from_user, to_user, amount_cents)]`.

**Files:**
- Modify: `backend/matching/external_solver.py` (after `parse_gurobi_cash_summary`)
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing test**

Add these methods to the `MoneyParserTests` class from Task 2:

```python
    def test_parse_settlement_transfers(self):
        out = (
            "Cash Summary:\n  alice: spent $1000, earned $0, net $1000 (cap $inf)\n"
            "\nSettlement plan:\n"
            "  alice pays bob $700\n"
            "  alice pays carol $300\n"
        )
        self.assertEqual(
            external_solver.parse_gurobi_settlement(out),
            [("alice", "bob", 700), ("alice", "carol", 300)],
        )

    def test_parse_settlement_absent_section(self):
        self.assertEqual(external_solver.parse_gurobi_settlement("Trade Results:\nX -> Y\n"), [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneyParserTests.test_parse_settlement_transfers -v 2`
Expected: FAIL — `AttributeError: ... has no attribute 'parse_gurobi_settlement'`

- [ ] **Step 3: Implement the parser**

In `backend/matching/external_solver.py`, immediately after `parse_gurobi_cash_summary`:

```python
_SETTLEMENT_LINE = re.compile(r"^(\S+)\s+pays\s+(\S+)\s+\$(\d+)$")


def parse_gurobi_settlement(output: str):
    """gurobi `Settlement plan:` section -> [(from_user, to_user, amount_cents), ...].

    Line form: `  <from> pays <to> $<cents>`. The minimal-transfer settlement; the
    section runs to end of output. Amounts are integer cents.
    """
    transfers = []
    in_plan = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Settlement plan"):
            in_plan = True
            continue
        if not in_plan or not line:
            continue
        m = _SETTLEMENT_LINE.match(line)
        if m:
            transfers.append((m.group(1), m.group(2), int(m.group(3))))
    return transfers
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneyParserTests -v 2`
Expected: PASS (5 tests total in the class)

- [ ] **Step 5: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat(matching): parse gurobi Settlement plan transfers"
```

---

### Task 4: Wire item_value + settlement + validation into `load_solution`

Set `item_value` on every assignment, build `result["settlement"]`, and hard-fail when the per-item reconstruction disagrees with the solver's `Cash Summary`.

**Files:**
- Modify: `backend/matching/external_solver.py:558-616` (the `rows` build, `result` dict, and `bulk_create`)
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing tests**

Add a new test class at the end of `backend/matching/test_external_solver.py`. It sets asks on the two swapped listings and uploads a consistent money solution:

```python
class MoneySettlementUploadTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
        cls.event.money_enabled = True
        cls.event.save(update_fields=["matching_mode", "money_enabled"])
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)
        # alice's brass ask $20, bob's terra ask $30
        cls.el_a1.sell_price = 20
        cls.el_a1.save(update_fields=["sell_price"])
        cls.el_b1.sell_price = 30
        cls.el_b1.save(update_fields=["sell_price"])

    def _money_solution(self, alice_net=1000):
        a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
        bob_net = -alice_net
        return (
            f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"
            f"\nCash Summary:\n"
            f"  {self.user_a.username}: spent $3000, earned $2000, net ${alice_net} (cap $inf)\n"
            f"  {self.user_b.username}: spent $2000, earned $3000, net ${bob_net} (cap $inf)\n"
            f"\nSettlement plan:\n"
            f"  {self.user_a.username} pays {self.user_b.username} $1000\n"
        )

    def test_item_value_set_on_swap_legs(self):
        from decimal import Decimal
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(), content_type="text/plain"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        run = MatchRun.objects.get(pk=resp.data["id"])
        a1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_a1)
        b1_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_b1)
        self.assertEqual(a1_row.item_value, Decimal("20.00"))
        self.assertEqual(b1_row.item_value, Decimal("30.00"))

    def test_settlement_in_result(self):
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(), content_type="text/plain"
        )
        run = MatchRun.objects.get(pk=resp.data["id"])
        self.assertEqual(
            run.result["settlement"],
            [{"from_user": self.user_a.username, "to_user": self.user_b.username, "amount": "10.00"}],
        )

    def test_reconstruction_mismatch_rejected(self):
        # Cash Summary claims alice owes $99.99 but the items reconstruct to $10 -> 400.
        resp = self.client.post(
            upload_url(self.slug), data=self._money_solution(alice_net=9999),
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MatchRun.objects.filter(status=MatchRun.Status.DONE).count(), 0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneySettlementUploadTests -v 2`
Expected: FAIL — `KeyError: 'settlement'` / `item_value` is `None` (not yet populated).

- [ ] **Step 3: Update the `rows` build**

In `backend/matching/external_solver.py`, replace the rows-build block (currently lines 558-562):

```python
    rows = []  # (moved_el, giver, receiver, cycle_id, wish_id, cash_amount)
    for moved_el, giver, receiver, group in resolved:
        wid = _match_wish(wish_index, receiver.id, moved_el.copy.listing_code)
        amt = cash_by_listing.get(moved_el.id)
        rows.append((moved_el, giver, receiver, (group or 0) + 1, wid, amt))
```

with:

```python
    from trades.pricing import resolve_ask

    rows = []  # (moved_el, giver, receiver, cycle_id, wish_id, cash_amount, item_value)
    for moved_el, giver, receiver, group in resolved:
        wid = _match_wish(wish_index, receiver.id, moved_el.copy.listing_code)
        amt = cash_by_listing.get(moved_el.id)
        # item_value = the money on this item: the parsed cash-buy amount when present
        # (authoritative, from the solver), else the resolved ask for a swap leg.
        val = amt if amt is not None else resolve_ask(moved_el)
        rows.append((moved_el, giver, receiver, (group or 0) + 1, wid, amt, val))
```

- [ ] **Step 4: Update the cycles unpacking**

In the same file, the cycles loop currently reads (line ~565):

```python
    cycles = defaultdict(list)
    for moved_el, giver, receiver, cid, wid, amt in rows:
```

Change the loop header to unpack the new 7-tuple (the body is unchanged):

```python
    cycles = defaultdict(list)
    for moved_el, giver, receiver, cid, wid, amt, val in rows:
```

- [ ] **Step 5: Add settlement parsing + reconstruction guard**

In the same file, immediately after the `cycle_list = [...]` comprehension (around line 577, before `active_wishes = _active_wishes(event)`), insert:

```python
    # Money cross-check + settlement plan (XTOY money mode only). Reconstruct each
    # user's net from item_value (received - given) and require it to equal the
    # solver's Cash Summary net; a mismatch means stale prices or a parse error, so
    # fail loudly rather than ship wrong money.
    settlement = []
    if event.matching_mode == TradeEvent.MatchingMode.XTOY:
        summary_net = parse_gurobi_cash_summary(raw_output)
        if summary_net:
            recon = defaultdict(int)  # username -> net cents (received - given)
            for moved_el, giver, receiver, cid, wid, amt, val in rows:
                if val:
                    cents = _to_cents(val)
                    recon[receiver.username] += cents
                    recon[giver.username] -= cents
            for username, net_cents in summary_net.items():
                if recon.get(username, 0) != net_cents:
                    raise ValueError(
                        f"Money reconstruction mismatch for {username!r}: "
                        f"reconstructed {recon.get(username, 0)}c != solver {net_cents}c"
                    )
        for from_u, to_u, cents in parse_gurobi_settlement(raw_output):
            settlement.append({
                "from_user": from_u,
                "to_user": to_u,
                "amount": str((Decimal(cents) / 100).quantize(Decimal("0.01"))),
            })
```

- [ ] **Step 6: Add `settlement` to the result dict**

In the `result = {...}` literal (around line 587), add a `settlement` key after `"unmatched": unmatched,`:

```python
        "unmatched": unmatched,
        "settlement": settlement,
```

- [ ] **Step 7: Set `item_value` in bulk_create**

The `TradeAssignment.objects.bulk_create([...])` comprehension currently unpacks `for moved_el, giver, receiver, cid, wid, amt in rows`. Update it to unpack `val` and pass `item_value`:

```python
    TradeAssignment.objects.bulk_create([
        TradeAssignment(
            match_run=match_run,
            event_listing=moved_el,
            giver=giver,
            receiver=receiver,
            wish_id=wid,
            cycle_id=cid,
            cash_amount=amt,
            item_value=val,
        )
        for moved_el, giver, receiver, cid, wid, amt, val in rows
    ])
```

- [ ] **Step 8: Run the new tests + the full money/upload suite**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 2`
Expected: PASS — new `MoneySettlementUploadTests` (3) pass, and the pre-existing `UploadXToYTests` (incl. `test_upload_with_cash_purchase_creates_assignment`, `test_upload_result_schema_parity`) still pass.

- [ ] **Step 9: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat(matching): set item_value, parse settlement, validate money in load_solution"
```

---

### Task 5: Expose `item_value` in the serializer

**Files:**
- Modify: `backend/matching/serializers.py:117`
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing test**

Add to the `MoneySettlementUploadTests` class:

```python
    def test_serializer_exposes_item_value(self):
        from matching.serializers import TradeAssignmentSerializer
        self.assertIn("item_value", TradeAssignmentSerializer().fields)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneySettlementUploadTests.test_serializer_exposes_item_value -v 2`
Expected: FAIL — `AssertionError: 'item_value' not found in ...`

- [ ] **Step 3: Add the field**

In `backend/matching/serializers.py`, in the `TradeAssignmentSerializer.Meta.fields` list, add `"item_value"` right after `"cash_amount",` (line 117):

```python
            "cash_amount",
            "item_value",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver.MoneySettlementUploadTests.test_serializer_exposes_item_value -v 2`
Expected: PASS

- [ ] **Step 5: Run the whole matching test module**

Run: `cd backend && venv/bin/python manage.py test matching -v 2`
Expected: PASS (no regressions across the matching app)

- [ ] **Step 6: Commit**

```bash
git add backend/matching/serializers.py backend/matching/test_external_solver.py
git commit -m "feat(matching): expose item_value on TradeAssignment serializer"
```

---

### Task 6: Frontend — types, page size, and Payments rebuild

Render the item-level breakdown ("you bought/sold X for $Y, net $Z") from assignments and the settlement transfers from `result.settlement`.

**Files:**
- Modify: `frontend/src/api/matching.ts` (types + `fetchMyAssignments` URL)
- Modify: `frontend/src/features/matching/MatchRunPage.tsx` (`MyTradesSection` signature + Payments block + caller)

- [ ] **Step 1: Add the settlement type, extend `MatchResult` and `TradeAssignment`**

In `frontend/src/api/matching.ts`, add a `SettlementTransfer` interface and a `settlement` field on `MatchResult` (replace the `MatchResult` interface around lines 62-68):

```ts
export interface SettlementTransfer {
  from_user: string
  to_user: string
  amount: string
}

export interface MatchResult {
  algorithm: string
  generated_at: string
  cycles: Cycle[]
  unmatched: UnmatchedWish[]
  stats: MatchStats
  settlement?: SettlementTransfer[]
}
```

Then in the `TradeAssignment` interface, add `item_value` right after `cash_amount` (line 84):

```ts
  cash_amount: string | null
  item_value: string | null
```

- [ ] **Step 2: Request a larger page for `mine/`**

In `frontend/src/api/matching.ts`, change `fetchMyAssignments` (lines 121-126) to request up to the backend max (100) so net/itemization are not truncated at the default 24:

```ts
async function fetchMyAssignments(slug: string, id: number): Promise<PaginatedResponse<TradeAssignment>> {
  const { data } = await apiClient.get<PaginatedResponse<TradeAssignment>>(
    `/events/${slug}/matches/${id}/mine/?page_size=100`
  )
  return data
}
```

- [ ] **Step 3: Pass settlement into `MyTradesSection` and update its signature**

In `frontend/src/features/matching/MatchRunPage.tsx`, import the new type alongside the existing matching imports (find the `import { ... } from '../../api/matching'` block near the top and add `SettlementTransfer` to it). Then update the `MyTradesSection` signature (lines 314-319):

```tsx
function MyTradesSection({
  assignments,
  currentUsername,
  settlement,
}: {
  assignments: TradeAssignment[]
  currentUsername: string
  settlement: SettlementTransfer[]
}) {
```

And update the caller (line 1000):

```tsx
              <MyTradesSection
                assignments={mineData?.results ?? []}
                currentUsername={currentUsername}
                settlement={result?.settlement ?? []}
              />
```

- [ ] **Step 4: Replace the Payments block**

In `frontend/src/features/matching/MatchRunPage.tsx`, replace the entire current Payments IIFE (the block from the comment `{/* Payments group — only rendered when at least one cash trade exists */}` through its closing `})()}` — lines 402-479) with:

```tsx
      {/* Payments — item-level breakdown (the "why") + settlement transfers (the "what to do") */}
      {(() => {
        const bought = assignments.filter(
          (a) => a.item_value != null && a.receiver_username === currentUsername
        )
        const sold = assignments.filter(
          (a) => a.item_value != null && a.giver_username === currentUsername
        )
        const myTransfers = settlement.filter(
          (t) => t.from_user === currentUsername || t.to_user === currentUsername
        )
        if (bought.length === 0 && sold.length === 0 && myTransfers.length === 0) return null

        const boughtTotal = bought.reduce((s, a) => s + Number(a.item_value), 0)
        const soldTotal = sold.reduce((s, a) => s + Number(a.item_value), 0)
        const net = boughtTotal - soldTotal // > 0 => you owe

        return (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
              Payments
            </p>

            {bought.map((a) => (
              <div key={`buy-${a.id}`} className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-900">
                  You bought <span className="font-semibold">{a.board_game_name}</span> for{' '}
                  <span className="font-semibold">${a.item_value}</span> from{' '}
                  <Link to={`/u/${a.giver_username}`} className="font-semibold text-indigo-500 hover:underline">
                    {a.giver_username}
                  </Link>
                </p>
                <p className="text-xs text-gray-400 font-mono">{a.listing_code}</p>
              </div>
            ))}

            {sold.map((a) => (
              <div key={`sell-${a.id}`} className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-900">
                  You sold <span className="font-semibold">{a.board_game_name}</span> for{' '}
                  <span className="font-semibold">${a.item_value}</span> to{' '}
                  <Link to={`/u/${a.receiver_username}`} className="font-semibold text-indigo-500 hover:underline">
                    {a.receiver_username}
                  </Link>
                </p>
                <p className="text-xs text-gray-400 font-mono">{a.listing_code}</p>
              </div>
            ))}

            {/* Net balance — the "why" */}
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              {net > 0 ? (
                <span>Net balance: <strong className="text-red-700">you owe ${net.toFixed(2)}</strong></span>
              ) : net < 0 ? (
                <span>Net balance: <strong className="text-emerald-700">you're owed ${(-net).toFixed(2)}</strong></span>
              ) : (
                <span>Net balance: <strong>even</strong></span>
              )}
            </div>

            {/* Settlement — what to actually do */}
            {myTransfers.length > 0 && (
              <>
                <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide pt-1">
                  Settlement
                </p>
                {myTransfers.map((t, i) => (
                  <div key={`pay-${i}`} className="rounded-lg border border-gray-200 bg-white p-4">
                    {t.from_user === currentUsername ? (
                      <p className="text-sm text-gray-900">
                        Pay{' '}
                        <Link to={`/u/${t.to_user}`} className="font-semibold text-indigo-500 hover:underline">
                          {t.to_user}
                        </Link>{' '}
                        <span className="font-semibold">${t.amount}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-900">
                        Receive <span className="font-semibold">${t.amount}</span> from{' '}
                        <Link to={`/u/${t.from_user}`} className="font-semibold text-indigo-500 hover:underline">
                          {t.from_user}
                        </Link>
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )
      })()}
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds (no TS errors — confirms `item_value`/`settlement`/`SettlementTransfer` line up and the old `cash_amount`-based Payments code is fully removed), lint clean.

- [ ] **Step 6: Manual verification**

Confirm against a money-enabled XTOY run (or by temporarily seeding `result.settlement` + assignment `item_value` in the API response) that the My Trades tab shows: per-item "You bought/sold … for $… from/to …" lines, a "Net balance: you owe/you're owed $…" row, and a "Settlement" section listing the transfers for the current user only. Barter-only runs show no Payments block.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/matching.ts frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(matching): My Trades item-level money breakdown + settlement transfers"
```

---

## Self-Review Notes

- **Spec coverage:** item_value field (Task 1); settlement + Cash Summary parsers (Tasks 2-3); load_solution wiring, hard-fail validation, `result["settlement"]`, barter-only no-op (Task 4); serializer field (Task 5); FE types, `page_size=100`, Payments rebuild with net + settlement (Task 6). All spec sections mapped.
- **Backward compatibility:** `cash_amount` untouched; `item_value` for cash buys reuses the parsed amount, so the existing `test_upload_with_cash_purchase_creates_assignment` (cash buy on an ask-less listing) reconstructs consistently (recon picks up the cash-buy cents, summary lists only that user). Pure-barter and ONETOONE runs hit `summary_net == {}` and `settlement == []` — no behavior change beyond an empty `settlement` key in result (parity tests use `assertIn`, so they still pass).
- **Type consistency:** `parse_gurobi_cash_summary` → `{username: int_cents}`; `parse_gurobi_settlement` → `[(from, to, int_cents)]`; `result["settlement"]` items `{from_user, to_user, amount}` match the FE `SettlementTransfer` interface exactly; `rows` is a 7-tuple consistently at every unpack site (build, cycles loop, validation loop, bulk_create).
