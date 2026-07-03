# Catalog Tab + Enriched Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the catalog (`GameBrowse`) its own default tab and add per-game rating, buy-price, and add-to-want-group controls to its expand dropdown; thread per-game money through the staged save; remove the two BGG buttons (now in Profile).

**Architecture:** Almost entirely in `frontend/src/features/trades/MyWantsPage.tsx`, plus one new hook in `frontend/src/api/ratings.ts`. Per-game money is staged in the existing `useEditor` (a `moneyByGame` map seeded from current want-item amounts) and written in `persistChanges`. Rating set/clear and add-to-want-group persist immediately via their own mutations.

**Tech Stack:** React 18 + TanStack Query v5 + Tailwind. No frontend test harness — verify with `npm run build` (tsc) + `npm run lint` (`--max-warnings 0`). Backend untouched.

**Spec:** `docs/superpowers/specs/2026-06-09-catalog-tab-dropdown-design.md`

**Depends on:** Spec B (the BGG buttons removed here are re-homed in the Profile).

---

## File Structure

- Modify: `frontend/src/api/ratings.ts` — add `useDeleteRating`.
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`:
  - `PageModel` + `buildModel`: add `baseMoneyByGame`.
  - `useEditor` + `Editor` interface: add `moneyByGame` / `setMoney` / `priceForGame`; fold money into `dirtyCount`, `changedListingIds`, `reset`.
  - `persistChanges`: write `money_amount` per item (gated on `money_enabled`).
  - Main page: `ViewMode` adds `'catalog'` (default); 3-tab bar; remove the "Import ratings from BGG" block + its hooks; pass `customWantGroups` + `moneyEnabled` to `GameBrowse`.
  - `GameBrowse`: remove the "Sync BGG wishlist" button + its sync state/hooks; render new `GameCardControls` in the expanded card.
  - New `GameCardControls` component (rating + price + add-to-want-group).

Each task ends with a build/lint gate. Tasks 2–4 all edit `MyWantsPage.tsx`; do them in order.

---

### Task 1: `useDeleteRating` hook

**Files:** Modify `frontend/src/api/ratings.ts`

- [ ] **Step 1: Add the hook**

Append to `frontend/src/api/ratings.ts` (it already imports `useMutation`, `useQueryClient`, `apiClient`):

```ts
export function useDeleteRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/game-ratings/${id}/`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] }),
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/ratings.ts
git commit -m "feat: add useDeleteRating hook"
```

---

### Task 2: Per-game money in the editor + persist

**Files:** Modify `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Add `baseMoneyByGame` to `PageModel`**

Find the `PageModel` interface and add the field:

```ts
interface PageModel {
  /** For each of my listings, the want-group that holds its 1-to-1 want list (if any). */
  wantGroupByListing: Map<number, WantGroup>
  offerGroupByListing: Map<number, OfferGroup>
  /** listingId -> set of target keys currently in its want list (server truth). */
  baseMatrix: Map<number, Set<string>>
  /** All want targets referenced by any of my lists, keyed for dedupe. */
  baseTargets: Map<string, Target>
  /** Canonical gameId -> existing buy-price (money_amount as string), server truth. */
  baseMoneyByGame: Map<number, string>
}
```

- [ ] **Step 2: Populate `baseMoneyByGame` in `buildModel`**

In `buildModel`, add the map declaration next to the others:

```ts
  const wantGroupByListing = new Map<number, WantGroup>()
  const baseMatrix = new Map<number, Set<string>>()
  const baseTargets = new Map<string, Target>()
  const baseMoneyByGame = new Map<number, string>()
