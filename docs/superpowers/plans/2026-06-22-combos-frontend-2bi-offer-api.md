# Combos Frontend 2b-i — API + Backend Delete + Offer-a-Combo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire combos into the trade layer's *offer* side: extend `api/trades.ts` with combo targets, add combo support to the `WantBid` delete endpoint (the deferred bit), and let the advanced builder offer a combo (`OfferGroupForm` → `item_combo_ids`), with wish cards labelling combo items.

**Architecture:** Type-only extensions to `api/trades.ts` (combo fields, mutually exclusive with `event_listing`); a small backend branch in `WantBidView.delete`; and additive UI in `WantListBuilderPage` (`OfferGroupForm` gains a combo multi-select; `OfferGroupCard`/`WishCard` render combo items).

**Tech Stack:** React 19 + TS + react-query (frontend); Django/DRF (backend). Frontend has **no test runner** — verify with `npm run build` + targeted `npx eslint <file>` + a manual checklist. Backend verifies with `manage.py test`.

**Spec:** `docs/superpowers/specs/2026-06-22-combos-frontend-design.md` (this plan is the offer-side + api/backend slice of "Plan 2b").

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/` (interpreter via `npm`). Backend cwd: `backend/` (interpreter `./.venv/bin/python`).

**Lint baseline:** repo `npm run lint` already fails on ONE pre-existing unrelated warning (`frontend/src/features/copies/CopyForm.tsx:15`). Gate per task = your changed file is clean via `npx eslint <file> --ext ts,tsx` (exit 0).

**Scope note:** *Wanting* a combo (visual grid + advanced want picker) and combo *bids* are Plan 2b-ii. This plan covers the offer side + the shared api/backend plumbing both need.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/combos-frontend-2bi
```

Expected: `Switched to a new branch 'feat/combos-frontend-2bi'`

---

### Task 1: `api/trades.ts` combo type extensions

**Files:**
- Modify: `frontend/src/api/trades.ts`

These additions make `combo` a first-class target alongside `event_listing` everywhere the backend now accepts it. Backend read shapes (from the merged backend): want/offer items expose `combo` (number|null), `combo_code`, `combo_name`; `event_listing`/`listing_code`/`board_game_*` are null for combo rows. `OfferGroup` accepts `item_combo_ids`. `WantBid` accepts `combo`.

- [ ] **Step 1: Extend `OfferGroupItem` + `OfferGroupPayload`**

In `frontend/src/api/trades.ts`, replace the `OfferGroupItem` interface (lines 8–15):

```ts
export interface OfferGroupItem {
  id: number
  event_listing: number
  listing_code: string
  board_game_name: string
  board_game_thumbnail: string
  board_game_id: number
}
```

with:

```ts
export interface OfferGroupItem {
  id: number
  event_listing: number | null
  listing_code: string | null
  board_game_name: string | null
  board_game_thumbnail: string
  board_game_id: number | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
}
```

Replace `OfferGroupPayload` (lines 30–34):

```ts
export interface OfferGroupPayload {
  name: string
  max_give: number
  item_listing_ids: number[]
}
```

with (combo ids optional so existing callers compile unchanged):

```ts
export interface OfferGroupPayload {
  name: string
  max_give: number
  item_listing_ids: number[]
  item_combo_ids?: number[]
}
```

- [ ] **Step 2: Extend `WantGroupItem` + `WantGroupItemPayload`**

Replace `WantGroupItem` (lines 36–46):

```ts
export interface WantGroupItem {
  id: number
  board_game_name: string | null
  board_game_thumbnail: string
  /** Canonical bgg id of the listing's game — use to group items under a game. */
  board_game_id: number | null
  event_listing: number
  listing_code: string | null
  resolved_bid?: string | null
  bid_is_override?: boolean
}
```

with:

