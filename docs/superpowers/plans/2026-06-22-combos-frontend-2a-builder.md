# Combos Frontend 2a — Combo Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user author combos (bundle ≥2 of their own event listings) from the event page — a `api/combos.ts` client plus a "My Combos" section in `EventDetailPage`.

**Architecture:** New per-domain API module mirroring `api/events.ts` (axios fns + react-query hooks). A self-contained `MyCombosSection` component rendered after `MyListingsSection`, reusing the cached "my listings" query, with a `ComboForm` (multi-select listings + name + optional price) and `ComboCard` (member thumbnails + edit + inline delete-confirm).

**Tech Stack:** React 19, TypeScript, @tanstack/react-query v5, axios, Tailwind. **No test runner exists** — verify each task with `npm run build` (`tsc -b && vite build`, typechecks) and `npm run lint` (`eslint … --max-warnings 0`), plus a manual QA checklist.

**Spec:** `docs/superpowers/specs/2026-06-22-combos-frontend-design.md`

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/`. Backend (already merged) exposes `GET/POST /api/events/{slug}/combos/` and `GET/PATCH/DELETE /api/events/{slug}/combos/{id}/`.

**This is Plan 2a of 2.** Plan 2b (combos in the trade builders) follows.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/combos-frontend-2a
```

Expected: `Switched to a new branch 'feat/combos-frontend-2a'`

---

### Task 1: `api/combos.ts` client

**Files:**
- Create: `frontend/src/api/combos.ts`

- [ ] **Step 1: Write the client module**

Create `frontend/src/api/combos.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Types ----

export interface ComboItemRead {
  id: number
  event_listing: number
  listing_code: string
  board_game_id: number
  board_game_name: string
  board_game_thumbnail: string
}

export interface Combo {
  id: number
  owner: number
  owner_username: string
  name: string
  combo_code: string
  active: boolean
  sell_price: string | null
  items: ComboItemRead[]
  created: string
  updated: string
}

export interface ComboPayload {
  name: string
  sell_price?: string | null
  item_listing_ids: number[]
}

export interface CombosParams {
  board_game?: number | string
  mine?: boolean
  page?: number
  page_size?: number
}

// ---- Query keys ----

export const COMBOS_KEYS = {
  all: ['combos'] as const,
  list: (slug: string, params?: CombosParams) =>
    ['combos', 'list', slug, params ?? {}] as const,
}

// ---- API functions ----

export async function fetchCombos(
  slug: string,
  params: CombosParams = {}
): Promise<PaginatedResponse<Combo>> {
  const p: Record<string, string> = {}
  if (params.board_game != null) p.board_game = String(params.board_game)
  if (params.mine) p.mine = '1'
  if (params.page && params.page > 1) p.page = String(params.page)
  if (params.page_size) p.page_size = String(params.page_size)
  const { data } = await apiClient.get<PaginatedResponse<Combo>>(
    `/events/${slug}/combos/`,
    { params: p }
  )
  return data
}

export async function createCombo(slug: string, payload: ComboPayload): Promise<Combo> {
  const { data } = await apiClient.post<Combo>(`/events/${slug}/combos/`, payload)
  return data
}

export async function patchCombo(
  slug: string,
  id: number,
  payload: Partial<ComboPayload>
): Promise<Combo> {
  const { data } = await apiClient.patch<Combo>(`/events/${slug}/combos/${id}/`, payload)
  return data
}

export async function deleteCombo(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/combos/${id}/`)
}

// ---- Hooks ----

export function useCombos(slug: string | undefined, params: CombosParams = {}) {
  return useQuery({
    queryKey: COMBOS_KEYS.list(slug ?? '', params),
    queryFn: () => fetchCombos(slug!, params),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: ComboPayload }) =>
      createCombo(slug, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}

export function usePatchCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id, payload }: { slug: string; id: number; payload: Partial<ComboPayload> }) =>
      patchCombo(slug, id, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}

export function useDeleteCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteCombo(slug, id),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: builds with no TypeScript errors. (`PaginatedResponse` is exported from `./games`, used the same way by `api/events.ts`.)

- [ ] **Step 3: Lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run lint`
Expected: no errors/warnings.

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/api/combos.ts
git commit -m "feat(combos-fe): combos API client (CRUD + hooks)"
```

---

### Task 2: "My Combos" section in `EventDetailPage`

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

- [ ] **Step 1: Add imports**

In `frontend/src/features/events/EventDetailPage.tsx`, after the existing event imports near the top (the line `import type { TradeEvent, EventListing, EventStatus } from '../../api/events'` at line 23), add:

```tsx
import { useCombos, useCreateCombo, usePatchCombo, useDeleteCombo } from '../../api/combos'
import type { Combo } from '../../api/combos'
```

