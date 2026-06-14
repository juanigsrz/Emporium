# Wants Pricing Polish Implementation Plan

> **For agentic workers:** Frontend presentational + guards, backend validator tightening with TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Grid-view per-game price field, hide number-input spin buttons on rating/price fields, and reject prices ≤ 0 on both ask-price fields.

**Architecture:** Frontend changes in `MyWantsPage.tsx`, `EventDetailPage.tsx`, `index.css`. Backend tightens two DRF `validate_*` methods, covered by two new tests. No schema change.

**Tech Stack:** React 18 + TS + Tailwind; Django REST Framework.

**Testing note:** Backend validators use TDD (test first). Frontend is presentational + client guards; gate = build/lint + manual + backend test suite.

---

### Task 1: Backend — reject price ≤ 0 (TDD)

**Files:**
- Modify: `backend/trades/tests_pricing.py`
- Modify: `backend/trades/serializers.py`
- Modify: `backend/events/serializers.py`

- [ ] **Step 1: Add failing tests.** In `trades/tests_pricing.py`, after `test_negative_price_rejected` (the game-prices class) add:
```python
    def test_zero_price_rejected(self):
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "0"}, format="json")
        self.assertEqual(r.status_code, 400)
```
After `test_negative_sell_price_rejected` (the listing class) add:
```python
    def test_zero_sell_price_rejected(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": "0"}, format="json")
        self.assertEqual(r.status_code, 400)
```

- [ ] **Step 2: Run — expect FAIL.**
Run: `cd backend && python manage.py test trades.tests_pricing -v 1`
Expected: 2 failures (status 200/201 instead of 400) because 0 is currently allowed.

- [ ] **Step 3: Tighten validators.** In `trades/serializers.py`:
```python
    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("price must be greater than 0.")
        return value
```
In `events/serializers.py`:
```python
    def validate_sell_price(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("sell_price must be greater than 0.")
        return value
```

- [ ] **Step 4: Run — expect PASS.**
Run: `cd backend && python manage.py test trades events -v 1`
Expected: all pass (new zero tests pass; existing negative + positive tests still pass).

- [ ] **Step 5: Commit.**
```bash
git add backend/trades/tests_pricing.py backend/trades/serializers.py backend/events/serializers.py
git commit -m "feat(pricing): reject ask prices <= 0 (UserGamePrice, sell_price)"
```

---

### Task 2: Frontend — `.no-spinner` utility

**Files:** Modify `frontend/src/index.css`.

- [ ] **Step 1:** Inside the existing `@layer utilities { … }` block, add:
```css
  /* Hide native number-input step arrows on rating/price fields. */
  .no-spinner::-webkit-outer-spin-button,
  .no-spinner::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .no-spinner {
    -moz-appearance: textfield;
    appearance: textfield;
  }
```

---

### Task 3: Frontend — `MyWantsPage` (grid price, spinners, save guard)

**Files:** Modify `frontend/src/features/trades/MyWantsPage.tsx`.

- [ ] **Step 1: Spinner class on `RatingPriceRow` rating input.** In its `className`, prepend `no-spinner `:
```tsx
          className="no-spinner w-14 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
```

- [ ] **Step 2: `RatingPriceRow` price input — spinner + min.** Replace:
```tsx
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceValue}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="—"
            title="One price for every copy of this game: the default ask for copies you own and your bid if you want it"
            className="w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
```
with:
```tsx
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={priceValue}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="—"
            title="One price for every copy of this game: the default ask for copies you own and your bid if you want it"
            className="no-spinner w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
```

- [ ] **Step 3: Min-rating filter — spinner.** On the Min-rating `<input type="number" min={1} max={10} step={0.5} …>` (the filter), prepend `no-spinner ` to its `className`. Locate it by the `value={minRating}` binding.