```ts
export interface WantGroupItem {
  id: number
  board_game_name: string | null
  board_game_thumbnail: string
  /** Canonical bgg id of the listing's game — use to group items under a game. */
  board_game_id: number | null
  event_listing: number | null
  listing_code: string | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
  resolved_bid?: string | null
  bid_is_override?: boolean
}
```

Replace `WantGroupItemPayload` (lines 61–63):

```ts
export interface WantGroupItemPayload {
  event_listing: number
}
```

with (exactly one of the two is sent per item):

```ts
export interface WantGroupItemPayload {
  event_listing?: number
  combo?: number
}
```

- [ ] **Step 3: Extend `WantBid` payload/read + `deleteWantBid`**

Replace `WantBidPayload` + `WantBid` (lines 208–218):

```ts
export interface WantBidPayload {
  event_listing: number
  amount: string
}

export interface WantBid {
  id: number
  event_listing: number
  amount: string
  updated: string
}
```

with:

```ts
export interface WantBidPayload {
  event_listing?: number
  combo?: number
  amount: string
}

export interface WantBid {
  id: number
  event_listing: number | null
  combo: number | null
  amount: string
  updated: string
}
```

Replace `deleteWantBid` (lines 225–230):

```ts
export async function deleteWantBid(
  slug: string,
  target: { event_listing: number }
): Promise<void> {
  await apiClient.delete(`/events/${slug}/want-bids/`, { params: target })
}
```

with:

```ts
export async function deleteWantBid(
  slug: string,
  target: { event_listing: number } | { combo: number }
): Promise<void> {
  await apiClient.delete(`/events/${slug}/want-bids/`, { params: target })
}
```

- [ ] **Step 4: Keep existing consumers compiling (null-guards)**

Making `event_listing` nullable breaks four call sites that assumed non-null. Apply these minimal, correct guards (combo rows are simply skipped/preserved in these listing-centric reads; the visual grid surfaces combo wants in Plan 2b-ii).

In `frontend/src/features/trades/MyWantsPage.tsx`, in `buildModel`, the offer-group loop:

```tsx
  for (const og of offerGroups) {
    if (og.max_give === 1 && og.items.length === 1) {
      const lid = og.items[0].event_listing
      if (!offerGroupByListing.has(lid)) offerGroupByListing.set(lid, og)
    }
  }
```

becomes:

```tsx
  for (const og of offerGroups) {
    if (og.max_give === 1 && og.items.length === 1) {
      const lid = og.items[0].event_listing
      if (lid == null) continue  // combo offer item: not a per-listing trio
      if (!offerGroupByListing.has(lid)) offerGroupByListing.set(lid, og)
    }
  }
```

In the same function, the want-items loop:

```tsx
        for (const item of wg.items) {
          const key = listingTargetKey(item.event_listing)
```

becomes:

```tsx
        for (const item of wg.items) {
          if (item.event_listing == null) continue  // combo want item: visual grid handles in 2b-ii
          const key = listingTargetKey(item.event_listing)
```

In the same file, the `addTargetsToWantGroup`-style helper that rebuilds items (the block with `...group.items.map((i) => ({ event_listing: i.event_listing }))`):

```tsx
    const items: WantGroupItemPayload[] = [
      ...group.items.map((i) => ({ event_listing: i.event_listing })),
      ...toAdd.map((id) => ({ event_listing: id })),
    ]
```

becomes (preserve any combo want items already in the group):

```tsx
    const items: WantGroupItemPayload[] = [
      ...group.items.map((i) =>
        i.combo != null ? { combo: i.combo } : { event_listing: i.event_listing as number }
      ),
      ...toAdd.map((id) => ({ event_listing: id })),
    ]
```

In `frontend/src/features/trades/WantListBuilderPage.tsx`, the `OfferGroupForm` `selectedIds` initializer:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(existing?.items.map((i) => i.event_listing) ?? [])
  )