- [ ] **Step 2: Add the section + sub-components**

In the same file, immediately AFTER the `MyListingsSection` function (it ends at the line `}` on line 913, just before the `// ---- Deadline row helper ----` comment), insert these three components:

```tsx
// ---- My Combos section ----

interface MyCombosSectionProps {
  event: TradeEvent
  username: string
}

function MyCombosSection({ event, username }: MyCombosSectionProps) {
  const { data: listingsData } = useEventListings(event.slug, {
    user: username,
    page_size: 100,
  })
  const { data: combosData, isLoading } = useCombos(event.slug, { mine: true })
  const deleteCombo = useDeleteCombo()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Combo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const myListings = (listingsData?.results ?? []).filter(
    (l: EventListing) => l.copy_owner_username === username
  )
  const combos = combosData?.results ?? []
  const locked = event.inputs_locked

  const usedListingIds = new Set<number>()
  for (const c of combos) for (const it of c.items) usedListingIds.add(it.event_listing)

  async function handleDelete(id: number) {
    setError(null)
    try {
      await deleteCombo.mutateAsync({ slug: event.slug, id })
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to delete combo.')
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-ink">My Combos in This Event</h3>
        {!locked && !showForm && !editing && myListings.length >= 2 && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="rounded-full border-2 border-ink bg-fern px-3 py-1 text-xs font-semibold text-cream"
          >
            + New combo
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-moss/80">
        Bundle two or more of your listings to trade together (e.g. a base game + its
        expansion). Each listing can be in at most one combo.
      </p>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {(showForm || editing) && !locked && (
        <ComboForm
          slug={event.slug}
          moneyEnabled={event.money_enabled}
          myListings={myListings}
          usedListingIds={usedListingIds}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {isLoading ? (
        <p className="py-2 text-xs text-moss">Loading…</p>
      ) : combos.length === 0 ? (
        <p className="py-2 text-xs text-moss">No combos yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {combos.map((c) => (
            <ComboCard
              key={c.id}
              combo={c}
              locked={locked}
              onEdit={() => { setEditing(c); setShowForm(false) }}
              onDelete={() => handleDelete(c.id)}
              deletePending={deleteCombo.isPending}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ComboCard({ combo, locked, onEdit, onDelete, deletePending }: {
  combo: Combo
  locked: boolean
  onEdit: () => void
  onDelete: () => void
  deletePending: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="rounded-2xl border-2 border-ink/15 bg-parchment p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{combo.name}</span>
          <span className="font-mono text-xs text-moss/70">{combo.combo_code}</span>
        </div>
        {!locked && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={onEdit}
              className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-600"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {combo.items.map((it) => (
          <span
            key={it.id}
            className="flex items-center gap-1 rounded-full border border-ink/15 bg-cream px-2 py-0.5 text-xs text-moss"
          >
            {it.board_game_thumbnail && (
              <img src={it.board_game_thumbnail} alt="" className="h-4 w-4 rounded object-cover" loading="lazy" />
            )}
            <span className="max-w-[8rem] truncate">{it.board_game_name}</span>
          </span>
        ))}
      </div>

      <p className="mt-2 text-xs text-moss/80">
        {combo.sell_price ? `Bundle price $${combo.sell_price}` : 'Barter only'}
      </p>

      {confirming && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-2 py-1.5">
          <span className="text-xs text-red-700">Remove this combo?</span>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-cream disabled:opacity-50"
          >
            {deletePending ? '…' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function ComboForm({ slug, moneyEnabled, myListings, usedListingIds, editing, onClose }: {
  slug: string
  moneyEnabled: boolean
  myListings: EventListing[]
  usedListingIds: Set<number>
  editing: Combo | null
  onClose: () => void
}) {
  const createCombo = useCreateCombo()
  const patchCombo = usePatchCombo()
  const editingMemberIds = new Set<number>(
    editing ? editing.items.map((it) => it.event_listing) : []
  )
  const [name, setName] = useState(editing?.name ?? '')
  const [sellPrice, setSellPrice] = useState(editing?.sell_price ?? '')
  const [selected, setSelected] = useState<Set<number>>(new Set(editingMemberIds))
  const [error, setError] = useState<string | null>(null)
  const saving = createCombo.isPending || patchCombo.isPending

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    if (selected.size < 2) {
      setError('Pick at least 2 listings.')
      return
    }
    const payload = {
      name: name.trim(),
      item_listing_ids: Array.from(selected),
      sell_price: moneyEnabled && sellPrice.trim() ? sellPrice.trim() : null,
    }
    try {
      if (editing) await patchCombo.mutateAsync({ slug, id: editing.id, payload })
      else await createCombo.mutateAsync({ slug, payload })
      onClose()
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to save combo.')
    }
  }

  return (
    <div className="mb-3 rounded-2xl border-2 border-ink/15 bg-parchment p-3">
      <p className="mb-2 text-xs font-semibold text-ink">{editing ? 'Edit combo' : 'New combo'}</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Combo name (e.g. Wingspan + Europe)"
        className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
      />
      {moneyEnabled && (
        <input
          value={sellPrice ?? ''}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder="Bundle price (optional)"
          inputMode="decimal"
          className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
        />
      )}
      <p className="mb-1 text-xs text-moss">
        Pick at least 2 of your listings ({selected.size} selected):
      </p>
      <div className="mb-2 max-h-48 space-y-1 overflow-y-auto">
        {myListings.map((l) => {
          const inOtherCombo = usedListingIds.has(l.id) && !editingMemberIds.has(l.id)
          return (
            <label
              key={l.id}
              className={`flex items-center gap-2 rounded-xl border px-2 py-1 text-xs ${
                inOtherCombo ? 'cursor-not-allowed border-ink/10 opacity-40' : 'cursor-pointer border-ink/15'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                disabled={inOtherCombo}
                onChange={() => toggle(l.id)}
              />
              {l.board_game_thumbnail && (
                <img src={l.board_game_thumbnail} alt="" className="h-5 w-5 rounded object-cover" loading="lazy" />
              )}
              <span className="truncate">{l.board_game_name}</span>
              <span className="ml-auto font-mono text-moss/60">{l.listing_code}</span>
            </label>
          )
        })}
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || selected.size < 2}
          className="rounded-full border-2 border-ink bg-fern px-3 py-1 text-xs font-semibold text-cream disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save' : 'Create combo'}
        </button>
        <button
          onClick={onClose}
          className="rounded-full border-2 border-ink/20 px-3 py-1 text-xs text-moss"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render the section**

