# COMBO Feature Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three remaining frontend problems in the combo feature (invisible buttons, no browse path / grid pollution, blank visual rendering) plus the one backend change needed so a combo's displayed bid matches what the solver actually bids.

**Architecture:** Combos stop being their own synthetic-gameId row. They are browsed/wished *inside the copy dropdown of each member game* (`GameCopies`), and a wished combo renders in the visual card as an outlined cluster of member thumbnails. Backend `resolve_bid` gains a member-price fallback so the read-only price shown in the UI equals the solver's bid.

**Tech Stack:** Django REST (backend), React + TypeScript + Vite + Tailwind (frontend). No frontend test runner — FE tasks verify with `npm run build` (tsc typecheck) and `npm run lint`.

## Global Constraints

- Tailwind palette has no `fern`; primary buttons use `bg-butter … text-ink` (see `tailwind.config.js`).
- Combo target key in `MyWantsPage.tsx` is `comboTargetKey(id)` → `"K:<id>"`; combo synthetic gameId is `COMBO_GAME_OFFSET + id` (`COMBO_GAME_OFFSET = 1_000_000_000`).
- A user never wants their own combo: filter `c.owner_username !== username`.
- Backend tests run from `backend/`: `python manage.py test trades.test_combos -v 2`.
- FE verification from `frontend/`: `npm run build` then `npm run lint` (lint is `--max-warnings 0`).
- Commit after each task.

---

### Task 1: Backend — combo bid falls back to max member-game price

**Files:**
- Modify: `backend/trades/pricing.py` (`resolve_bid`, add `load_combo_members`, module docstring)
- Modify: `backend/matching/external_solver.py:210-214,279`
- Test: `backend/trades/test_combos.py` (class `ComboPricingTests`)

**Interfaces:**
- Produces: `load_combo_members(event) -> dict[int, list[int]]` (combo_id → member board_game_ids); `resolve_bid(user, event, target, bids=None, game_prices=None, combo_bids=None, combo_members=None)` — combo target now returns `WantBid(user,combo)` override else `max` of the user's `UserGamePrice` over member games else `None`.

- [ ] **Step 1: Write the failing tests** — append to class `ComboPricingTests` in `backend/trades/test_combos.py` (members of `self.combo` are `self.bg1`, `self.bg2`):

```python
    def test_resolve_bid_combo_falls_back_to_max_member_price(self):
        from trades.models import UserGamePrice, WantGroup, WantGroupItem
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg1, price="10.00"
        )
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg2, price="18.00"
        )
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("18.00"))

    def test_resolve_bid_combo_override_beats_member_price(self):
        from trades.models import UserGamePrice, WantGroup, WantGroupItem
        UserGamePrice.objects.create(
            user=self.wisher, event=self.event, board_game=self.bg1, price="10.00"
        )
        WantBid.objects.create(
            user=self.wisher, event=self.event, combo=self.combo, amount="3.00"
        )
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w2")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("3.00"))

    def test_resolve_bid_combo_none_when_no_member_price(self):
        from trades.models import WantGroup, WantGroupItem
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w3")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertIsNone(resolve_bid(self.wisher, self.event, wi))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test trades.test_combos.ComboPricingTests -v 2`
Expected: the two new positive tests FAIL (`resolve_bid` returns `None` for the fallback case; override test still passes since override path unchanged).

- [ ] **Step 3: Add `load_combo_members` to `backend/trades/pricing.py`** — insert after `load_combo_bids` (after line 61):

```python
def load_combo_members(event):
    """Preload combo membership: combo_id -> [member board_game_id, ...]."""
    from events.models import ComboItem
    members = {}
    rows = (
        ComboItem.objects
        .filter(combo__event=event)
        .values_list("combo_id", "event_listing__copy__board_game_id")
    )
    for cid, bgid in rows:
        members.setdefault(cid, []).append(bgid)
    return members
```