```

becomes (drop combo items from the listing-id set):

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(
      (existing?.items ?? [])
        .filter((i) => i.event_listing != null)
        .map((i) => i.event_listing as number)
    )
  )
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: builds with NO TypeScript errors (the guards keep every consumer compiling). If any error remains, fix that consumer with the same `event_listing == null` / `combo != null` guard pattern before proceeding.

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/api/trades.ts src/features/trades/MyWantsPage.tsx src/features/trades/WantListBuilderPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/api/trades.ts frontend/src/features/trades/MyWantsPage.tsx frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(combos-fe): combo target fields on trades API types (+ null-guards)"
```

---

### Task 2: Backend — `WantBidView.delete` accepts `?combo=`

**Files:**
- Modify: `backend/trades/views.py`
- Modify: `backend/trades/test_combos.py`

The backend `put` already branches on combo (added in the backend plan); `delete` still only handles `event_listing`. Add the combo branch so the FE can clear a combo bid.

- [ ] **Step 1: Write the failing test**

Append to `backend/trades/test_combos.py` (the file imports `Combo`, `EventListing`, etc. already; `WantBid` is imported in `ComboPricingTests` but add a top-of-method import to be safe):

```python
class ComboBidDeleteTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("bo", "bo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("bw", "bw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=7001, name="Bd1")
        cls.bg2 = BoardGame.objects.create(bgg_id=7002, name="Bd2")
        cls.event = TradeEvent.objects.create(
            name="BidDel Ev", organizer=cls.owner, status="WANTLIST_OPEN",
            money_enabled=True,
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="cb")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def test_delete_combo_bid(self):
        from trades.models import WantBid
        self.client.force_authenticate(self.wisher)
        self.client.put(
            f"/api/events/{self.event.slug}/want-bids/",
            {"combo": self.combo.id, "amount": "30.00"}, format="json",
        )
        self.assertTrue(
            WantBid.objects.filter(user=self.wisher, combo=self.combo).exists()
        )
        resp = self.client.delete(
            f"/api/events/{self.event.slug}/want-bids/?combo={self.combo.id}"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            WantBid.objects.filter(user=self.wisher, combo=self.combo).exists()
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos.ComboBidDeleteTests -v 2`
Expected: FAIL — `delete` ignores `combo` and returns 400 (`event_listing query param required`), so the bid still exists / status is 400.

- [ ] **Step 3: Add the combo branch to `WantBidView.delete`**

