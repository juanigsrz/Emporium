# Advanced Panel 5b — Caps + Prices UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two tabs to the advanced builder (`WantListBuilderPage`): a **Caps** panel to create/edit/delete user `takecap`/`givecap` rows, and a **Prices** panel to set per-copy **bid** overrides (and view/edit per-game default bids).

**Architecture:** A new `api/caps.ts` client (mirrors `api/combos.ts`) backs a `CapsPanel`/`CapForm`/`CapCard` set mirroring the offer-group panels. A `PricesPanel` reuses existing endpoints (`listGamePrices`/`setGamePrice`/`deleteGamePrice` for per-game defaults; `setWantBid`/`deleteWantBid` + `WantGroupItem.resolved_bid`/`bid_is_override` for per-copy bid overrides). Bid-only — never writes a listing's ask.

**Tech Stack:** React 19 + TS + react-query. **No test runner** — verify with `npm run build` + targeted `npx eslint <file>` (exit 0) + a manual checklist. Repo `npm run lint` fails only on pre-existing `CopyForm.tsx:15` — ignore.

**Spec:** `docs/superpowers/specs/2026-06-22-advanced-panel-caps-prices-design.md` (Parts A-UI + B). Backend (Plan 5a, merged) exposes `GET/POST /events/{slug}/caps/`, `GET/PATCH/DELETE /events/{slug}/caps/{id}/`.

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/`. **This is Plan 5b of 2.**

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/advanced-caps-5b
```

Expected: `Switched to a new branch 'feat/advanced-caps-5b'`

---

### Task 1: `api/caps.ts` client

**Files:**
- Create: `frontend/src/api/caps.ts`

- [ ] **Step 1: Write the client module**

Create `frontend/src/api/caps.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export type CapKind = 'TAKE' | 'GIVE'

export interface CapItem {
  id: number
  event_listing: number | null
  listing_code: string | null
  board_game_name: string | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
}

export interface Cap {
  id: number
  kind: CapKind
  n: number
  items: CapItem[]
  created: string
}

export interface CapPayload {
  kind: CapKind
  n: number
  item_listing_ids: number[]
  item_combo_ids: number[]
}

export const CAPS_KEYS = {
  all: ['caps'] as const,
  list: (slug: string) => ['caps', 'list', slug] as const,
}

export async function fetchCaps(slug: string): Promise<PaginatedResponse<Cap>> {
  const { data } = await apiClient.get<PaginatedResponse<Cap>>(`/events/${slug}/caps/`)
  return data
}

export async function createCap(slug: string, payload: CapPayload): Promise<Cap> {
  const { data } = await apiClient.post<Cap>(`/events/${slug}/caps/`, payload)
  return data
}

export async function patchCap(slug: string, id: number, payload: Partial<CapPayload>): Promise<Cap> {
  const { data } = await apiClient.patch<Cap>(`/events/${slug}/caps/${id}/`, payload)
  return data
}

export async function deleteCap(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/caps/${id}/`)
}

export function useCaps(slug: string | undefined) {
  return useQuery({
    queryKey: CAPS_KEYS.list(slug ?? ''),
    queryFn: () => fetchCaps(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: CapPayload }) => createCap(slug, payload),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}

export function usePatchCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id, payload }: { slug: string; id: number; payload: Partial<CapPayload> }) =>
      patchCap(slug, id, payload),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}

export function useDeleteCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteCap(slug, id),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/api/caps.ts --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/api/caps.ts
git commit -m "feat(caps-fe): caps API client"
```

---

### Task 2: Caps panel + tab

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

- [ ] **Step 1: Add imports**

In `frontend/src/features/trades/WantListBuilderPage.tsx`, after the existing `../../api/combos` import (added in the combos work), add:

```tsx
import { useCaps, useCreateCap, usePatchCap, useDeleteCap } from '../../api/caps'
import type { Cap, CapKind } from '../../api/caps'
```

- [ ] **Step 2: Add the Caps panel components**

Append these components near the other panels (e.g. directly after the `WishCard` function, before the `// MAIN PAGE` divider). `useEventListings` and `useCombos` are already imported in this file; `EventListing` type is imported.

