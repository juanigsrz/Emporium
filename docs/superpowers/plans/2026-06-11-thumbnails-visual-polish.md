# Thumbnails + Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add game thumbnails across the Visual view, advanced builder, My Trades/Shipping, and the Grid copy popup (with a send→receive arrow and a portal-based popup fix), via one shared `GameThumb` component fed by new `board_game_thumbnail` serializer fields.

**Architecture:** Backend adds a read-only `board_game_thumbnail` (`SerializerMethodField` reading `board_game.metadata["thumbnail"]`) to four serializers. Frontend gets one shared `GameThumb` component; each target view renders it from the relevant thumbnail field. The Grid popup is moved to a `document.body` React portal to escape its ancestor stacking context.

**Tech Stack:** Django + DRF (backend, `./venv/bin/python manage.py test`), Vite + React + TypeScript (frontend, `npx tsc --noEmit`; no FE test harness — verify via tsc + manual).

Spec: `docs/superpowers/specs/2026-06-11-thumbnails-visual-polish-design.md`.

**Conventions:**
- Thumbnail source is `(<board_game>.metadata or {}).get("thumbnail", "")` — mirror `EventListingSerializer.get_board_game_thumbnail` (`events/serializers.py:236`).
- Run backend tests from `backend/`: `./venv/bin/python manage.py test <path>`.
- Commits: Conventional Commits. **No `Co-Authored-By` trailer** (project rule).
- Fixtures: `matching.tests.MatchingTestBase` (games have no `metadata` thumbnail by default — tests set it explicitly).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/matching/serializers.py` | `board_game_thumbnail` on `TradeAssignmentSerializer` + `ShipmentSerializer` | Modify |
| `backend/trades/serializers.py` | `board_game_thumbnail` on `WantGroupItemSerializer` | Modify |
| `backend/copies/serializers.py` | `board_game_thumbnail` on `CopySerializer` | Modify |
| `backend/matching/test_thumbnails.py` | serializer thumbnail tests | Create |
| `frontend/src/components/GameThumb.tsx` | shared thumbnail component | Create |
| `frontend/src/api/{matching,shipping,trades,copies}.ts` | `board_game_thumbnail` TS fields | Modify |
| `frontend/src/features/matching/MatchRunPage.tsx` | thumbs on My Trades + Shipping rows | Modify |
| `frontend/src/features/trades/WantListBuilderPage.tsx` | thumbs on builder tab rows | Modify |
| `frontend/src/features/trades/MyWantsPage.tsx` | Visual arrow+thumbs; Grid popup portal+thumb+version | Modify |

---

## Task 1: Backend — `board_game_thumbnail` on four serializers

**Files:**
- Modify: `backend/matching/serializers.py`, `backend/trades/serializers.py`, `backend/copies/serializers.py`
- Test: `backend/matching/test_thumbnails.py` (create)

- [ ] **Step 1: Write failing tests**

Create `backend/matching/test_thumbnails.py`:

```python
"""board_game_thumbnail exposed on assignment / shipment / want-item / copy serializers."""
from matching.tests import MatchingTestBase
from trades.models import WantGroup, WantGroupItem