In `backend/trades/views.py`, the current `WantBidView.delete` is:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        el = request.query_params.get("event_listing")
        if not el:
            raise ValidationError({"detail": "event_listing query param required."})
        try:
            el_id = int(el)
        except (TypeError, ValueError):
            raise ValidationError({"event_listing": "Must be an integer."})
        WantBid.objects.filter(
            user=request.user, event=event, event_listing_id=el_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

Replace it with:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        combo = request.query_params.get("combo")
        if combo:
            try:
                combo_id = int(combo)
            except (TypeError, ValueError):
                raise ValidationError({"combo": "Must be an integer."})
            WantBid.objects.filter(
                user=request.user, event=event, combo_id=combo_id
            ).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        el = request.query_params.get("event_listing")
        if not el:
            raise ValidationError(
                {"detail": "event_listing or combo query param required."}
            )
        try:
            el_id = int(el)
        except (TypeError, ValueError):
            raise ValidationError({"event_listing": "Must be an integer."})
        WantBid.objects.filter(
            user=request.user, event=event, event_listing_id=el_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos.ComboBidDeleteTests -v 2`
Expected: PASS.

- [ ] **Step 5: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades -v 1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/views.py backend/trades/test_combos.py
git commit -m "feat(combos): WantBidView.delete accepts ?combo="
```

---

### Task 3: Advanced builder — offer a combo + label combo items

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

`OfferGroupForm` currently selects listings only and submits `{name, max_give, item_listing_ids}`. Add a combo multi-select and submit `item_combo_ids`. `OfferGroupCard` renders listing chips; add combo chips. `WishCard` renders offer/want items as thumbnails; combo items have empty thumbnails, so label them.

- [ ] **Step 1: Import the combos hook + type**

In `frontend/src/features/trades/WantListBuilderPage.tsx`, find the trades-api import block (it imports `useOfferGroups`, `useCreateOfferGroup`, etc. near the top, around lines 11–28). Add after the existing `../../api/trades` import group:

```tsx
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'
```

- [ ] **Step 2: Extend `OfferGroupForm` props + state for combos**

Replace the `OfferGroupFormProps` interface (lines 239–251):

```tsx
interface OfferGroupFormProps {
  slug: string
  myListings: EventListing[]
  moneyEnabled: boolean
  existing?: OfferGroup
  onSave: (payload: {
    name: string
    max_give: number
    item_listing_ids: number[]
  }) => Promise<void>
  onCancel: () => void
  isSaving: boolean
}
```

with (add `item_combo_ids` to the save payload):

```tsx
interface OfferGroupFormProps {
  slug: string
  myListings: EventListing[]
  moneyEnabled: boolean
  existing?: OfferGroup
  onSave: (payload: {
    name: string
    max_give: number
    item_listing_ids: number[]
    item_combo_ids: number[]
  }) => Promise<void>
  onCancel: () => void
  isSaving: boolean
}
```

This step is **additive** — Task 1 Step 4 already changed the `selectedIds` initializer to filter combo items, so do NOT re-edit that line. Make two anchored edits.

Edit (a) — add `slug` to the destructure and load the user's combos. Replace:

```tsx
function OfferGroupForm({ myListings, moneyEnabled, existing, onSave, onCancel, isSaving }: OfferGroupFormProps) {
  const [name, setName] = useState(existing?.name ?? '')
```

with:

```tsx
function OfferGroupForm({ slug, myListings, moneyEnabled, existing, onSave, onCancel, isSaving }: OfferGroupFormProps) {
  const { data: combosData } = useCombos(slug, { mine: true })
  const myCombos = combosData?.results ?? []
  const [name, setName] = useState(existing?.name ?? '')
```

Edit (b) — add `selectedComboIds` state + `toggleCombo`. Replace:

```tsx
  const [formError, setFormError] = useState<string | null>(null)

  function toggleListing(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
```

with:

```tsx
  const [selectedComboIds, setSelectedComboIds] = useState<Set<number>>(
    new Set(
      (existing?.items ?? [])
        .filter((i) => i.combo != null)
        .map((i) => i.combo as number)
    )
  )
  const [formError, setFormError] = useState<string | null>(null)

  function toggleListing(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCombo(id: number) {
    setSelectedComboIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
```

- [ ] **Step 3: Update `handleSubmit` to count combos + send `item_combo_ids`**

Replace the `handleSubmit` body (lines 270–280):

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required.'); return }
    const mg = parseInt(maxGive, 10)
    if (isNaN(mg) || mg < 1) { setFormError('Max give must be at least 1.'); return }
    if (selectedIds.size === 0) { setFormError('Select at least one listing.'); return }
    if (mg > selectedIds.size) { setFormError(`Max give (${mg}) cannot exceed the number of selected listings (${selectedIds.size}).`); return }

    await onSave({ name: name.trim(), max_give: mg, item_listing_ids: Array.from(selectedIds) })
  }
```

with:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required.'); return }
    const mg = parseInt(maxGive, 10)
    if (isNaN(mg) || mg < 1) { setFormError('Max give must be at least 1.'); return }
    const totalSelected = selectedIds.size + selectedComboIds.size
    if (totalSelected === 0) { setFormError('Select at least one listing or combo.'); return }
    if (mg > totalSelected) { setFormError(`Max give (${mg}) cannot exceed the number of selected items (${totalSelected}).`); return }

    await onSave({
      name: name.trim(),
      max_give: mg,
      item_listing_ids: Array.from(selectedIds),
      item_combo_ids: Array.from(selectedComboIds),
    })
  }
```

- [ ] **Step 4: Render a combo multi-select in the form**

Find the end of the listings selection block in `OfferGroupForm` — the `</div>` closing the `Select listings to offer` block, immediately before the form's action buttons. (Search for the text `Select listings to offer ({selectedIds.size} selected)`; the surrounding `<div>` ends a few lines after the `myListings.map(...)` list.) Directly AFTER that closing `</div>` and before the submit/cancel buttons, insert the combo picker:

```tsx
      {myCombos.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink mb-1.5">
            Or offer a combo ({selectedComboIds.size} selected)
          </p>
          <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
            {myCombos.map((c: Combo) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer transition-colors text-sm ${
                  selectedComboIds.has(c.id)
                    ? 'border-indigo-400 bg-white text-indigo-800'
                    : 'border-ink/15 bg-white text-ink hover:border-indigo-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedComboIds.has(c.id)}
                  onChange={() => toggleCombo(c.id)}
                  className="h-3.5 w-3.5 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-moss/70">{c.combo_code}</span>
                <span className="ml-auto text-xs text-moss/60">{c.items.length} items</span>
              </label>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Pass `slug` to `OfferGroupForm` at its call sites**

`OfferGroupForm` now requires `slug`. Find its usages in `OfferGroupsPanel` (search `<OfferGroupForm`). There are two (the "create" form near line 97 and the "edit" form near line 135). Add `slug={slug}` to each (the panel already has `slug` in scope as a prop). Example — change each occurrence from:

```tsx
          <OfferGroupForm
            myListings={myListings}
```

to:

```tsx
          <OfferGroupForm
            slug={slug}
            myListings={myListings}
```

(Apply to BOTH `<OfferGroupForm ...>` usages.)

- [ ] **Step 6: Thread `item_combo_ids` through the panel's save handlers**

In `OfferGroupsPanel`, the create/edit handlers call `createGroup.mutateAsync`/`patchGroup.mutateAsync` with the form payload. The payload now includes `item_combo_ids`. Find the two `onSave={...}` handlers passed to `<OfferGroupForm>`. They currently forward `{ name, max_give, item_listing_ids }` to the mutation. Update both to forward the whole payload object (which now also carries `item_combo_ids`). Concretely, wherever a handler builds the mutation `payload`, change a spread/explicit object like:

```tsx
        payload: { name: p.name, max_give: p.max_give, item_listing_ids: p.item_listing_ids },
```

to:

```tsx
        payload: { name: p.name, max_give: p.max_give, item_listing_ids: p.item_listing_ids, item_combo_ids: p.item_combo_ids },
```

If a handler already forwards the payload object directly (e.g. `onSave={(p) => createGroup.mutateAsync({ slug, payload: p })}`), no change is needed there — `p` already contains `item_combo_ids`. Verify both create and edit paths pass `item_combo_ids`.

- [ ] **Step 7: Render combo chips in `OfferGroupCard`**

In `OfferGroupCard`, the items render block (lines 222–233) maps `group.items` to listing chips assuming `listing_code`/`board_game_name`. Replace that `.map` block:

```tsx
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-ink"
            >
              <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
              <span className="font-mono text-moss/70">{item.listing_code}</span>
              {item.board_game_name}
            </span>
          ))}
        </div>