- [ ] **Step 4: `GridModeProps` gains `moneyEnabled`.** Replace:
```tsx
interface GridModeProps {
  slug: string
  myListings: EventListing[]
  editor: Editor
  username?: string
  ratings: Map<number, number>
}
```
with:
```tsx
interface GridModeProps {
  slug: string
  myListings: EventListing[]
  editor: Editor
  username?: string
  ratings: Map<number, number>
  moneyEnabled: boolean
}
```
And update the signature: `function GridMode({ slug, myListings, editor, username, ratings, moneyEnabled }: GridModeProps) {`.

- [ ] **Step 5: Pass `moneyEnabled` at the call site.** Replace:
```tsx
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} />
```
with:
```tsx
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} />
```

- [ ] **Step 6: Grid row price input.** In `GridMode`, in the row-label `<th>`, after the closing `</span>` of the `flex items-center gap-1.5` block and before the `</th>`, insert:
```tsx
                      {moneyEnabled && g.gameId >= 0 && (
                        <div className="mt-1 flex items-center gap-1 text-xs">
                          <span className="text-moss">$</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={editor.priceForGame(g.gameId)}
                            onChange={(e) => editor.setMoney(g.gameId, e.target.value)}
                            placeholder="price"
                            className="no-spinner w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                      )}
```
(The `<th>` currently contains exactly one `<span className="flex items-center gap-1.5"> … </span>`; insert the block immediately after that span.)

- [ ] **Step 7: Save guard for ≤ 0 prices.** In `handleSave`, immediately after `setSaveError(null)` and before the `try {`, add:
```tsx
    for (const [, value] of editor.changedGamePrices) {
      const raw = (value ?? '').trim()
      if (raw !== '' && Number(raw) <= 0) {
        setSaveError('Price must be greater than $0.')
        return
      }
    }
```

- [ ] **Step 8: Build + lint.**
Run: `cd frontend && npm run build` (succeeds) and `npm run lint` (no new warnings).

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/index.css frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(wants): grid price field, hide rating/price spinners, block price <= 0"
```

---

### Task 4: Frontend — `EventDetailPage` `MyListingCard` (spinner, guard, min)

**Files:** Modify `frontend/src/features/events/EventDetailPage.tsx`.

- [ ] **Step 1: Guard ≤ 0 in `handleSave`.** In `MyListingCard.handleSave`, after `setErr(null)` and before `setSaving(true)`, add:
```tsx
    const trimmed = draft.trim()
    if (trimmed !== '' && Number(trimmed) <= 0) {
      setErr('Price must be greater than $0.')
      return
    }
```
(Then keep using `draft.trim()` / the existing `v` below as-is.)

- [ ] **Step 2: Min. ask input — spinner + min.** On the `MyListingCard` Min. ask `<input type="number" step="0.01" min="0" …>`, change `min="0"` → `min="0.01"` and prepend `no-spinner ` to its `className`:
```tsx
                className="no-spinner w-20 rounded-lg border-2 border-ink/15 bg-cream px-2 py-1 text-xs text-ink placeholder-moss/40 focus:outline-none focus:ring-2 focus:ring-sage"
```

- [ ] **Step 3: Build + lint.**
Run: `cd frontend && npm run build` (succeeds) and `npm run lint` (no new warnings).

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): hide min-ask spinner, block min-ask <= 0"
```

---

### Task 5: Manual verification

- [ ] Grid view (money event): each want-game row shows a `$` price input that saves via the Save bar.
- [ ] Rating + price inputs (almanac, grid, min-rating filter, event Min. ask) show no step arrows.
- [ ] Entering `0` as a per-game price and clicking Save → blocked with "Price must be greater than $0."; same for the event Min. ask.

---

## Self-Review

- **Spec coverage:** F1 grid price → Task 3 (Steps 4–6). F2 spinners → Task 2 + Task 3 (1–3,6) + Task 4 (2). F3 backend → Task 1; frontend guards → Task 3 (7) + Task 4 (1); min attr → Tasks 3/4. ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `GridModeProps.moneyEnabled: boolean` passed `event.money_enabled` (boolean); `editor.priceForGame`/`setMoney` take/return `(number, string)`; `editor.changedGamePrices` is `Map<number, string>`. ✓