In the same file, find where `MyListingsSection` is rendered (line 1143):

```tsx
        <MyListingsSection event={event} username={user.username} />
```

Add the combos section directly after it:

```tsx
        <MyListingsSection event={event} username={user.username} />
        <MyCombosSection event={event} username={user.username} />
```

- [ ] **Step 4: Typecheck**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 5: Lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run lint`
Expected: no errors/warnings.

- [ ] **Step 6: Manual QA checklist**

Start the dev server (`npm run dev`) and a backend, then on an event you participate in with ≥2 of your own active listings:
- "My Combos in This Event" section renders under "My Listings".
- "+ New combo" appears only when you have ≥2 listings and the event is not locked.
- Create a combo with 2 listings + a name (and bundle price if money-enabled) → it appears as a `ComboCard` with member thumbnails and the price/"Barter only" line.
- The create button is disabled with <2 selected; a listing already in another combo is greyed out / non-selectable.
- Edit changes name/members/price; Remove shows the inline confirm, and Confirm deletes it.
- Move the event to MATCHING (organizer) → the New/Edit/Remove controls disappear (locked).

- [ ] **Step 7: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(combos-fe): My Combos builder section on the event page"
```

---

## Self-Review

**Spec coverage (Plan 2a portion):**
- `api/combos.ts` client (types, fns, hooks, keys) → Task 1 ✔
- "My Combos" section in EventDetailPage (list + create/edit/delete) → Task 2 ✔
- ComboCard (name, member thumbnails, price) + delete confirm → Task 2 ✔
- ComboForm (≥2 multi-select, name, optional price money-only) → Task 2 ✔
- Client guard: ≥2; grey out listings already in another combo (excluding the edited combo's own members) → Task 2 ✔
- Locked when `inputs_locked` → Task 2 ✔
- Surface backend 400 → `extractErrorMsg` in both handlers ✔
- Verification via build + lint + manual checklist → every task ✔
- 2b (trade builders) NOT included → respected ✔

**Placeholder scan:** none.

**Type/name consistency:** `Combo`/`ComboItemRead`/`ComboPayload`/`CombosParams` used consistently; hooks `useCombos`/`useCreateCombo`/`usePatchCombo`/`useDeleteCombo` match Task 1 exports; `MyCombosSection`/`ComboCard`/`ComboForm` props align; `editingMemberIds` excludes the edited combo's members from the grey-out; `extractErrorMsg` and `useEventListings`/`EventListing`/`useState` already exist/imported in EventDetailPage.

**Note for executor:** `payload` in `ComboForm.handleSave` is typed structurally to match `ComboPayload` (name/item_listing_ids/sell_price); `patchCombo` takes `Partial<ComboPayload>`, so passing the full object is valid for both create and patch.