```

with (combo items render a combo chip):

```tsx
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) =>
            item.combo != null ? (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              >
                🎁 {item.combo_name}
                <span className="font-mono text-amber-700/70">{item.combo_code}</span>
              </span>
            ) : (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-ink"
              >
                <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
                <span className="font-mono text-moss/70">{item.listing_code}</span>
                {item.board_game_name}
              </span>
            )
          )}
        </div>
```

- [ ] **Step 8: Label combo items in `WishCard`**

In `WishCard`, offer/want items render as bare `<GameThumb>` (lines 1215–1233). Combo items have empty thumbnails, so render a small combo badge instead. Replace the two `.map` blocks (offerItems then wantItems) inside the `flex flex-wrap` container:

```tsx
              {offerItems.map((item) => (
                <GameThumb
                  key={item.id}
                  src={item.board_game_thumbnail}
                  alt={item.board_game_name ?? ''}
                  className="h-7 w-7"
                />
              ))}
              <svg className="h-4 w-4 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {wantItems.map((item) => (
                <GameThumb
                  key={item.id}
                  src={item.board_game_thumbnail}
                  alt={item.board_game_name ?? ''}
                  className="h-7 w-7"
                />
              ))}
```

with:

```tsx
              {offerItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? 'combo'}>
                    🎁 {item.combo_code}
                  </span>
                ) : (
                  <GameThumb key={item.id} src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-7 w-7" />
                )
              )}
              <svg className="h-4 w-4 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {wantItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? 'combo'}>
                    🎁 {item.combo_code}
                  </span>
                ) : (
                  <GameThumb key={item.id} src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-7 w-7" />
                )
              )}
