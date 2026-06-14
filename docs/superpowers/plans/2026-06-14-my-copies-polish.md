# My Copies Polish Implementation Plan

> **For agentic workers:** Single-file presentational refactor. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add cover thumbnails to the add-copy flow, render copies as a responsive card grid, and regroup the BGG import controls into two labeled sub-cards.

**Architecture:** All changes in `frontend/src/features/copies/MyCopiesPage.tsx`. C1 extends the local `picked` state with a `thumbnail` field and renders `GameThumb`; C2 swaps the list container + card + skeleton to a grid; C3 splits the import row into two sub-cards. No logic, API, or `CopyForm.tsx` changes.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS.

**Testing note:** Presentational only; no frontend test runner in repo. Gate = `npm run build` + `npm run lint` (no new warnings) + manual checks.

---

### Task 1: C1 — covers in the add-copy flow

**Files:** Modify `frontend/src/features/copies/MyCopiesPage.tsx` (`AddCopyModal`).

- [ ] **Step 1: Extend `picked` state type** (~line 520)

Replace:
```tsx
  const [picked, setPicked] = useState<{ bgg_id: number; name: string } | null>(null)
```
With:
```tsx
  const [picked, setPicked] = useState<{ bgg_id: number; name: string; thumbnail: string } | null>(null)
```

- [ ] **Step 2: Thumbnail + relayout in search results** (~lines 572–584)

Replace:
```tsx
                  {results.map((g) => (
                    <li key={g.bgg_id}>
                      <button
                        type="button"
                        onClick={() => setPicked({ bgg_id: g.bgg_id, name: g.name })}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sage/30"
                      >
                        <span className="truncate text-ink">{g.name}</span>
                        <span className="shrink-0 text-xs text-moss/70">{g.year_published ?? ''}</span>
                      </button>
                    </li>
                  ))}
```
With:
```tsx
                  {results.map((g) => (
                    <li key={g.bgg_id}>
                      <button
                        type="button"
                        onClick={() => setPicked({ bgg_id: g.bgg_id, name: g.name, thumbnail: g.thumbnail })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sage/30"
                      >
                        <GameThumb src={g.thumbnail} alt={g.name} className="h-8 w-8" />
                        <span className="flex-1 truncate text-ink">{g.name}</span>
                        <span className="shrink-0 text-xs text-moss/70">{g.year_published ?? ''}</span>
                      </button>
                    </li>
                  ))}
```

- [ ] **Step 3: Thumbnail in picked-game chip** (~line 589)

Replace:
```tsx
              <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-ink/15 bg-sage/30 px-3 py-2">
                <span className="text-sm font-semibold text-ink">{picked.name}</span>
```
With:
```tsx
              <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-ink/15 bg-sage/30 px-3 py-2">
                <GameThumb src={picked.thumbnail} alt={picked.name} className="h-8 w-8" />
                <span className="text-sm font-semibold text-ink">{picked.name}</span>
```

---

### Task 2: C2 — card grid for browse + skeleton

**Files:** Modify `frontend/src/features/copies/MyCopiesPage.tsx`.

- [ ] **Step 1: Grid container** (~line 732)

Replace:
```tsx
        <div className="rounded-3xl border-2 border-ink bg-cream overflow-hidden shadow-card">
          {filtered.map((copy) => (
            <MyCopyCard key={copy.id} copy={copy} rmap={rmap} />
          ))}
        </div>
```
With:
```tsx
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((copy) => (
            <MyCopyCard key={copy.id} copy={copy} rmap={rmap} />
          ))}
        </div>
```

- [ ] **Step 2: `MyCopyCard` outer div** (~line 244)

Replace:
```tsx
      <div className={`p-4 border-b-2 border-ink/10 last:border-0 ${isWithdrawn ? 'opacity-60' : ''}`}>
```
With:
```tsx
      <div className={`flex flex-col rounded-2xl border-2 border-ink/15 bg-cream p-4 shadow-sm ${isWithdrawn ? 'opacity-60' : ''}`}>
```

- [ ] **Step 3: `CopiesSkeleton` grid** (~lines 345–361)

Replace:
```tsx
    <div className="rounded-3xl border-2 border-ink/15 bg-cream divide-y-2 divide-ink/10 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-4 animate-pulse space-y-2">
```
With:
```tsx
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border-2 border-ink/15 bg-cream p-4 animate-pulse space-y-2">
```

---

### Task 3: C3 — two sub-cards in BGG import panel

**Files:** Modify `frontend/src/features/copies/MyCopiesPage.tsx` (`BggImportPanel`).

- [ ] **Step 1: Replace the import controls row** (~lines 446–487)

Replace the entire `<div className="flex flex-wrap gap-3 items-end"> … </div>` block with:
```tsx
      <div className="grid gap-3 sm:grid-cols-2">
        {/* From your collection */}
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-cream/70 p-3">
          <h3 className="text-xs font-bold text-ink">From your collection</h3>
          {!hasBggUsername && (
            <p className="text-xs text-amber-600">
              Set your{' '}
              <a href="/profile" className="font-semibold underline hover:text-amber-800">
                BGG username
              </a>{' '}
              first.
            </p>
          )}
          <button
            onClick={handleOwnedImport}
            disabled={!hasBggUsername || isRunning || startImport.isPending}
            title={!hasBggUsername ? 'Set your BGG username in your profile first.' : undefined}
            className="self-start rounded-2xl border-2 border-ink bg-teal-300 px-3 py-1.5 text-xs font-bold text-teal-950 shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {isRunning ? 'Importing…' : 'Import owned from BGG'}
          </button>
        </div>

        {/* From a geeklist */}
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-cream/70 p-3">
          <h3 className="text-xs font-bold text-ink">From a geeklist</h3>
          <label className="flex flex-col gap-1 text-xs font-medium text-moss">
            Geeklist ID
            <input
              value={geeklistId}
              onChange={(e) => setGeeklistId(e.target.value)}
              placeholder="e.g. 123456"
              className="w-full rounded-xl border-2 border-ink/15 bg-parchment px-2 py-1.5 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </label>
          <button
            onClick={handleGeeklistImport}
            disabled={isRunning || startImport.isPending}
            className="self-start rounded-2xl border-2 border-ink bg-teal-300 px-3 py-1.5 text-xs font-bold text-teal-950 shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {isRunning ? 'Importing…' : 'Import from geeklist'}
          </button>
        </div>
      </div>
```

---

### Task 4: Build, lint, commit

- [ ] **Step 1:** `cd frontend && npm run build` → succeeds.
- [ ] **Step 2:** `cd frontend && npm run lint` → no new warnings (pre-existing `CopyForm.tsx` warning only).
- [ ] **Step 3:** Commit:
```bash
git add frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "feat(copies): add-copy thumbnails, card grid, BGG import sub-cards"
```

---

### Task 5: Manual verification

- [ ] Add a copy → search results show cover thumbnails; picked chip shows the cover.
- [ ] My Copies renders as a 2-col (sm) / 3-col (xl) card grid; withdrawn cards dimmed.
- [ ] Import from BGG shows two labeled sub-cards; both imports still start + report.

---

## Self-Review

- **Spec coverage:** C1 → Task 1 (state + search + chip). C2 → Task 2 (container + card + skeleton). C3 → Task 3. ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `picked` type gains `thumbnail: string`; `setPicked` call passes `thumbnail: g.thumbnail` (`GameListItem.thumbnail` is `string`); chip reads `picked.thumbnail`. ✓