```

Inside the `BOARD_GAME` branch, right after `set.add(key)`, record money:

```ts
          if (item.target_type === 'BOARD_GAME' && item.board_game != null) {
            const key = gameTargetKey(item.board_game)
            set.add(key)
            if (item.money_amount != null && !baseMoneyByGame.has(item.board_game)) {
              baseMoneyByGame.set(item.board_game, item.money_amount)
            }
```

Inside the `LISTING` branch, capture the game id and record money (place the money line right after `set.add(key)`):

```ts
          } else if (item.target_type === 'LISTING' && item.event_listing != null) {
            const key = listingTargetKey(item.event_listing)
            set.add(key)
            const lgid = item.board_game_id ?? -item.event_listing
            if (item.money_amount != null && !baseMoneyByGame.has(lgid)) {
              baseMoneyByGame.set(lgid, item.money_amount)
            }
```

Update the return:

```ts
  return { wantGroupByListing, offerGroupByListing, baseMatrix, baseTargets, baseMoneyByGame }
```

- [ ] **Step 3: Extend the `Editor` interface**

```ts
interface Editor {
  /** Targets shown in the UI = base targets + session-added ones. */
  targets: Target[]
  isOn: (listingId: number, targetKey: string) => boolean
  toggle: (listingId: number, targetKey: string, next?: boolean) => void
  addTarget: (t: Target) => void
  /** Current buy-price (string; '' = none) for a canonical game. */
  priceForGame: (gameId: number) => string
  /** Stage a buy-price change for a canonical game. */
  setMoney: (gameId: number, value: string) => void
  dirtyCount: number
  changedListingIds: Set<number>
  reset: () => void
}
```

- [ ] **Step 4: Add money state to `useEditor`**

Add a `moneyByGame` state next to the existing `changes`/`sessionTargets`:

```ts
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map())
  const [sessionTargets, setSessionTargets] = useState<Map<string, Target>>(new Map())
  const [moneyByGame, setMoneyByGame] = useState<Map<number, string>>(new Map())
```

Add `priceForGame` and `setMoney` (place after the `addTarget` callback):

```ts
  const priceForGame = useCallback(
    (gameId: number): string => {
      if (moneyByGame.has(gameId)) return moneyByGame.get(gameId)!
      return model.baseMoneyByGame.get(gameId) ?? ''
    },
    [moneyByGame, model.baseMoneyByGame]
  )

  const setMoney = useCallback(
    (gameId: number, value: string) => {
      setMoneyByGame((prev) => {
        const m = new Map(prev)
        const base = model.baseMoneyByGame.get(gameId) ?? ''
        if (value === base) m.delete(gameId)
        else m.set(gameId, value)
        return m
      })
    },
    [model.baseMoneyByGame]
  )
```

Update `reset` to clear money:

```ts
  const reset = useCallback(() => {
    setChanges(new Map())
    setSessionTargets(new Map())
    setMoneyByGame(new Map())
  }, [])
```

Replace the `changedListingIds` memo so price-only changes mark the owning listings dirty:

```ts
  const changedListingIds = useMemo(() => {
    const s = new Set<number>()
    for (const ck of changes.keys()) s.add(Number(ck.split('::')[0]))
    if (moneyByGame.size > 0) {
      const affectedKeys = new Set<string>()
      for (const t of targets) {
        if (moneyByGame.has(t.gameId)) affectedKeys.add(t.key)
      }
      for (const [listingId] of model.baseMatrix) {
        for (const k of affectedKeys) {
          if (isOn(listingId, k)) {
            s.add(listingId)
            break
          }
        }
      }
    }
    return s
  }, [changes, moneyByGame, targets, model.baseMatrix, isOn])
```

Update the returned `editor` object to include the new members and money-aware dirty count:

```ts
  return {
    editor: {
      targets,
      isOn,
      toggle,
      addTarget,
      priceForGame,
      setMoney,
      dirtyCount: changes.size + moneyByGame.size,
      changedListingIds,
      reset,
    },
    changes,
    sessionTargets,
  }
```

- [ ] **Step 5: Write money in `persistChanges`**

Change the signature to accept `moneyEnabled`:

```ts
async function persistChanges(
  slug: string,
  model: PageModel,
  editor: Editor,
  myListings: EventListing[],
  moneyEnabled: boolean
): Promise<void> {
```

Replace the `items` mapping to attach money per target's game:

```ts
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) => {
      const item: WantGroupItemPayload = {
        target_type: t.type,
        ...(t.type === 'BOARD_GAME'
          ? { board_game: t.boardGameId! }
          : { event_listing: t.listingId! }),
      }
      if (moneyEnabled) {
        const raw = editor.priceForGame(t.gameId).trim()
        item.money_amount = raw === '' ? null : Number(raw)
      }
      return item
    })