class ThumbnailFieldTests(MatchingTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # Give brass a thumbnail; terra none (empty fallback).
        cls.game_brass.metadata = {"thumbnail": "https://img/brass.jpg"}
        cls.game_brass.save(update_fields=["metadata"])

    def test_trade_assignment_thumbnail(self):
        from matching.serializers import TradeAssignmentSerializer
        from matching.models import TradeAssignment, MatchRun
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_a1, giver=self.user_a,
            receiver=self.user_b, cycle_id=1,
        )  # el_a1 = alice's brass
        data = TradeAssignmentSerializer(a).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_shipment_thumbnail_empty_when_absent(self):
        from matching.serializers import ShipmentSerializer
        from matching.models import TradeAssignment, MatchRun, Shipment
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_b1, giver=self.user_b,
            receiver=self.user_a, cycle_id=1,
        )  # el_b1 = bob's terra (no thumbnail)
        s = Shipment.objects.create(assignment=a)
        # ShipmentSerializer.get_my_role needs request in context
        from rest_framework.test import APIRequestFactory
        req = APIRequestFactory().get("/")
        req.user = self.user_a
        data = ShipmentSerializer(s, context={"request": req}).data
        self.assertEqual(data["board_game_thumbnail"], "")

    def test_want_group_item_thumbnail_board_game(self):
        from trades.serializers import WantGroupItemSerializer
        wg = WantGroup.objects.create(event=self.event, user=self.user_a, name="wg")
        item = WantGroupItem.objects.create(
            want_group=wg, target_type=WantGroupItem.TargetType.BOARD_GAME,
            board_game=self.game_brass,
        )
        data = WantGroupItemSerializer(item).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_want_group_item_thumbnail_listing(self):
        from trades.serializers import WantGroupItemSerializer
        wg = WantGroup.objects.create(event=self.event, user=self.user_a, name="wg2")
        item = WantGroupItem.objects.create(
            want_group=wg, target_type=WantGroupItem.TargetType.LISTING,
            event_listing=self.el_a1,  # brass listing
        )
        data = WantGroupItemSerializer(item).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_copy_thumbnail(self):
        from copies.serializers import CopySerializer
        data = CopySerializer(self.copy_a1).data  # brass copy
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")
```

> Verify `MatchRun.Status.DONE`, `TradeAssignment` / `Shipment` create kwargs against `backend/matching/models.py` before running; adjust required fields if the models differ (e.g. a required `wish` or status default). If `Shipment` requires more than `assignment`, pass its defaults.

- [ ] **Step 2: Run — verify fail (KeyError 'board_game_thumbnail')**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_thumbnails -v 2`
Expected: FAIL (field missing).

- [ ] **Step 3: Add to `TradeAssignmentSerializer` + `ShipmentSerializer`** (`backend/matching/serializers.py`)

In `TradeAssignmentSerializer`, add the field declaration + method, and `"board_game_thumbnail"` to `fields`:

```python
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
```

In `ShipmentSerializer`, add + include in `fields` and `read_only_fields`:

```python
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        return (obj.assignment.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
```

(For `TradeAssignmentSerializer`, `read_only_fields = fields`, so adding to `fields` suffices.)

- [ ] **Step 4: Add to `WantGroupItemSerializer`** (`backend/trades/serializers.py`)

Add the field + a method mirroring `get_board_game_name`, and `"board_game_thumbnail"` to `fields` and `read_only_fields`:

```python
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        if obj.target_type == WantGroupItem.TargetType.BOARD_GAME and obj.board_game:
            return (obj.board_game.metadata or {}).get("thumbnail", "")
        if obj.target_type == WantGroupItem.TargetType.LISTING and obj.event_listing:
            return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
        return ""
```

- [ ] **Step 5: Add to `CopySerializer`** (`backend/copies/serializers.py`)

Add the field + method, and `"board_game_thumbnail"` to `fields` and `read_only_fields`:

```python
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        return (obj.board_game.metadata or {}).get("thumbnail", "")
```

- [ ] **Step 6: Run — verify pass (5 tests)**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_thumbnails -v 2`
Expected: PASS.

- [ ] **Step 7: Full suite**

Run: `cd backend && ./venv/bin/python manage.py test -v 1`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/matching/serializers.py backend/trades/serializers.py backend/copies/serializers.py backend/matching/test_thumbnails.py
git commit -m "feat(ui): expose board_game_thumbnail on assignment/shipment/want-item/copy"
```

---

## Task 2: Frontend — `GameThumb` component + api types

**Files:**
- Create: `frontend/src/components/GameThumb.tsx`
- Modify: `frontend/src/api/matching.ts`, `frontend/src/api/shipping.ts`, `frontend/src/api/trades.ts`, `frontend/src/api/copies.ts`

- [ ] **Step 1: Create `frontend/src/components/GameThumb.tsx`**

