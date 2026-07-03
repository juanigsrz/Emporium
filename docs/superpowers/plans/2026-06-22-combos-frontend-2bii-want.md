# Combos Frontend 2b-ii — Want a Combo (visual builder + data-safety)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users *want* a combo in the visual "My Wants" builder, persisting as a `WantGroupItem.combo`; and make the advanced builder safely display + preserve combo want-items (the 2b-i deferrals).

**Architecture:** In `MyWantsPage`, model each event combo as its own want **group** (a single `Target` with a `comboId` and a synthetic per-combo `gameId`), built into `model.baseTargets` (survives `editor.reset()`). The existing visual/grid views render it generically; the save maps `comboId → {combo}`. In `WantListBuilderPage`, `WantGroupCard` renders combo chips and `WantGroupEditor` keeps combo items through edit/save.

**Tech Stack:** React 19 + TS + react-query. No test runner — verify with `npm run build` + targeted `npx eslint <file>` (exit 0) + a manual checklist.

**Spec:** `docs/superpowers/specs/2026-06-22-combos-frontend-design.md` (this is the want-side slice of "Plan 2b").

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/`.

**Lint baseline:** repo `npm run lint` already fails on pre-existing `frontend/src/features/copies/CopyForm.tsx:15`. Gate per task = changed file clean via `npx eslint <file> --ext ts,tsx` (exit 0).

**Out of scope (noted follow-ups):** combo *bids* in the visual builder (its money UI is per-game `UserGamePrice`; combos have no game — the inputs don't map; combo bids can be added later via the advanced builder or a dedicated control); an advanced-builder combo *want picker* (adding a combo to a want group through `WantGroupEditor` — the visual builder already lets you want combos); GameBrowse/catalog combo surfacing (combos appear in the visual + grid views).

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/combos-frontend-2bii
```

Expected: `Switched to a new branch 'feat/combos-frontend-2bii'`

---

### Task 1: `Target` gains `comboId`; save maps combos to `{combo}`

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Add `comboId` to the `Target` interface**

In `frontend/src/features/trades/MyWantsPage.tsx`, the `Target` interface is:

```tsx
interface Target {
  key: string
  listingId: number
  label: string
  /** Canonical game this target belongs to — listings group under it. */
  gameId: number
  gameName: string
  /** Thumbnail of the canonical game (for the Visual view's receive cluster). */
  thumbnail?: string | null
}
```

Replace with (combo targets set `comboId`; `listingId` is unused/0 for them):

```tsx
interface Target {
  key: string
  listingId: number
  label: string
  /** Canonical game this target belongs to — listings group under it. */
  gameId: number
  gameName: string
  /** Thumbnail of the canonical game (for the Visual view's receive cluster). */
  thumbnail?: string | null
  /** Set when this target is a Combo (not a listing). */
  comboId?: number
}
```

- [ ] **Step 2: Add a combo key helper + synthetic-game offset**

Directly after the existing `listingTargetKey` helper:

```tsx
function listingTargetKey(listingId: number): string {
  return `L:${listingId}`
}
```

add:

```tsx
// Combo targets render as their own one-row group, keyed off a synthetic gameId
// well above any real bgg id so they never collide with a game group.
const COMBO_GAME_OFFSET = 1_000_000_000

function comboTargetKey(comboId: number): string {
  return `K:${comboId}`
}
```

- [ ] **Step 3: Map combo targets to `{combo}` in the save**

In `persistChanges`, the per-listing items build is:

```tsx
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) => ({
      event_listing: t.listingId,
    }))
```

Replace the `.map` with:

```tsx
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) =>
      t.comboId != null ? { combo: t.comboId } : { event_listing: t.listingId }
    )
```

- [ ] **Step 4: Skip combo synthetic game ids in the price-persist loop**

In `persistChanges`, the per-game price loop currently skips negative synthetic ids:

```tsx
    for (const [gameId, value] of editor.changedGamePrices) {
      // Per-game prices are keyed by bgg id; LISTING-only targets that lack a
      // real bgg id use a negative synthetic id and can't be priced.
      if (gameId < 0) continue
```