```

- [ ] **Step 6: Pass `moneyEnabled` from `handleSave`**

In `MyWantsPage`, update the `persistChanges` call and dependency list:

```ts
  const handleSave = useCallback(async () => {
    if (!slug) return
    setSaving(true)
    setSaveError(null)
    try {
      await persistChanges(slug, model, editor, myListings, event?.money_enabled ?? false)
      invalidateTrades(qc, slug)
      editor.reset()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }, [slug, model, editor, myListings, qc, event?.money_enabled])
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS. (Behavior is unchanged at runtime — `moneyByGame` is empty until the UI in Task 4 sets it.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat: stage per-game buy-price in want editor and persist"
```

---

### Task 3: Catalog tab + remove BGG buttons

**Files:** Modify `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Widen `ViewMode` and default to catalog**

Change:

```ts
type ViewMode = 'visual' | 'grid'
```

to:

```ts
type ViewMode = 'catalog' | 'visual' | 'grid'
```

And change the default:

```ts
  const [view, setView] = useState<ViewMode>('catalog')
```

- [ ] **Step 2: Remove the "Import ratings from BGG" block and its state/hooks**

In `MyWantsPage`, delete this entire block (the ratings-import state + effect):

```ts
  // Ratings import
  const { data: profile } = useMyProfile()
  const startImport = useStartImport()
  const [ratingsJobId, setRatingsJobId] = useState<number | null>(null)
  const [ratingsMsg, setRatingsMsg] = useState<string | null>(null)
  const ratingsJob = useImportJob(ratingsJobId)
  const ratingsImporting = ['PENDING', 'RUNNING'].includes(ratingsJob.data?.status ?? '')
  useEffect(() => {
    if (ratingsJob.data?.status === 'DONE') {
      const matched = ratingsJob.data.summary?.matched ?? 0
      const skipped = ratingsJob.data.summary?.skipped ?? 0
      setRatingsMsg(`Ratings imported! ${matched} matched, ${skipped} skipped.`)
      setRatingsJobId(null)
      qc.invalidateQueries({ queryKey: ['ratings', 'mine'] })
    } else if (ratingsJob.data?.status === 'FAILED') {
      setRatingsMsg('Import failed. Check your BGG username.')
      setRatingsJobId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingsJob.data?.status])
```

And delete the JSX block that renders the import button:

```tsx
          {/* Import ratings from BGG */}
          <div className="flex flex-wrap items-center gap-2">
            {profile?.bgg_username ? (
              <button
                type="button"
                onClick={() => {
                  setRatingsMsg(null)
                  startImport.mutateAsync({ kind: 'RATINGS' }).then((j) => setRatingsJobId(j.id))
                }}
                disabled={ratingsImporting || startImport.isPending}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
              >
                {ratingsImporting ? 'Importing ratings…' : 'Import ratings from BGG'}
              </button>
            ) : (
              <span className="text-xs text-gray-400">
                <Link to="/profile" className="text-indigo-500 hover:underline">Set BGG username</Link>
                {' '}to import ratings
              </span>
            )}
            {ratingsMsg && !ratingsImporting && (
              <span className="text-xs text-green-600">{ratingsMsg}</span>
            )}
          </div>
```

- [ ] **Step 3: Make the tab bar render all three tabs**

Replace the mode-tabs button group:

```tsx
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {(['visual', 'grid'] as ViewMode[]).map((m) => (
```

with:

```tsx
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {(['catalog', 'visual', 'grid'] as ViewMode[]).map((m) => (
```

- [ ] **Step 4: Render `GameBrowse` only under the Catalog tab**

Replace the render block:

```tsx
          <GameBrowse
            slug={slug!}
            editor={editor}
            myListings={myListings}
            username={user?.username}
          />

          {view === 'visual' ? (
            <VisualMode myListings={myListings} editor={editor} />
          ) : (
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} />
          )}
```

with (add `customWantGroups` + `moneyEnabled`, gate by tab):

```tsx
          {view === 'catalog' && (
            <GameBrowse
              slug={slug!}
              editor={editor}
              myListings={myListings}
              username={user?.username}
              customWantGroups={customWantGroups}
              moneyEnabled={event.money_enabled}
            />
          )}
          {view === 'visual' && <VisualMode myListings={myListings} editor={editor} />}
          {view === 'grid' && (
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} />
          )}
```

- [ ] **Step 5: Compute `customWantGroups` in `MyWantsPage`**

Add after the `model` memo (and after `wantGroups` is available):

```ts
  const customWantGroups = useMemo(() => {
    const autoIds = new Set([...model.wantGroupByListing.values()].map((wg) => wg.id))
    return wantGroups.filter((wg) => !autoIds.has(wg.id))
  }, [wantGroups, model.wantGroupByListing])
```

- [ ] **Step 6: Remove the "Sync BGG wishlist" UI + sync state in `GameBrowse`**

In `GameBrowse`, delete the BGG sync state block:

```ts
  // BGG sync state
  const [jobId, setJobId] = useState<number | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const start = useStartImport()
  const job = useImportJob(jobId)
  const { data: profile } = useMyProfile()
  const qc = useQueryClient()

  const syncing = ['PENDING', 'RUNNING'].includes(job.data?.status ?? '')

  // When the import job reaches DONE, invalidate games + profile query keys
  useEffect(() => {
    if (job.data?.status === 'DONE') {
      const matched = job.data.summary?.matched ?? 0
      const skipped = job.data.summary?.skipped ?? 0
      setSyncMessage(`Synced! ${matched} matched, ${skipped} skipped.`)
      setJobId(null)
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.games(slug) })
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
    } else if (job.data?.status === 'FAILED') {
      setSyncMessage('Sync failed. Check your BGG username and try again.')
      setJobId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status])

  function handleSync() {
    setSyncMessage(null)
    start.mutateAsync({ kind: 'WISHLIST' }).then((j) => setJobId(j.id))
  }
```

And delete the sync UI block in the filter bar (the whole `ml-auto` div):

```tsx
        <div className="ml-auto flex items-center gap-2">
          {syncing && (
            <span className="flex items-center gap-1 text-xs text-indigo-500">
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Syncing…
            </span>
          )}
          {syncMessage && !syncing && (
            <span className="text-xs text-green-600">{syncMessage}</span>
          )}
          {profile?.bgg_username ? (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || start.isPending}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
            >
              Sync BGG wishlist
            </button>
          ) : (
            <span className="text-xs text-gray-400">
              <Link to="/profile" className="text-indigo-500 hover:underline">Set BGG username</Link>
              {' '}to sync wishlist
            </span>
          )}
        </div>
```

- [ ] **Step 7: Update `GameBrowseProps` and the function signature**

Find `interface GameBrowseProps` and add two fields:

```ts
interface GameBrowseProps {
  slug: string
  editor: Editor
  myListings: EventListing[]
  username?: string
  customWantGroups: WantGroup[]
  moneyEnabled: boolean
}
```

Update the destructure:

```ts
function GameBrowse({ slug, editor, myListings, username, customWantGroups, moneyEnabled }: GameBrowseProps) {
```

- [ ] **Step 8: Remove now-unused imports**

Run: `cd frontend && npm run lint`
It will flag unused symbols. Remove these (now-unused after Steps 2 & 6): `useStartImport` and `useImportJob` (from `'../../api/bgg'` — delete that import line entirely), `useMyProfile` (from `'../../api/profiles'`), and `EVENTS_KEYS` (from the `'../../api/events'` import — keep `useEvent, useEventListings, useEventGames`). Do NOT remove `useQueryClient` (still used by `MyWantsPage`), `useMyRatings`/`ratingMap` (used by Grid), `useEffect`/`useState`/`useMemo`/`useCallback`, or `Link`.

- [ ] **Step 9: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS, zero warnings.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat: catalog as own default tab; remove BGG buttons from My Wants"
```

---

### Task 4: GameCardControls (rating + price + add-to-want-group)

**Files:** Modify `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Extend the ratings import**

Change the ratings import line:

```ts
import { useMyRatings, ratingMap } from '../../api/ratings'
```

to:

```ts
import { useMyRatings, ratingMap, useSetRating, useDeleteRating } from '../../api/ratings'
```

- [ ] **Step 2: Add the `GameCardControls` component**

Add this component just above `GameBrowse` (after the `BROWSE_PAGE_SIZE` constant / `GameBrowseProps`, before `function GameBrowse`):

```tsx
interface GameCardControlsProps {
  slug: string
  bggId: number
  wanted: boolean
  moneyEnabled: boolean
  priceValue: string
  onPriceChange: (value: string) => void
  customWantGroups: WantGroup[]
}

function GameCardControls({
  slug,
  bggId,
  wanted,
  moneyEnabled,
  priceValue,
  onPriceChange,
  customWantGroups,
}: GameCardControlsProps) {
  const qc = useQueryClient()
  const { data: ratings = [] } = useMyRatings()
  const setRating = useSetRating()
  const delRating = useDeleteRating()
  const rating = ratings.find((r) => r.board_game === bggId)

  const [ratingInput, setRatingInput] = useState<string>(rating ? String(Number(rating.value)) : '')
  const [groupSel, setGroupSel] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [groupMsg, setGroupMsg] = useState<string | null>(null)

  useEffect(() => {
    setRatingInput(rating ? String(Number(rating.value)) : '')
  }, [rating])

  function commitRating() {
    const raw = ratingInput.trim()
    if (raw === '') {
      if (rating) delRating.mutate(rating.id)
      return
    }
    const v = Number(raw)
    if (!Number.isNaN(v) && v >= 1 && v <= 10) setRating.mutate({ board_game: bggId, value: v })
  }

  async function addToExisting(groupId: number) {
    setGroupMsg(null)
    const group = customWantGroups.find((g) => g.id === groupId)
    if (!group) return
    if (group.items.some((i) => i.target_type === 'BOARD_GAME' && i.board_game === bggId)) {
      setGroupMsg('Already in that group.')
      return
    }
    const items: WantGroupItemPayload[] = [
      ...group.items.map((i) => ({
        target_type: i.target_type,
        ...(i.target_type === 'BOARD_GAME'
          ? { board_game: i.board_game! }
          : { event_listing: i.event_listing! }),
        money_amount: i.money_amount != null ? Number(i.money_amount) : null,
      })),
      { target_type: 'BOARD_GAME', board_game: bggId, money_amount: null },
    ]
    try {
      await patchWantGroupRaw(slug, group.id, { items })
      invalidateTrades(qc, slug)
      setGroupMsg('Added.')
    } catch {
      setGroupMsg('Could not add.')
    }
  }

  async function createAndAdd() {
    const name = newName.trim()
    if (!name) return
    setGroupMsg(null)
    try {
      await createWantGroupRaw(slug, {
        name,
        min_receive: 1,
        items: [{ target_type: 'BOARD_GAME', board_game: bggId, money_amount: null }],
      })
      invalidateTrades(qc, slug)
      setShowNew(false)
      setNewName('')
      setGroupMsg('Group created.')
    } catch {
      setGroupMsg('Could not create group.')
    }
  }

  return (
    <div className="space-y-2 border-b border-gray-100 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">My rating</span>
        <input
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={ratingInput}
          onChange={(e) => setRatingInput(e.target.value)}
          onBlur={commitRating}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder="—"
          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {rating && (
          <button
            type="button"
            onClick={() => {
              setRatingInput('')
              delRating.mutate(rating.id)
            }}
            className="text-gray-300 hover:text-red-500"
            aria-label="Clear rating"
          >
            ×
          </button>
        )}
        {(setRating.isSuccess || delRating.isSuccess) && <span className="text-green-600">✓</span>}
      </div>

      {moneyEnabled && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Pay up to $</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceValue}
            disabled={!wanted}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder={wanted ? '0' : 'want it first'}
            title={wanted ? 'Most money you’ll pay to receive this game' : 'Select a copy / want this game to set a price'}
            className="w-24 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-500">Add to group</span>
        <select
          value={groupSel}
          onChange={(e) => {
            const val = e.target.value
            setGroupSel('')
            if (val === '__new__') {
              setShowNew(true)
            } else if (val) {
              addToExisting(Number(val))
            }
          }}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          <option value="">Choose…</option>
          {customWantGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new__">+ New group…</option>
        </select>
        {groupMsg && <span className="text-gray-400">{groupMsg}</span>}
      </div>

      {showNew && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <button
            type="button"
            onClick={createAndAdd}
            className="rounded bg-purple-600 px-2 py-0.5 font-medium text-white hover:bg-purple-500"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNew(false)
              setNewName('')
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render `GameCardControls` in the expanded card**

In `GameBrowse`, replace the expanded block:

```tsx
                {open && (
                  <div className="border-t border-gray-100 bg-gray-50/60">
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      myListings={myListings}
                      selectable
                    />
                  </div>
                )}
```

with (compute `wanted` from the game's group, render controls above the copies):

```tsx
                {open && (
                  <div className="border-t border-gray-100 bg-gray-50/60">
                    {(() => {
                      const group = groupByGame.get(g.bgg_id)
                      const wantedForControls = group
                        ? myListings.some((l) => groupIsOn(editor, l.id, group))
                        : false
                      return (
                        <GameCardControls
                          slug={slug}
                          bggId={g.bgg_id}
                          wanted={wantedForControls}
                          moneyEnabled={moneyEnabled}
                          priceValue={editor.priceForGame(g.bgg_id)}
                          onPriceChange={(v) => editor.setMoney(g.bgg_id, v)}
                          customWantGroups={customWantGroups}
                        />
                      )
                    })()}
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      myListings={myListings}
                      selectable
                    />
                  </div>
                )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS. Fix any TS errors (e.g., `WantGroupItemPayload` already imported at the top of the file; `patchWantGroupRaw`, `createWantGroupRaw`, `invalidateTrades` already imported).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat: per-game rating, buy-price, add-to-want-group in catalog dropdown"
```

---

### Task 5: Full verification

- [ ] **Step 1: Build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both clean.

- [ ] **Step 2: Backend suite (sanity — no backend change expected)**

Run: `cd backend && source venv/bin/activate && python manage.py test`
Expected: all pass.

- [ ] **Step 3: Manual (run skill / dev server + backend, as a participant with listings)**

- [ ] Catalog is the default tab; switching to Visual/Grid hides the browse panel; switching back shows it.
- [ ] "Import ratings from BGG" and "Sync BGG wishlist" no longer appear on My Wants.
- [ ] Expand a game card → set a rating (1–10) → blur persists it; reload shows it; "×" clears it.
- [ ] Before wanting a game, the "Pay up to $" field is disabled; after wanting it (any-copy toggle or a specific copy), the field enables.
- [ ] Set a price, then Save → reload shows the price retained; the advanced X-to-Y builder shows the want item's "pay ≤ $" for that game.
- [ ] The Save bar's unsaved-count increases when only a price changed (no cell toggled).
- [ ] In an event with money disabled, the price field is absent.
- [ ] "Add to group" → pick an existing custom group → it appears in that group in the advanced builder; "+ New group…" creates one with the game.

---

## Self-Review

**Spec coverage:**
- Catalog own default tab; Visual/Grid refine → Task 3 (Steps 1, 3, 4). ✓
- Remove both BGG buttons + dead imports → Task 3 (Steps 2, 6, 8). ✓
- Rating set/clear inline, immediate → Task 4 (`GameCardControls`, `useSetRating`/`useDeleteRating` Task 1). ✓
- Buy-price gated on wanted, staged, money-enabled only → Task 4 (price input `disabled={!wanted}`, `moneyEnabled` guard) + Task 2 (editor/persist). ✓
- Add-to-want-group (custom groups + inline create), immediate → Task 4 + `customWantGroups` (Task 3 Step 5). ✓
- Money threading through buildModel/useEditor/persistChanges → Task 2. ✓
- `useDeleteRating` → Task 1. ✓
- Build/lint/suite → Task 5. ✓

**Placeholder scan:** none — every code step shows full code + exact commands.

**Type consistency:** `baseMoneyByGame: Map<number,string>` defined in `PageModel` (T2 S1), populated (T2 S2), read by `priceForGame` (T2 S4). `Editor.priceForGame`/`setMoney` defined (T2 S3) and used in `persistChanges` (T2 S5) and `GameCardControls` (T4). `persistChanges(..., moneyEnabled)` signature (T2 S5) matches the call (T2 S6). `GameBrowseProps` gains `customWantGroups: WantGroup[]` + `moneyEnabled: boolean` (T3 S7), supplied by the render site (T3 S4) and `customWantGroups` memo (T3 S5). `GameCardControls` props match its render (T4 S3). `WantGroupItemPayload`, `WantGroup`, `patchWantGroupRaw`, `createWantGroupRaw`, `invalidateTrades` are already imported at the top of `MyWantsPage.tsx`. `useSetRating` posts `{ board_game, value:number }` (matches existing `ratings.ts`); `useDeleteRating(id:number)` matches Task 1.
