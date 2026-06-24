# My Wants Builder — Visual Rework + Grid Ask (#4, #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the visual My-Wants view a clean thumbnail picture with per-game ×-remove (no text list / add-want field), and show the seller ask next to the bid in the grid.

**Architecture:** Frontend-only edits to `MyWantsPage.tsx` — rewrite `VisualMode` (bigger thumbnails + × overlay, drop chip list + add-want picker) and extend `GridMode` (load listings → per-row minimum `resolved_ask` shown beside the bid).

**Tech Stack:** React 19 + TS + react-query. No test runner — verify `npm run build` + `npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx` (exit 0) + manual checklist. Repo `npm run lint` fails only on pre-existing `CopyForm.tsx:15` — ignore.

**Spec:** `docs/superpowers/specs/2026-06-23-mywants-builder-design.md`

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/mywants-builder
```

Expected: `Switched to a new branch 'feat/mywants-builder'`

---

### Task 1: Visual-mode rework (#4)

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Replace the `VisualMode` function**

In `frontend/src/features/trades/MyWantsPage.tsx`, replace the **entire** `VisualMode` function (from `function VisualMode({ myListings, editor }: VisualModeProps) {` through its closing `}` immediately before the `// ===… Grid mode …` divider comment) with:

```tsx
function VisualMode({ myListings, editor }: VisualModeProps) {
  if (myListings.length === 0) return null

  return (
    <div className="space-y-3">
      {myListings.map((listing) => {
        const groups = groupTargetsByGame(editor.targets)
        const myWants = groups.filter((g) => groupIsOn(editor, listing.id, g))
        return (
          <div key={listing.id} className="rounded-xl border border-ink/15 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{listing.board_game_name}</p>
                <p className="font-mono text-xs text-moss/70">{listing.listing_code}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                wants {myWants.length}
              </span>
            </div>

            {/* Give → receive: offered copy, then the wanted games as big thumbnails (× to remove). */}
            <div className="flex items-center gap-3 overflow-x-auto">
              <GameThumb
                src={listing.board_game_thumbnail}
                alt={listing.board_game_name ?? ''}
                className="h-16 w-16 shrink-0"
              />
              <svg className="h-5 w-5 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {myWants.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {myWants.map((g) => (
                    <div key={g.gameId} className="relative shrink-0">
                      <GameThumb src={g.thumbnail} alt={g.gameName ?? ''} className="h-16 w-16" />
                      <button
                        type="button"
                        onClick={() => groupKeys(g).forEach((k) => editor.toggle(listing.id, k, false))}
                        aria-label={`Remove ${g.gameName}`}
                        title={`Remove ${g.gameName}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-ink bg-white text-xs font-bold text-red-600 shadow-sm hover:bg-red-50"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-moss/70">No wants yet — add games in the Catalog view.</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

This drops the `addingFor` state, the text-chip list, and the inline "+ Add want"
picker; enlarges thumbnails to `h-16 w-16`; and puts a × on each wanted-game
thumbnail that removes that game from the listing's wish via the existing
`groupKeys`/`editor.toggle(..., false)` mechanism.

- [ ] **Step 2: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors. (If `toggleGroup` or other helpers become unused
*only* because they were used solely by the old VisualMode, the build/lint will
flag them — but they are also used by `GridMode`, so they stay. Do not remove
shared helpers.)

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 3: Manual QA checklist**

- Visual view: each item shows its offered-copy thumbnail → arrow → larger
  wanted-game thumbnails; no text chip list and no "+ Add want" field.
- Clicking a wanted thumbnail's × removes that game from the item's wish (the
  "wants N" count + thumbnails update); the save bar appears; Save persists.
- Empty item shows "No wants yet — add games in the Catalog view."
- Adding wants still works from the Catalog view.

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(mywants): visual view — big thumbnails + ×-remove, drop chip list & add-want field"
```

---

### Task 2: Grid ask column (#6)

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Load listings + build an ask map in `GridMode`**

In `GridMode`, just after the `expanded` state setup (the `const [expanded, setExpanded] = useState…` + `toggleExpand` block) and before the `if (editor.targets.length === 0)` guard, add:

```tsx
  const { data: listingsData } = useEventListings(slug, { page_size: 500 })
  const askByListing = useMemo(() => {
    const m = new Map<number, number>()
    for (const el of listingsData?.results ?? []) {
      if (el.resolved_ask != null && el.resolved_ask !== '') m.set(el.id, Number(el.resolved_ask))
    }
    return m
  }, [listingsData])
```

(`useEventListings` and `useMemo` are already imported in this file.)

- [ ] **Step 2: Compute the per-row minimum ask**

In the row map `groupTargetsByGame(editor.targets).map((g) => {`, after the
existing `const specific = g.copyTargets.length > 0` line, add:

```tsx
            const askValues = g.copyTargets
              .map((t) => askByListing.get(t.listingId))
              .filter((v): v is number => v != null)
            const minAsk = askValues.length ? Math.min(...askValues) : null
```

- [ ] **Step 3: Show the ask beside the bid in the row header**

The row header `<th>` has the money bid input block:

```tsx
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
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

Add the ask line directly after that block (still inside the `<th>`, after the
closing `)}`):

```tsx
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
                      <div className="mt-0.5 text-xs text-moss/70">
                        ask: {minAsk != null ? `$${minAsk.toFixed(2)}` : '—'}
                      </div>
                    )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 5: Manual QA checklist**

- On a money-enabled event's grid: each wanted-game row header shows the bid
  input AND an `ask: $X` line (the cheapest available copy's ask), or `ask: —`
  when no copy is priced (barter).
- Combo rows (no per-game price) show neither the bid input nor an ask line.
- Non-money events: no bid/ask shown (unchanged).

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(mywants): grid — show seller ask beside the bid per wanted game"
```

---

## Self-Review

**Spec coverage:**
- #4 visual: bigger thumbnails, × per wanted thumbnail removes the game, drop
  text chip list + add-want picker, empty-state points to Catalog → Task 1 ✔
- #6 grid: per-row minimum `resolved_ask` shown beside the bid, money-only,
  combo rows excluded → Task 2 ✔
- Verify build + lint + manual → both tasks ✔

**Placeholder scan:** none.

**Type/name consistency:** `VisualMode({ myListings, editor }: VisualModeProps)`
keeps its existing signature (drops only the internal `addingFor` state);
`groupTargetsByGame`/`groupIsOn`/`groupKeys`/`editor.toggle`/`GameThumb` are
existing exports used as before; `GridMode` adds `askByListing` (Map<number,number>)
+ `minAsk`, using `useEventListings`/`useMemo`/`COMBO_GAME_OFFSET`/`g.copyTargets`
already present; `EventListing.resolved_ask` is `string | null` on the listings API.

**Notes for the executor:**
- Task 1 replaces the whole `VisualMode` function — confirm the old body
  (including the `addingFor` `useState` and the add-want/chip-list JSX) is fully
  gone and nothing else references `addingFor`.
- `g.gameId` is the React key for wanted thumbnails in VisualMode; each game
  appears once per listing card (groups are unique by game), so keys are stable.