- [ ] **Step 4: Replace the combo branch of `resolve_bid`** in `backend/trades/pricing.py`. Change the signature line 101 and the branch at lines 108-117.

Signature (line 101):

```python
def resolve_bid(user, event, target, bids=None, game_prices=None, combo_bids=None,
                combo_members=None):
```

Replace lines 108-117 (the `if combo_id:` block) with:

```python
    combo_id = getattr(target, "combo_id", None)
    if combo_id:
        if combo_bids is not None:
            override = combo_bids.get((user.id, combo_id))
        else:
            override = (
                WantBid.objects
                .filter(user=user, event=event, combo_id=combo_id)
                .values_list("amount", flat=True)
                .first()
            )
        if override is not None:
            return override
        # Fallback: highest of the user's per-game bids over the combo's member
        # games (None if they priced none of them).
        if combo_members is not None:
            bgids = combo_members.get(combo_id, [])
        else:
            from events.models import ComboItem
            bgids = list(
                ComboItem.objects
                .filter(combo_id=combo_id)
                .values_list("event_listing__copy__board_game_id", flat=True)
            )
        prices = []
        for bgid in bgids:
            p = (game_prices.get((user.id, bgid)) if game_prices is not None
                 else _game_default(user.id, event.id, bgid))
            if p is not None:
                prices.append(p)
        return max(prices) if prices else None
```

- [ ] **Step 5: Update the module docstring** in `backend/trades/pricing.py` — replace lines 16-17:

```python
Combo targets: `resolve_ask_target` reads `combo.sell_price` (no fallback);
`resolve_bid` returns the explicit `WantBid(user, combo)` override else the
highest `UserGamePrice` over the combo's member games else None.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python manage.py test trades.test_combos -v 2`
Expected: PASS (all combo tests, including the three new ones).

- [ ] **Step 7: Wire the fallback into the solver export** — edit `backend/matching/external_solver.py`. Update the import (lines 210-213) to add `load_combo_members`:

```python
    from trades.pricing import (
        load_bids, load_combo_bids, load_combo_members, load_game_prices,
        resolve_ask, resolve_ask_target, resolve_bid,
    )
    combo_bids = load_combo_bids(event)
    combo_members = load_combo_members(event)
```

Then update the `resolve_bid` call at line 279 to pass it:

```python
            bid = resolve_bid(w.user, event, it, bids, game_prices, combo_bids, combo_members)
```

- [ ] **Step 8: Run the matching + trades suites to confirm export still works**

Run: `cd backend && python manage.py test trades matching -v 1`
Expected: PASS (no regressions).

- [ ] **Step 9: Commit**

```bash
git add backend/trades/pricing.py backend/matching/external_solver.py backend/trades/test_combos.py
git commit -m "feat(combos): bid falls back to max member-game price"
```

---

### Task 2: Frontend — fix invisible combo buttons

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx:984,1206,1274`

**Interfaces:**
- Consumes: nothing. Produces: nothing (visual only).

- [ ] **Step 1: Restyle the "+ New combo" button** — `EventDetailPage.tsx:984`, replace the `className`:

```tsx
            className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5"
```

- [ ] **Step 2: Restyle the "Create combo" / "Save" button** — `EventDetailPage.tsx:1206`, replace the `className`:

```tsx
          className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
```

- [ ] **Step 3: Restyle the third combo button** — `EventDetailPage.tsx:1274`, replace the `className`:

```tsx
          className="rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
```

- [ ] **Step 4: Verify `bg-fern` is gone and the build passes**

Run: `cd frontend && grep -rn "bg-fern" src; npm run build`
Expected: grep prints nothing; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "fix(combos): use real palette color so combo buttons show text"
```

---

### Task 3: Frontend — capture combo bid on the target

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (`Target` interface ~L41-52, `buildModel` combo branch L167-176)

**Interfaces:**
- Produces: `Target.bid?: string | null` (a wished combo's `resolved_bid`, for read-only display, read by Task 4's `effBidFor`).