```

- [ ] **Step 9: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/WantListBuilderPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 10: Manual QA checklist**

With the dev server + backend, on an event where you have ≥1 combo (create one via the event page's "My Combos"):
- Advanced builder → Offer Groups → New offer group shows an "Or offer a combo" picker listing your combos.
- Select a combo (+ optionally listings), set max give, save → the offer group card shows a 🎁 combo chip.
- Edit the offer group → the combo stays selected; deselecting + saving removes it.
- A wish using that offer group shows the 🎁 combo badge in its card.

- [ ] **Step 11: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(combos-fe): offer a combo in the advanced builder; label combo items"
```

---

## Self-Review

**Spec coverage (offer-side + api/backend slice):**
- `api/trades.ts`: combo on want item payload/read, `item_combo_ids` on offer, combo on WantBid payload/read, `deleteWantBid` combo target → Task 1 ✔
- Backend `WantBidView.delete` combo support + test → Task 2 ✔
- Advanced builder `OfferGroupForm` combo offer (`item_combo_ids`) + `OfferGroupCard` combo chips + `WishCard` combo labels → Task 3 ✔
- Want-side combo (visual grid + advanced want picker) + bids → deferred to Plan 2b-ii (stated) ✔
- Verify via build + targeted eslint + manual / backend tests → every task ✔

**Placeholder scan:** none.

**Type/name consistency:** `OfferGroupPayload.item_combo_ids` (optional) matches the form payload (required there) and the panel mutation; `OfferGroupItem.combo`/`combo_code`/`combo_name` used in `OfferGroupCard` + `WishCard`; `WantGroupItem.combo` etc. used by `WishCard`; `useCombos(slug,{mine:true})` returns `{results: Combo[]}`; `Combo.items.length`/`combo_code`/`name` match `api/combos.ts`.

**Notes for the executor:**
- Step 6 (panel save handlers): inspect both create and edit `onSave` handlers in `OfferGroupsPanel`; the goal is that `item_combo_ids` reaches `createOfferGroup`/`patchOfferGroup`. If a handler forwards the payload object wholesale, it already works; only explicitly-rebuilt payloads need the extra key.
- Step 4 anchor: insert the combo picker as a sibling block after the listings `<div>` and before the action buttons; it is gated on `myCombos.length > 0` so events without combos are visually unchanged.
- Making `event_listing` nullable (Task 1) ripples into `MyWantsPage` + `WantListBuilderPage`; Task 1 **Step 4** applies the minimal null-guards so the whole repo compiles green after Task 1. Task 3 then builds additively on that green base (it does not re-edit the `selectedIds` initializer Task 1 changed). If `npm run build` surfaces any *other* non-null `event_listing`/`combo` consumer, apply the same guard pattern (`event_listing == null` → skip; `combo != null` → handle) and note it.