Replace that guard line with one that also skips combo synthetic ids (combos have no per-game price):

```tsx
    for (const [gameId, value] of editor.changedGamePrices) {
      // Per-game prices are keyed by bgg id; LISTING-only targets use a negative
      // synthetic id and combos use a >= COMBO_GAME_OFFSET id — neither is priceable.
      if (gameId < 0 || gameId >= COMBO_GAME_OFFSET) continue
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos-fe): Target.comboId + save combo wants as {combo}"
```

---

### Task 2: Surface event combos as want targets in the visual builder

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

`buildModel` reads the loaded trade objects into the page model. Extend it to (a) record combo want-items into `baseMatrix`/`baseTargets`, and (b) inject every event combo (excluding the user's own) as an always-present `baseTargets` row so it can be wanted. Then thread `combos` + `username` into `buildModel` from the page (via `useCombos`).

- [ ] **Step 1: Import the combos hook + type**

In `frontend/src/features/trades/MyWantsPage.tsx`, find the events-api import (`import { useEvent, useEventListings, useEventGames, fetchEventListings } from '../../api/events'`). Add after the trades-api imports near the top:

```tsx
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'
```

- [ ] **Step 2: Extend `buildModel` to handle combos**

`buildModel`'s signature is:

```tsx
function buildModel(
  myListings: EventListing[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[],
  gamePrices: GamePrice[]
): PageModel {
```

Replace it with (two new params):

```tsx
function buildModel(
  myListings: EventListing[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[],
  gamePrices: GamePrice[],
  combos: Combo[],
  username: string | undefined
): PageModel {
```

In the want-items loop, the current body (after the 2b-i guard) is:

```tsx
        for (const item of wg.items) {
          if (item.event_listing == null) continue  // combo want item: visual grid handles in 2b-ii
          const key = listingTargetKey(item.event_listing)
          set.add(key)
          if (!baseTargets.has(key)) {
            baseTargets.set(key, {
              key,
              listingId: item.event_listing,
              label: item.listing_code ?? `Listing ${item.event_listing}`,
              // board_game_id is the canonical game of the listing's copy →
              // lets specific-copy wants fold under their game row.
              gameId: item.board_game_id ?? -item.event_listing,
              gameName: item.board_game_name ?? `Listing ${item.event_listing}`,
              thumbnail: item.board_game_thumbnail,
            })
          }
        }
```

Replace it (handle combo want-items instead of skipping them):

```tsx
        for (const item of wg.items) {
          if (item.combo != null) {
            const key = comboTargetKey(item.combo)
            set.add(key)
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                listingId: 0,
                comboId: item.combo,
                label: item.combo_code ?? `Combo ${item.combo}`,
                gameId: COMBO_GAME_OFFSET + item.combo,
                gameName: `🎁 ${item.combo_name ?? 'Combo'}`,
                thumbnail: null,
              })
            }
            continue
          }
          if (item.event_listing == null) continue
          const key = listingTargetKey(item.event_listing)
          set.add(key)
          if (!baseTargets.has(key)) {
            baseTargets.set(key, {
              key,
              listingId: item.event_listing,
              label: item.listing_code ?? `Listing ${item.event_listing}`,
              // board_game_id is the canonical game of the listing's copy →
              // lets specific-copy wants fold under their game row.
              gameId: item.board_game_id ?? -item.event_listing,
              gameName: item.board_game_name ?? `Listing ${item.event_listing}`,
              thumbnail: item.board_game_thumbnail,
            })
          }
        }
```

Then, just before `buildModel`'s `return` statement (`return { wantGroupByListing, offerGroupByListing, ... }`), inject every event combo (excluding own) as an always-present target row:

```tsx
  // Surface every active combo (not the user's own) as a wantable target row,
  // even if not yet wanted. Its own one-row group (synthetic gameId) renders in
  // the visual/grid views; baseMatrix above already marks the wanted ones.
  for (const c of combos) {
    if (c.owner_username === username) continue
    const key = comboTargetKey(c.id)
    if (!baseTargets.has(key)) {
      baseTargets.set(key, {
        key,
        listingId: 0,
        comboId: c.id,
        label: c.combo_code,
        gameId: COMBO_GAME_OFFSET + c.id,
        gameName: `🎁 ${c.name}`,
        thumbnail: c.items[0]?.board_game_thumbnail ?? null,
      })
    }
  }

  return { wantGroupByListing, offerGroupByListing, baseMatrix, baseTargets, baseMoneyByGame }
```

(Delete the original `return { ... }` line so this replacement is the only return.)

- [ ] **Step 3: Load combos in the page + pass to `buildModel`**

In the page component (`MyWantsPage`), the data hooks are loaded around:

```tsx
  const { data: offerGroups = [] } = useOfferGroups(slug)
  const { data: wantGroups = [] } = useWantGroups(slug)
  const { data: wishes = [] } = useWishes(slug)
```

Add a combos load after them:

```tsx
  const { data: combosData } = useCombos(slug)
  const combos = combosData?.results ?? []
```

The `buildModel` call is wrapped in a `useMemo`:

```tsx
    () => buildModel(myListings, offerGroups, wantGroups, wishes, gamePrices),
    [myListings, offerGroups, wantGroups, wishes, gamePrices]
```

Replace it with (pass `combos` + the current username; add both to deps):

```tsx
    () => buildModel(myListings, offerGroups, wantGroups, wishes, gamePrices, combos, user?.username),
    [myListings, offerGroups, wantGroups, wishes, gamePrices, combos, user?.username]
```

(The page already has `const { user } = useAuthStore()` in scope.)

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 5: Manual QA checklist**

With dev server + backend, as a user who has ≥1 listing in an event where ANOTHER user created a combo:
- Open My Wants → switch to the **Visual** (and **Grid**) view. The combo appears as its own row/column labelled `🎁 <combo name>`, distinct from game rows.
- Toggle the combo on for one of your items → the unsaved-changes bar appears → Save. Reload: the combo stays wanted (persisted as a `WantGroupItem.combo`).
- Toggle it off → Save → reload: no longer wanted.
- Your OWN combos do NOT appear as wantable targets.
- (Catalog view: combos are not surfaced there — known; visual/grid cover wanting. Combo rows show no price input effect — combo bids are out of scope this slice.)

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos-fe): want a combo in the visual builder (own group + persistence)"
```

---

### Task 3: Advanced builder — render + preserve combo want-items

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

A combo can land in a want group (via the visual builder). The advanced builder must (a) render those combo items in `WantGroupCard` instead of blank chips, and (b) preserve them through `WantGroupEditor` open→save (today its `DraftWantItem` is listing-only, so saving drops combos). This is data-safety, not a new combo picker.

- [ ] **Step 1: Combo chips in `WantGroupCard`**

In `frontend/src/features/trades/WantListBuilderPage.tsx`, the `WantGroupCard` items render is:

```tsx
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-blue-50 text-blue-700"
            >
              <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
              <span className="font-mono text-moss/70">{item.listing_code}</span>
              {item.board_game_name}
              {item.resolved_bid != null && (
                <span className="rounded bg-emerald-100 px-1 font-semibold text-emerald-700">
                  pay ≤${item.resolved_bid}
                </span>
              )}
            </span>
          ))}
        </div>