> Note: removing the standalone-combo-row surfacing and dropping `buildModel`'s
> `combos` argument is deliberately deferred to Task 4 — doing it here would leave
> the `combos` variable orphaned and fail `npm run lint --max-warnings 0` at this
> task's boundary. Task 4 swaps `combos`'s consumer atomically.

- [ ] **Step 1: Add `bid` to the `Target` interface** — after the `comboId?` line (~L51):

```tsx
  /** Set when this target is a Combo (not a listing). */
  comboId?: number
  /** Effective bid for a wished combo (resolved_bid), for read-only display. */
  bid?: string | null
```

- [ ] **Step 2: Capture `resolved_bid` on the wished-combo target** — in `buildModel`, the combo branch (~L167-176), add the `bid` field:

```tsx
              baseTargets.set(key, {
                key,
                listingId: 0,
                comboId: item.combo,
                label: item.combo_code ?? `Combo ${item.combo}`,
                gameId: COMBO_GAME_OFFSET + item.combo,
                gameName: `🎁 ${item.combo_name ?? 'Combo'}`,
                thumbnail: null,
                bid: item.resolved_bid ?? null,
              })
```

- [ ] **Step 3: Verify build + lint pass**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. (`bid` is a written object property — no unused-var; the standalone
surfacing loop still consumes `combos`, so nothing is orphaned yet.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos): carry resolved combo bid on the want target"
```

---

### Task 4: Frontend — browse & wish combos inside the copy dropdown

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (`buildModel` signature L125-133 + surfacing block L201-218, call site L1517-1518, `GameCopiesProps` L819-826, `GameCopies` L828+, `GameBrowseProps` L234-241, `GameBrowse` L486 + L656-714, main render passing combos to `GameBrowse` ~L1674)

**Interfaces:**
- Consumes: `Combo` (already imported), `Target.bid` (Task 3), `comboTargetKey`, `editor.priceForGame`, `editor.addTarget`, `editor.toggle`, `editor.targets`.
- Produces: `GameCopies` and `GameBrowse` accept `combos: Combo[]` and `moneyEnabled: boolean`. `buildModel` no longer takes a `combos` argument.

- [ ] **Step 1: Remove the standalone-combo-row surfacing** — in `buildModel`, delete the entire block at ~L201-218 (the `// Surface every active combo …` comment plus the `for (const c of combos) { … }` loop that adds every active combo to `baseTargets`). The `return { … }` immediately follows the deleted block.

- [ ] **Step 2: Drop the now-unused `combos` parameter from `buildModel`** — change the signature (L125-133) to remove `combos: Combo[],`:

```tsx
function buildModel(
  myListings: EventListing[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[],
  gamePrices: GamePrice[],
  username: string | undefined
): PageModel {
```

And the call site (L1517-1518):

```tsx
    () => buildModel(myListings, offerGroups, wantGroups, wishes, gamePrices, user?.username),
    [myListings, offerGroups, wantGroups, wishes, gamePrices, user?.username]
```

(`combos` at L1505 stays — Steps 5-6 below re-consume it via `GameBrowse`.)

- [ ] **Step 3: Extend `GameCopiesProps`** (L819-826):

```tsx
interface GameCopiesProps {
  slug: string
  bggId: number
  username?: string
  editor?: Editor
  myListings?: EventListing[]
  selectable?: boolean
  combos?: Combo[]
  moneyEnabled?: boolean
}
```

- [ ] **Step 4: Add combo helpers inside `GameCopies`** — update the destructure (L828) and add helpers after `toggleCopy` (after L855):

```tsx
function GameCopies({ slug, bggId, username, editor, myListings, selectable, combos, moneyEnabled }: GameCopiesProps) {
```