```tsx
interface GameThumbProps {
  src?: string | null
  alt?: string
  className?: string
}

/** Game cover thumbnail with a neutral placeholder when no src is available. */
export function GameThumb({ src, alt = '', className = 'h-10 w-10' }: GameThumbProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`${className} shrink-0 rounded object-cover border border-gray-100 bg-gray-50`}
      />
    )
  }
  return (
    <div
      className={`${className} shrink-0 rounded border border-gray-100 bg-gray-50 flex items-center justify-center text-gray-300`}
      aria-hidden="true"
    >
      <svg className="h-1/2 w-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM4 15l4-4 3 3 5-5 4 4" />
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Add `board_game_thumbnail` to the four TS types**

- `frontend/src/api/matching.ts`, `interface TradeAssignment` (after `board_game_name`): `board_game_thumbnail: string`
- `frontend/src/api/shipping.ts`, `interface Shipment` (after `board_game_name`): `board_game_thumbnail: string`
- `frontend/src/api/trades.ts`, `interface WantGroupItem` (after `board_game_name`): `board_game_thumbnail: string`
- `frontend/src/api/copies.ts`, `interface Copy` (after `board_game_name`): `board_game_thumbnail: string`

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. (Making these required on the read types is safe — the API always returns them now.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GameThumb.tsx frontend/src/api/matching.ts frontend/src/api/shipping.ts frontend/src/api/trades.ts frontend/src/api/copies.ts
git commit -m "feat(ui): GameThumb component + board_game_thumbnail types"
```

---

## Task 3: Matching — thumbnails on My Trades + Shipping (item #5)

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: Locate the rows**

Run: `cd frontend && grep -n "board_game_name\|Giving\|Receiving\|Sending\|listing_code" src/features/matching/MatchRunPage.tsx`
The My Trades section (~line 310) renders Giving (~324) and Receiving (~361) lists; the Shipping tab (~738) renders Sending (~779) and Receiving (~793) lists. Each row currently shows `board_game_name` / `listing_code` text.

- [ ] **Step 2: Add `GameThumb` to each row**

Import at top: `import { GameThumb } from '../../components/GameThumb'`.