```tsx
// ============================================================
// CAPS PANEL — user-defined takecap / givecap
// ============================================================

interface CapsPanelProps {
  slug: string
  username: string
  locked?: boolean
}

function CapsPanel({ slug, username, locked }: CapsPanelProps) {
  const { data: capsData, isLoading } = useCaps(slug)
  const deleteCap = useDeleteCap()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Cap | null>(null)
  const [error, setError] = useState<string | null>(null)

  const caps = capsData?.results ?? []

  async function handleDelete(id: number) {
    setError(null)
    try {
      await deleteCap.mutateAsync({ slug, id })
    } catch (e) {
      setError(extractErrorMsg(e))
    }
  }

  if (isLoading) {
    return <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-moss/70">
        Caps limit how many items you receive (<strong>take</strong>) or give
        (<strong>give</strong>) from a chosen set — across swaps and cash.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {(showForm || editing) && !locked && (
        <CapForm
          key={editing?.id ?? 'new'}
          slug={slug}
          username={username}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {caps.length === 0 && !showForm && !editing && (
        <p className="text-xs text-moss/70 py-2">No caps yet.</p>
      )}

      {caps.map((cap) => (
        <CapCard
          key={cap.id}
          cap={cap}
          locked={locked}
          onEdit={() => { setEditing(cap); setShowForm(false) }}
          onDelete={() => handleDelete(cap.id)}
          isDeleting={deleteCap.isPending}
        />
      ))}

      {!locked && !showForm && !editing && (
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
        >
          + New cap
        </button>
      )}
    </div>
  )
}

function CapCard({ cap, locked, onEdit, onDelete, isDeleting }: {
  cap: Cap
  locked?: boolean
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const verb = cap.kind === 'TAKE' ? 'Receive' : 'Give'
  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {verb} at most {cap.n}
        </span>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="text-xs text-moss/70 hover:text-indigo-600 px-1.5 py-0.5 rounded">Edit</button>
            {confirm ? (
              <span className="flex items-center gap-1">
                <button onClick={onDelete} disabled={isDeleting} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded">
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button onClick={() => setConfirm(false)} className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirm(true)} className="text-xs text-moss/70 hover:text-red-500 px-1.5 py-0.5 rounded">Delete</button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cap.items.map((it) =>
          it.combo != null ? (
            <span key={it.id} className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              🎁 {it.combo_name} <span className="font-mono text-amber-700/70">{it.combo_code}</span>
            </span>
          ) : (
            <span key={it.id} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-ink">
              <span className="font-mono text-moss/70">{it.listing_code}</span>
              {it.board_game_name}
            </span>
          )
        )}
      </div>
    </div>
  )
}

function CapForm({ slug, username, editing, onClose }: {
  slug: string
  username: string
  editing: Cap | null
  onClose: () => void
}) {
  const createCap = useCreateCap()
  const patchCap = usePatchCap()
  const { data: listingsData } = useEventListings(slug, { page_size: 200 })
  const { data: combosData } = useCombos(slug)
  const allListings = listingsData?.results ?? []
  const allCombos = combosData?.results ?? []

  const [kind, setKind] = useState<CapKind>(editing?.kind ?? 'TAKE')
  const [n, setN] = useState(String(editing?.n ?? 1))
  const [listingIds, setListingIds] = useState<Set<number>>(
    new Set((editing?.items ?? []).filter((i) => i.event_listing != null).map((i) => i.event_listing as number))
  )
  const [comboIds, setComboIds] = useState<Set<number>>(
    new Set((editing?.items ?? []).filter((i) => i.combo != null).map((i) => i.combo as number))
  )
  const [error, setError] = useState<string | null>(null)
  const saving = createCap.isPending || patchCap.isPending

  // GIVE: only your own items can be capped. TAKE: any item.
  const listings = kind === 'GIVE'
    ? allListings.filter((l) => l.copy_owner_username === username)
    : allListings
  const combos = kind === 'GIVE'
    ? allCombos.filter((c) => c.owner_username === username)
    : allCombos

  function toggle(set: Set<number>, setter: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setter(next)
  }

  async function handleSave() {
    setError(null)
    const nn = parseInt(n, 10)
    if (isNaN(nn) || nn < 1) { setError('N must be at least 1.'); return }
    if (listingIds.size + comboIds.size === 0) { setError('Pick at least one item.'); return }
    const payload = {
      kind, n: nn,
      item_listing_ids: Array.from(listingIds),
      item_combo_ids: Array.from(comboIds),
    }
    try {
      if (editing) await patchCap.mutateAsync({ slug, id: editing.id, payload })
      else await createCap.mutateAsync({ slug, payload })
      onClose()
    } catch (e) {
      setError(extractErrorMsg(e))
    }
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-indigo-700">{editing ? 'Edit cap' : 'New cap'}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CapKind)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="TAKE">Take — receive at most N</option>
            <option value="GIVE">Give — send at most N</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">N (max)</label>
          <input
            type="number" min={1} value={n}
            onChange={(e) => setN(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink mb-1.5">
          Items in this cap ({listingIds.size + comboIds.size} selected)
          {kind === 'GIVE' && <span className="ml-1 text-moss/60">— your own items only</span>}
        </p>
        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto">
          {listings.map((l: EventListing) => (
            <label key={`l-${l.id}`} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm ${
              listingIds.has(l.id) ? 'border-indigo-400 bg-white text-indigo-800' : 'border-ink/15 bg-white text-ink hover:border-indigo-200'
            }`}>
              <input type="checkbox" checked={listingIds.has(l.id)} onChange={() => toggle(listingIds, setListingIds, l.id)} />
              <span className="font-medium">{l.board_game_name}</span>
              <span className="font-mono text-xs text-moss/70">{l.listing_code}</span>
            </label>
          ))}
          {combos.map((c) => (
            <label key={`c-${c.id}`} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm ${
              comboIds.has(c.id) ? 'border-amber-400 bg-white text-amber-800' : 'border-ink/15 bg-white text-ink hover:border-amber-200'
            }`}>
              <input type="checkbox" checked={comboIds.has(c.id)} onChange={() => toggle(comboIds, setComboIds, c.id)} />
              <span className="font-medium">🎁 {c.name}</span>
              <span className="font-mono text-xs text-moss/70">{c.combo_code}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="rounded-xl border-2 border-ink bg-indigo-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm disabled:opacity-60">
          {saving ? 'Saving…' : editing ? 'Save' : 'Create cap'}
        </button>
        <button onClick={onClose} className="rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the `caps` tab**

In the same file, extend the tab type:

```tsx
type BuilderTab = 'offers' | 'wants' | 'wishes'
```

to:

```tsx
type BuilderTab = 'offers' | 'wants' | 'wishes' | 'caps'
```

Add to the `tabs` array (after the `wishes` entry):

```tsx
    { id: 'wishes', label: 'Wishes' },
```

becomes:

```tsx
    { id: 'wishes', label: 'Wishes' },
    { id: 'caps', label: 'Caps' },
```

Add the panel block after the `{activeTab === 'wishes' && (...)}` block (which ends with its closing `)}`):

```tsx
        {activeTab === 'caps' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Caps — take / give limits</h2>
              <p className="text-xs text-moss/70">Limit how many you receive or give from a set</p>
            </div>
            <CapsPanel slug={slug!} username={user?.username ?? ''} locked={locked} />
          </div>
        )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/WantListBuilderPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 5: Manual QA checklist**

Advanced builder → Caps tab:
- "New cap": pick TAKE, N=2, select two listings → Create → a card "Receive at most 2" with the two listing chips.
- Switch a form to GIVE → the item list narrows to your own listings + combos; selecting your own listings + a combo and saving creates a "Give at most N" cap.
- GIVE over a non-owned item is impossible in the UI (list only shows your own); the backend also rejects it (400 surfaced).
- Edit changes kind/N/items; Delete (confirm) removes the cap.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(caps-fe): Caps panel + tab in the advanced builder"
```

---

### Task 3: Prices panel + tab (per-copy bid override)

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

Per-copy **bid** override (`WantBid`) on copies you want, defaulting from your canonical per-game bid. Never writes an ask. Plus a view/edit of your per-game default prices (`UserGamePrice`).

- [ ] **Step 1: Add imports**

In `frontend/src/features/trades/WantListBuilderPage.tsx`, the `../../api/trades` import block already imports the want-group hooks. Add these named imports from `../../api/trades` (some may already be present — only add the missing ones; do not duplicate):

```tsx
import { listGamePrices, setGamePrice, deleteGamePrice, setWantBid, deleteWantBid } from '../../api/trades'
import type { GamePrice, WantGroupItem } from '../../api/trades'
```

(If the file already imports `useWantGroups` from `../../api/trades`, keep it; the Prices panel uses it for the wanted-copies list.)

- [ ] **Step 2: Add the Prices panel**

Append after `CapForm` (before the `// MAIN PAGE` divider):

```tsx
// ============================================================
// PRICES PANEL — per-copy bid overrides (+ per-game defaults)
// ============================================================

interface PricesPanelProps {
  slug: string
  username: string
  locked?: boolean
}

function PricesPanel({ slug, username, locked }: PricesPanelProps) {
  const qc = useQueryClient()
  const { data: wantGroups = [] } = useWantGroups(slug)
  const { data: gamePrices = [] } = useQuery({
    queryKey: ['trades', 'game-prices', slug],
    queryFn: () => listGamePrices(slug),
    staleTime: 30_000,
  })

  // Unique wanted listing targets (a copy may appear in several want groups).
  const byListing = new Map<number, WantGroupItem>()
  for (const wg of wantGroups) {
    for (const it of wg.items) {
      if (it.event_listing != null && !byListing.has(it.event_listing)) {
        byListing.set(it.event_listing, it)
      }
    }
  }
  const wantedCopies = Array.from(byListing.values())

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Set your own max <strong>bid</strong> per copy you want — it overrides your
        canonical per-game price. This is your buy price; it never changes a copy's
        sell price (that's the owner's).
      </p>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">Per-copy bids</h3>
        {wantedCopies.length === 0 ? (
          <p className="text-xs text-moss/70">No wanted copies yet — add some in Want Groups.</p>
        ) : (
          <div className="space-y-1.5">
            {wantedCopies.map((it) => (
              <CopyBidRow key={it.event_listing as number} slug={slug} item={it} locked={locked} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">Your per-game default prices</h3>
        {gamePrices.length === 0 ? (
          <p className="text-xs text-moss/70">No per-game prices set. (Set them in the Almanac view of My Wants.)</p>
        ) : (
          <div className="space-y-1.5">
            {gamePrices.map((gp: GamePrice) => (
              <GamePriceRow key={gp.id} slug={slug} gp={gp} locked={locked} onChanged={() => qc.invalidateQueries({ queryKey: ['trades', 'game-prices', slug] })} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyBidRow({ slug, item, locked }: { slug: string; item: WantGroupItem; locked?: boolean }) {
  const qc = useQueryClient()
  const isOverride = item.bid_is_override === true
  const [value, setValue] = useState(isOverride ? (item.resolved_bid ?? '') : '')
  const [busy, setBusy] = useState(false)
  const elId = item.event_listing as number

  async function commit() {
    setBusy(true)
    try {
      const v = value.trim()
      if (v === '') await deleteWantBid(slug, { event_listing: elId })
      else await setWantBid(slug, { event_listing: elId, amount: v })
      qc.invalidateQueries({ queryKey: ['trades', 'want-groups', slug] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-ink/15 bg-white px-3 py-2">
      <div className="min-w-0">
        <span className="block truncate text-sm text-ink">{item.board_game_name}</span>
        <span className="font-mono text-xs text-moss/70">{item.listing_code}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs text-moss/70">bid ≤$</span>
        <input
          type="number" min={0} step="0.01" disabled={locked || busy}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          placeholder={!isOverride && item.resolved_bid ? item.resolved_bid : 'default'}
          title="Your max bid for this specific copy (overrides your per-game default; placeholder = the default)"
          className="no-spinner w-24 rounded border border-ink/20 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
        />
      </div>
    </div>
  )
}

function GamePriceRow({ slug, gp, locked, onChanged }: { slug: string; gp: GamePrice; locked?: boolean; onChanged: () => void }) {
  const [value, setValue] = useState(gp.price)
  const [busy, setBusy] = useState(false)

  async function commit() {
    setBusy(true)
    try {
      const v = value.trim()
      if (v === '') await deleteGamePrice(slug, gp.board_game)
      else await setGamePrice(slug, gp.board_game, v)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-ink/15 bg-white px-3 py-2">
      <span className="truncate text-sm text-ink">{gp.board_game_name}</span>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs text-moss/70">$</span>
        <input
          type="number" min="0.01" step="0.01" disabled={locked || busy}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="no-spinner w-24 rounded border border-ink/20 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the `prices` tab (money-enabled only)**

Extend the tab type from Task 2:

```tsx
type BuilderTab = 'offers' | 'wants' | 'wishes' | 'caps'
```

to:

```tsx
type BuilderTab = 'offers' | 'wants' | 'wishes' | 'caps' | 'prices'
```

In the `tabs` array, conditionally include `prices` when money is enabled. The array is currently built as a literal; replace the literal assignment:

```tsx
  const tabs: { id: BuilderTab; label: string; count?: number }[] = [
    { id: 'offers', label: 'Offer Groups', count: offerGroupsData.length },
    { id: 'wants', label: 'Want Groups', count: wantGroupsData.length },
    { id: 'wishes', label: 'Wishes' },
    { id: 'caps', label: 'Caps' },
  ]
```

with:

```tsx
  const tabs: { id: BuilderTab; label: string; count?: number }[] = [
    { id: 'offers', label: 'Offer Groups', count: offerGroupsData.length },
    { id: 'wants', label: 'Want Groups', count: wantGroupsData.length },
    { id: 'wishes', label: 'Wishes' },
    { id: 'caps', label: 'Caps' },
    ...(event.money_enabled ? [{ id: 'prices' as BuilderTab, label: 'Prices' }] : []),
  ]
```

Add the panel block after the `caps` block:

```tsx
        {activeTab === 'prices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Prices — per-copy bids</h2>
              <p className="text-xs text-moss/70">Your buy price overrides</p>
            </div>
            <PricesPanel slug={slug!} username={user?.username ?? ''} locked={locked} />
          </div>
        )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/WantListBuilderPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 5: Manual QA checklist**

On a money-enabled event where you want some copies:
- A **Prices** tab appears (hidden on non-money events).
- "Per-copy bids" lists your wanted copies; each shows your bid (placeholder = the canonical default when not overridden).
- Type a number + blur → a `WantBid` override is saved (the row now reflects it). Clear it + blur → reverts to the canonical default (placeholder returns).
- The copy's **ask** is never shown/edited here — only your bid.
- "Your per-game default prices" lists your `UserGamePrice` rows; editing a value updates it, clearing deletes it.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(caps-fe): Prices panel — per-copy bid overrides + per-game defaults"
```

---

## Self-Review

**Spec coverage (5b):**
- `api/caps.ts` client (types + CRUD + hooks) → Task 1 ✔
- Caps panel: list/create/edit/delete; kind toggle, N, item multi-select (GIVE = own items only, TAKE = any) → Task 2 ✔
- Caps tab → Task 2 ✔
- Prices panel: per-copy bid override (WantBid, default from canonical, never ask) + per-game default view/edit → Task 3 ✔
- Prices tab (money-only) → Task 3 ✔
- Verify via build + eslint + manual → every task ✔

**Placeholder scan:** none.

**Type/name consistency:** `Cap`/`CapItem`/`CapPayload`/`CapKind` from `api/caps.ts` used in `CapsPanel`/`CapForm`/`CapCard`; `useCaps`/`useCreateCap`/`usePatchCap`/`useDeleteCap` match the client exports; `GamePrice`/`WantGroupItem` from `api/trades.ts` used in `PricesPanel`/`CopyBidRow`/`GamePriceRow`; `setWantBid`/`deleteWantBid`/`setGamePrice`/`deleteGamePrice`/`listGamePrices` are existing `api/trades.ts` exports; `BuilderTab` extended to include `'caps'` and `'prices'` in both the type and the tabs array.

**Notes for the executor:**
- `extractErrorMsg`, `useState`, `useQuery`, `useQueryClient`, `useWantGroups`, `useEventListings`, `useCombos`, `EventListing` are already imported in `WantListBuilderPage.tsx` from prior work — verify before adding; do not duplicate imports (eslint will flag duplicates).
- `CopyBidRow` keys its input state off `item.resolved_bid`/`bid_is_override` at mount; after a save the want-groups query is invalidated and the row remounts with fresh data (the list re-renders). If the row appears stale after edit, confirm the `useWantGroups` invalidation fired.
- Combo cap items show `🎁 name`; listing items show `listing_code` + `board_game_name`, matching the chip style used elsewhere.