```

Replace with:

```tsx
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) =>
            item.combo != null ? (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-amber-100 text-amber-800"
              >
                🎁 {item.combo_name}
                <span className="font-mono text-amber-700/70">{item.combo_code}</span>
              </span>
            ) : (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-blue-50 text-blue-700"
              >
                <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
                <span className="font-mono text-moss/70">{item.listing_code}</span>
                {item.board_game_name}
                {item.resolved_bid != null && (
                  <span className="rounded bg-emerald-100 px-1 font-semibold text-emerald-700">
                    pay ≤${item.resolved_bid}
                  </span>
                )}
              </span>
            )
          )}
        </div>
```

- [ ] **Step 2: Extend `DraftWantItem` + `makeDraftKey` for combos**

The `DraftWantItem` interface is:

```tsx
  board_game_name: string | null
  event_listing: number
  listing_code: string | null
  bid: string  // '' = none
}
```

(The full interface starts a few lines above with `interface DraftWantItem {` and `localId: string`.) Replace the whole interface with:

```tsx
interface DraftWantItem {
  localId: string
  board_game_name: string | null
  event_listing: number | null
  listing_code: string | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
  bid: string  // '' = none
}
```

`makeDraftKey` is:

```tsx
function makeDraftKey(item: WantGroupItem | DraftWantItem): string {
  return `listing-${item.event_listing}`
}
```

Replace with:

```tsx
function makeDraftKey(item: WantGroupItem | DraftWantItem): string {
  return item.combo != null ? `combo-${item.combo}` : `listing-${item.event_listing}`
}
```

- [ ] **Step 3: Keep combo items in the editor's `items` state**

The `WantGroupEditor` `items` initializer (which Task 2b-i made filter combos out) is:

```tsx
  const [items, setItems] = useState<DraftWantItem[]>(() =>
    (group?.items ?? [])
      .filter((i) => i.event_listing != null)
      .map((i) => ({
        localId: makeDraftKey(i),
        board_game_name: i.board_game_name,
        event_listing: i.event_listing as number,
        listing_code: i.listing_code,
        bid: i.bid_is_override ? (i.resolved_bid ?? '') : '',
      }))
  )
```

Replace with (include combo items, carry combo fields):

```tsx
  const [items, setItems] = useState<DraftWantItem[]>(() =>
    (group?.items ?? []).map((i) => ({
      localId: makeDraftKey(i),
      board_game_name: i.board_game_name,
      event_listing: i.event_listing,
      listing_code: i.listing_code,
      combo: i.combo,
      combo_code: i.combo_code,
      combo_name: i.combo_name,
      bid: i.bid_is_override ? (i.resolved_bid ?? '') : '',
    }))
  )
```

- [ ] **Step 4: Carry combo fields when adding listings via the picker**

`handlePickerCommit` builds `DraftWantItem`s for listings; they now need the combo fields set null. The additions object is:

```tsx
        additions.push({
          localId,
          board_game_name: listing.board_game_name,
          event_listing: listing.id,
          listing_code: listing.listing_code,
          bid: '',
        })
```

Replace with:

```tsx
        additions.push({
          localId,
          board_game_name: listing.board_game_name,
          event_listing: listing.id,
          listing_code: listing.listing_code,
          combo: null,
          combo_code: null,
          combo_name: null,
          bid: '',
        })
```

- [ ] **Step 5: Emit combo items in the payload; skip combos in bid-save**

`buildPayloadItems` is:

```tsx
  function buildPayloadItems(): WantGroupItemPayload[] {
    return items.map((item) => ({ event_listing: item.event_listing }))
  }
```

Replace with:

```tsx
  function buildPayloadItems(): WantGroupItemPayload[] {
    return items.map((item) =>
      item.combo != null ? { combo: item.combo } : { event_listing: item.event_listing as number }
    )
  }
```

`saveWantBids` is:

```tsx
  async function saveWantBids() {
    if (!moneyEnabled) return
    for (const item of items) {
      const trimmed = item.bid.trim()
      if (trimmed === '') {
        await deleteWantBid(slug, { event_listing: item.event_listing })
      } else {
        await setWantBid(slug, { event_listing: item.event_listing, amount: trimmed })
      }
    }
  }
```

Replace with (combo items have no per-listing bid here — combo bids are out of scope this slice):

```tsx
  async function saveWantBids() {
    if (!moneyEnabled) return
    for (const item of items) {
      if (item.combo != null) continue
      const listingId = item.event_listing as number
      const trimmed = item.bid.trim()
      if (trimmed === '') {
        await deleteWantBid(slug, { event_listing: listingId })
      } else {
        await setWantBid(slug, { event_listing: listingId, amount: trimmed })
      }
    }
  }
```

- [ ] **Step 6: Render combo items in the editor's target list**

The editor's per-item row (inside `items.map((item) => (...))`) renders the name/code and a bid input. The current row's identity + bid blocks are:

```tsx
                <div className="min-w-0">
                  <span className="text-sm text-ink font-medium truncate block">
                    {item.board_game_name}
                  </span>
                  <span className="text-xs text-blue-600 font-mono">{item.listing_code}</span>
                </div>
                {moneyEnabled && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-moss/70">pay ≤$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.bid}
                      onChange={(e) => setMoney(item.localId, e.target.value)}
                      placeholder="0"
                      title="Most money you'll pay to receive this game (needs a seller who accepts money)"
                      className="w-20 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                )}
```

Replace with (combo rows show combo identity + no per-listing bid input):

```tsx
                <div className="min-w-0">
                  {item.combo != null ? (
                    <>
                      <span className="text-sm text-ink font-medium truncate block">
                        🎁 {item.combo_name}
                      </span>
                      <span className="text-xs text-amber-600 font-mono">{item.combo_code}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-ink font-medium truncate block">
                        {item.board_game_name}
                      </span>
                      <span className="text-xs text-blue-600 font-mono">{item.listing_code}</span>
                    </>
                  )}
                </div>
                {moneyEnabled && item.combo == null && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-moss/70">pay ≤$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.bid}
                      onChange={(e) => setMoney(item.localId, e.target.value)}
                      placeholder="0"
                      title="Most money you'll pay to receive this game (needs a seller who accepts money)"
                      className="w-20 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                )}
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/WantListBuilderPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 8: Manual QA checklist**

With a want group that contains a combo (created via the visual builder in Task 2):
- Advanced builder → Want Groups → the group's card shows the combo as a `🎁 <name>` amber chip (not a blank thumbnail).
- Open that group's editor → the combo appears in the targets list as `🎁 <name>` with no bid input; listings still show their bid input.
- Save the group (even after only changing the name) → reopen / reload: the combo is still in the group (not dropped).

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(combos-fe): render + preserve combo want-items in the advanced builder"
```

---

## Self-Review

**Spec coverage (want-side slice):**
- Combo wantable in the visual builder, persisted as `WantGroupItem.combo` → Tasks 1–2 ✔
- Combo modeled as its own group (synthetic gameId), rendered by existing visual/grid views, survives `reset()` (built into `baseTargets`) → Task 2 ✔
- Own combos excluded → Task 2 (`c.owner_username === username` skip) ✔
- Advanced builder shows + preserves combo want-items → Task 3 ✔
- Combo bids / advanced combo *picker* / catalog surfacing → explicitly deferred (stated) ✔
- Verify via build + targeted eslint + manual → every task ✔

**Placeholder scan:** none.

**Type/name consistency:** `Target.comboId` used in save (Task 1) + built in `buildModel` (Task 2); `comboTargetKey`/`COMBO_GAME_OFFSET` defined Task 1, used Task 2 (+ persist skip); `buildModel` new params `combos: Combo[], username` match the call site; `DraftWantItem` combo fields (`combo`/`combo_code`/`combo_name`, `event_listing` nullable) consistent across initializer, `handlePickerCommit`, `buildPayloadItems`, `saveWantBids`, and the row render; `WantGroupItem.combo`/`combo_code`/`combo_name` (from 2b-i) read by `WantGroupCard` + editor.

**Notes for the executor:**
- The visual/grid views (`VisualMode`/`GridMode`) and `GameBrowse` already iterate `editor.targets` grouped by `gameId` and toggle via `editor.toggle(listingId, target.key)` — a combo target (its own synthetic-gameId group) renders and toggles with no view changes. If a view turns out to read a listing-only field that breaks on a combo target, guard it with `t.comboId != null` and report.
- Task 2 Step 2 replaces the want-items loop AND the `return` line; apply both edits before building.