```tsx
  const comboRows = (combos ?? []).filter(
    (c) => c.owner_username !== username && c.items.some((it) => it.board_game_id === bggId)
  )

  const isComboWanted = (comboId: number) =>
    !!editor && !!myListings &&
    myListings.some((ml) => editor.isOn(ml.id, comboTargetKey(comboId)))

  function maxMemberBid(c: Combo): string | null {
    if (!editor) return null
    const vals = c.items
      .map((it) => Number(editor.priceForGame(it.board_game_id)))
      .filter((v) => Number.isFinite(v) && v > 0)
    return vals.length ? Math.max(...vals).toFixed(2) : null
  }

  function effBidFor(c: Combo): string | null {
    const wished = editor?.targets.find((t) => t.comboId === c.id)
    return wished?.bid ?? maxMemberBid(c)
  }

  function toggleCombo(c: Combo) {
    if (!editor || !myListings) return
    const next = !isComboWanted(c.id)
    const group = groupTargetsByGame(editor.targets).find((g) => g.gameId === bggId)
    const offering = group ? myListings.filter((ml) => groupIsOn(editor, ml.id, group)) : []
    const acting = offering.length ? offering : myListings
    const key = comboTargetKey(c.id)
    editor.addTarget({
      key, listingId: 0, comboId: c.id, label: c.combo_code,
      gameId: COMBO_GAME_OFFSET + c.id, gameName: `🎁 ${c.name}`,
      thumbnail: c.items[0]?.board_game_thumbnail ?? null,
    })
    acting.forEach((ml) => editor.toggle(ml.id, key, next))
  }
```

- [ ] **Step 5: Render the combo rows** — inside `GameCopies` return, after the closing `</ul>`/`</>` of the listing copies and before the `{ownCount > 0 && …}` block (~L925), insert:

```tsx
      {canSelect && comboRows.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-medium text-amber-700/80">
            Combos including this game:
          </p>
          <ul className="flex flex-col gap-1">
            {comboRows.map((c) => {
              const wanted = isComboWanted(c.id)
              const eff = effBidFor(c)
              return (
                <li
                  key={`combo-${c.id}`}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                    wanted ? 'border-amber-300 bg-amber-50' : 'border-ink/15 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={wanted}
                    onChange={() => toggleCombo(c)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-ink/20 text-amber-600 focus:ring-amber-500"
                    aria-label={`Want combo ${c.combo_code}`}
                  />
                  <span className="flex shrink-0 -space-x-1">
                    {c.items.map((it) =>
                      it.board_game_thumbnail ? (
                        <img
                          key={it.id}
                          src={it.board_game_thumbnail}
                          alt=""
                          title={it.board_game_name}
                          className="h-6 w-6 rounded border border-amber-300 object-cover"
                          loading="lazy"
                        />
                      ) : null
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={c.name}>
                    🎁 {c.name}
                  </span>
                  {moneyEnabled && (
                    <span className="shrink-0 font-mono text-amber-700/80">
                      {eff != null ? `$${eff}` : 'barter'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
```

- [ ] **Step 6: Thread `combos`/`moneyEnabled` through `GameBrowse`** — extend `GameBrowseProps` (L234-241) and the destructure (L486) to add `combos: Combo[]`, then pass them to the `GameCopies` inside the browse card (L706-713):

```tsx
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      myListings={myListings}
                      selectable
                      combos={combos}
                      moneyEnabled={moneyEnabled}
                    />
```

(`GameBrowse` already receives `moneyEnabled`.) Add `combos` to `GameBrowseProps`:

```tsx
interface GameBrowseProps {
  slug: string
  editor: Editor
  myListings: EventListing[]
  username?: string
  customWantGroups: WantGroup[]
  moneyEnabled: boolean
  combos: Combo[]
}
```

and the destructure:

```tsx
function GameBrowse({ slug, editor, myListings, username, customWantGroups, moneyEnabled, combos }: GameBrowseProps) {
```

- [ ] **Step 7: Pass `combos` into `GameBrowse`** at the main render (~L1674, where `<GameBrowse … customWantGroups={customWantGroups}` is rendered) add:

```tsx
                combos={combos}
```