In each Giving/Receiving assignment row, prepend the thumbnail before the existing text block:
```tsx
<GameThumb src={a.board_game_thumbnail} alt={a.board_game_name} className="h-10 w-10" />
```
(use the row's actual variable — likely `a`/`assignment`/`row`). Wrap the row in a flex container if it isn't already (`flex items-center gap-3`) so the thumb sits left of the text.

In each Sending/Receiving shipment row, prepend:
```tsx
<GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-10 w-10" />
```
(use the row's actual variable — likely `s`/`shipment`). Match the surrounding flex/gap styling.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verify**

On a DONE match run: My Trades shows a cover next to each Giving/Receiving game; in SHIPPING status, the Shipping tab shows covers next to Sending/Receiving. Games without a thumbnail show the placeholder.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(ui): thumbnails on My Trades and Shipping rows"
```

---

## Task 4: Advanced builder — thumbnails on tab rows (item #4)

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

- [ ] **Step 1: Locate the item rows in each tab**

Run: `cd frontend && grep -n "board_game_name\|listing_code\|board_game_thumbnail\|OfferGroup\|WantGroup\|Wish" src/features/trades/WantListBuilderPage.tsx | head -40`
Identify the row renderers for: OfferGroups tab (offer items — `event_listing` rows carry `board_game_thumbnail` on `EventListing`/offer-item data), WantGroups + Wishes tabs (want items now carry `board_game_thumbnail` from Task 1).

- [ ] **Step 2: Add `GameThumb` to each tab's item rows**

Import: `import { GameThumb } from '../../components/GameThumb'`.

For each item row across the three tabs, prepend a thumbnail using whichever thumbnail field that row's object exposes:
- Offer/listing rows: `<GameThumb src={row.board_game_thumbnail} alt={row.board_game_name} className="h-9 w-9" />` (the listing/offer item object — confirm the field name on the data; `EventListing` exposes `board_game_thumbnail`).
- Want/Wish item rows: `<GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-9 w-9" />`.
Wrap each row in `flex items-center gap-2/3` if not already so the thumb sits to the left.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. (If a row object's TS type lacks `board_game_thumbnail`, confirm it is the `WantGroupItem`/listing type updated in Task 2; if a builder-local type mirrors the API shape, add the field there too.)

- [ ] **Step 4: Manual verify**

In the advanced X-to-Y builder, each of the OfferGroups, WantGroups, and Wishes tabs shows a cover thumbnail beside every item (placeholder when none).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(ui): thumbnails in advanced builder OfferGroups/WantGroups/Wishes"
```

---

## Task 5: Visual view — thumbnails + send→receive arrow (item #3)

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Locate the Visual view**

Run: `cd frontend && grep -n "view === 'visual'\|ViewMode\|board_game_thumbnail\|board_game_name\|listing" src/features/trades/MyWantsPage.tsx | head -40`
Find the `view === 'visual'` render block. Understand how it shows the user's wishes — the offered (give) copy(ies) and the wanted (receive) copy(ies) per wish row.

- [ ] **Step 2: Render thumbnails + an arrow between give and receive**

Import: `import { GameThumb } from '../../components/GameThumb'`.

For each wish row in the Visual view, render the give side and receive side as thumbnail clusters separated by an arrow:
```tsx
<div className="flex items-center gap-3">
  {/* GIVE side: offered copies */}
  <div className="flex items-center gap-1">
    {giveItems.map((g) => (
      <GameThumb key={g.id} src={g.board_game_thumbnail} alt={g.board_game_name} className="h-12 w-12" />
    ))}
  </div>
  <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
  {/* RECEIVE side: wanted copies */}
  <div className="flex items-center gap-1">
    {wantItems.map((w) => (
      <GameThumb key={w.id} src={w.board_game_thumbnail} alt={w.board_game_name ?? ''} className="h-12 w-12" />
    ))}
  </div>
</div>
```
Adapt `giveItems`/`wantItems` to the Visual view's actual data variables; use whichever thumbnail field each side exposes (offered listings: `board_game_thumbnail`; wanted items: `board_game_thumbnail` from Task 1). Keep existing text labels — the thumbnails and arrow augment them, not replace them.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verify**

The Visual view shows each wish as `[your copy] → [wanted copy]` with thumbnails and a clear arrow indicating send vs receive direction.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(ui): Visual view thumbnails + send→receive arrow"
```

---

## Task 6: Grid copy popup — portal + thumbnail + version (item #6)

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (the `CopyDetailModal`)

- [ ] **Step 1: Render the popup through a portal**

In `MyWantsPage.tsx`, add `import { createPortal } from 'react-dom'` (top of file). In `CopyDetailModal` (currently `return ( <div className="fixed inset-0 z-50 ..."> … </div> )`), wrap the returned JSX in a portal to `document.body` so it escapes any ancestor stacking context that traps the `fixed` overlay:

```tsx
return createPortal(
  <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Copy details">
    {/* …existing modal body unchanged… */}
  </div>,
  document.body,
)
```

- [ ] **Step 2: Add a thumbnail to the popup header**

Import `GameThumb` (`import { GameThumb } from '../../components/GameThumb'`). In the header (the block with the title `copy.board_game_name` + `listing_code · owner_username`), place a `GameThumb` to the left of the title text:
```tsx
<div className="flex items-start gap-3 min-w-0">
  <GameThumb src={copy?.board_game_thumbnail} alt={copy?.board_game_name ?? ''} className="h-12 w-12" />
  <div className="min-w-0">
    {/* existing <h3> title + <p> listing_code · owner_username */}
  </div>
</div>
```

- [ ] **Step 3: Show version instead of free-text edition**

Replace the popup's edition row:
```tsx
<CopyDetailRow label="Edition" value={copy.edition} />
```
with:
```tsx
<CopyDetailRow label="Edition" value={copy.version_name && copy.version_name !== 'Unknown' ? copy.version_name : ''} />
```
(`CopyDetailRow` already returns null for empty values, so "Unknown"/empty hides the row.)

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. (`copy.board_game_thumbnail` and `copy.version_name` are both on the `Copy` type now.)

- [ ] **Step 5: Manual verify**

In the Grid view, click a copy: the popup now renders **above** the grid (no longer trapped behind it), shows the game thumbnail in the header, and the Edition row shows the version name (hidden when Unknown).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "fix(ui): portal the copy popup; add thumbnail + version to it"
```

---

## Final verification

- [ ] `cd backend && ./venv/bin/python manage.py test` — full suite green.
- [ ] `cd frontend && npx tsc --noEmit` — clean.
- [ ] Manual end-to-end: thumbnails (with placeholder fallback) appear in My Trades, Shipping, the three builder tabs, and the Visual view; the Visual view shows a send→receive arrow; the Grid copy popup renders above the grid with a thumbnail + version name.