- [ ] **Step 8: Verify build + lint pass, and manually confirm browse**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. Manual: expand a game card in the Catalog view → a combo containing that game appears as a checkbox row with member thumbnails; ticking it under either member game wishes the same combo; money events show the effective bid.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos): browse & wish combos inside member-game dropdowns"
```

---

### Task 5: Frontend — grid surfaces member rows, never standalone combo rows

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (new `buildGridRows` helper near L88-93, `GridModeProps` L1225-1232, `GridMode` L1234 + L1270 + L1308 + the `GameCopies` at L1404, main render ~L1685)

**Interfaces:**
- Consumes: `buildGridRows(editor, combos, myListings)`. Produces: `GridMode` accepts `combos: Combo[]`.

- [ ] **Step 1: Add the `buildGridRows` helper** — after `groupBadge` (after L93):

```tsx
// Grid rows = canonical-game groups from real game/listing targets, plus a row
// for each member game of any WISHED combo (so the combo is reachable in its
// dropdown). Combos never get their own row.
function buildGridRows(editor: Editor, combos: Combo[], myListings: EventListing[]): GameGroup[] {
  const gameGroups = groupTargetsByGame(
    editor.targets.filter((t) => t.comboId == null && t.gameId < COMBO_GAME_OFFSET)
  )
  const byGame = new Map<number, GameGroup>(gameGroups.map((g) => [g.gameId, g]))
  for (const c of combos) {
    if (!myListings.some((l) => editor.isOn(l.id, comboTargetKey(c.id)))) continue
    for (const it of c.items) {
      if (!byGame.has(it.board_game_id)) {
        byGame.set(it.board_game_id, {
          gameId: it.board_game_id,
          gameName: it.board_game_name,
          thumbnail: it.board_game_thumbnail,
          copyTargets: [],
        })
      }
    }
  }
  return Array.from(byGame.values()).sort((a, b) => a.gameName.localeCompare(b.gameName))
}
```

- [ ] **Step 2: Add `combos` to `GridModeProps`** (L1225-1232):

```tsx
interface GridModeProps {
  slug: string
  myListings: EventListing[]
  editor: Editor
  username?: string
  ratings: Map<number, number>
  moneyEnabled: boolean
  combos: Combo[]
}
```

- [ ] **Step 3: Compute `rows` and use it** — update the `GridMode` destructure (L1234) to add `combos`, then add a `rows` const after the `askByListing` memo (after L1251):

```tsx
function GridMode({ slug, myListings, editor, username, ratings, moneyEnabled, combos }: GridModeProps) {
```

```tsx
  const rows = buildGridRows(editor, combos, myListings)
```

Replace the auto-tick loop source at L1270 — `for (const g of groupTargetsByGame(editor.targets)) {` becomes:

```tsx
            for (const g of rows) {
```

Replace the tbody map source at L1308 — `{groupTargetsByGame(editor.targets).map((g) => {` becomes:

```tsx
          {rows.map((g) => {
```

- [ ] **Step 4: Pass `combos`/`moneyEnabled` to the grid's `GameCopies`** (L1404):

```tsx
                        <GameCopies slug={slug} bggId={g.gameId} username={username} editor={editor} myListings={myListings} selectable combos={combos} moneyEnabled={moneyEnabled} />
```

- [ ] **Step 5: Pass `combos` into `GridMode`** at the main render (~L1685):

```tsx
              <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} combos={combos} />
```

- [ ] **Step 6: Verify build + lint pass, and manually confirm grid**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. Manual: grid shows only wished games (no standalone combo rows); a wished combo's member games appear as rows whose dropdown lists the (checked) combo; unchecking it there removes the combo.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos): grid surfaces combos in member-game dropdowns only"
```

---

### Task 6: Frontend — visual view: combo cluster, labels, bigger thumbnails

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (`VisualModeProps` L1158-1161, `VisualMode` L1163 + the give/receive block L1183-1213, main render ~L1683)

**Interfaces:**
- Consumes: `Combo`, `COMBO_GAME_OFFSET`, `groupKeys`, `groupIsOn`. Produces: `VisualMode` accepts `combos: Combo[]`.

- [ ] **Step 1: Add `combos` to `VisualModeProps`** (L1158-1161):

```tsx
interface VisualModeProps {
  myListings: EventListing[]
  editor: Editor
  combos: Combo[]
}
```

- [ ] **Step 2: Build a combo lookup** — update the `VisualMode` destructure (L1163) and add the map:

```tsx
function VisualMode({ myListings, editor, combos }: VisualModeProps) {
  if (myListings.length === 0) return null
  const comboById = new Map(combos.map((c) => [c.id, c]))
```

- [ ] **Step 3: Replace the give → receive block** — swap the block at L1184-1213 (from the opening `<div className="flex items-center gap-3 overflow-x-auto">` through its close) for:

```tsx
            <div className="flex items-start gap-3 overflow-x-auto">
              <div className="flex shrink-0 flex-col items-center gap-1">
                <GameThumb
                  src={listing.board_game_thumbnail}
                  alt={listing.board_game_name ?? ''}
                  className="h-32 w-32"
                />
                <span className="w-32 truncate text-center text-xs text-ink" title={listing.board_game_name}>
                  {listing.board_game_name}
                </span>
              </div>
              <svg className="mt-12 h-5 w-5 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {myWants.length > 0 ? (
                <div className="flex flex-wrap items-start gap-3">
                  {myWants.map((g) => {
                    const combo = g.gameId >= COMBO_GAME_OFFSET
                      ? comboById.get(g.gameId - COMBO_GAME_OFFSET)
                      : undefined
                    return (
                      <div key={g.gameId} className="relative flex w-32 shrink-0 flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => groupKeys(g).forEach((k) => editor.toggle(listing.id, k, false))}
                          aria-label={`Remove ${g.gameName}`}
                          title={`Remove ${g.gameName}`}
                          className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-ink bg-white text-xs font-bold text-red-600 shadow-sm hover:bg-red-50"
                        >
                          ×
                        </button>
                        {combo ? (
                          <div className="flex h-32 w-32 flex-wrap content-center items-center justify-center gap-1 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/50 p-1">
                            {combo.items.map((it) => (
                              <GameThumb key={it.id} src={it.board_game_thumbnail} alt={it.board_game_name} className="h-14 w-14" />
                            ))}
                          </div>
                        ) : (
                          <GameThumb src={g.thumbnail} alt={g.gameName ?? ''} className="h-32 w-32" />
                        )}
                        <span className="w-32 truncate text-center text-xs text-ink" title={g.gameName}>
                          {g.gameName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <span className="mt-12 text-xs text-moss/70">No wants yet — add games in the Catalog view.</span>
              )}
            </div>
```

- [ ] **Step 4: Pass `combos` into `VisualMode`** at the main render (~L1683):

```tsx
            {view === 'visual' && <VisualMode myListings={myListings} editor={editor} combos={combos} />}
```

- [ ] **Step 5: Verify build + lint pass, and manually confirm visual**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. Manual: a wished single game shows a 128px thumbnail with its name below; a wished combo shows a dashed-outlined box of its member thumbnails with the combo name below and a working × remove.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(combos): visual view renders combos as labeled member-thumb clusters"
```

---

## Final verification

- [ ] Backend: `cd backend && python manage.py test trades matching -v 1` → PASS.
- [ ] Frontend: `cd frontend && npm run build && npm run lint` → PASS; `grep -rn "bg-fern" src` prints nothing.
- [ ] Manual walkthrough in a money-enabled event: combo buttons readable; Catalog dropdown lets you wish a combo under each member game; grid shows wished games only with combos in member dropdowns; visual view shows the combo as a labeled outlined cluster; an un-overridden wished combo's displayed bid equals the max member-game bid.
