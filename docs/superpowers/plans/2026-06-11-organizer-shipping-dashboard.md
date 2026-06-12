# Organizer Shipping Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the organizer a read-only dashboard to browse every shipment in an event — a status count bar, a per-trader progress rollup, and a filterable table — backed by one organizer-only endpoint.

**Architecture:** A new organizer-only `GET /events/{slug}/shipping/overview/` returns all shipments of the latest DONE run (mirrors the existing user-scoped `ShippingView` minus the user filter, lazily creating rows). The frontend computes counts + per-trader rollup from that flat list in a new `ShippingOverviewTab` component, surfaced as an organizer-only tab in `MatchRunPage`.

**Tech Stack:** Django + DRF (backend, `./venv/bin/python manage.py test`), Vite + React + TypeScript (frontend, `npx tsc --noEmit`; no FE test harness).

Spec: `docs/superpowers/specs/2026-06-11-organizer-shipping-dashboard-design.md`.

**Conventions:**
- Organizer check: `if event.organizer_id != request.user.id: raise PermissionDenied(...)` (`PermissionDenied` already imported in `matching/views.py`).
- View helpers in `matching/views.py`: `_get_event(slug)`, `_latest_done_run(event)`.
- Run tests from `backend/`: `./venv/bin/python manage.py test <path>`.
- Commits: Conventional Commits. **No `Co-Authored-By` trailer** (project rule).
- `MatchingTestBase.event.organizer` is `user_a`; `user_b`/`user_c` are non-organizers.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/matching/views.py` | `ShippingOverviewView` (organizer-only, all shipments) | Modify |
| `backend/matching/urls.py` | route `shipping/overview/` | Modify |
| `backend/matching/test_shipping_overview.py` | endpoint tests | Create |
| `frontend/src/api/shipping.ts` | `useShippingOverview` hook | Modify |
| `frontend/src/features/matching/ShippingOverviewTab.tsx` | dashboard: counts + rollup + table | Create |
| `frontend/src/features/matching/MatchRunPage.tsx` | wire organizer-only tab | Modify |

---

## Task 1: Backend — organizer shipping-overview endpoint

**Files:**
- Modify: `backend/matching/views.py`, `backend/matching/urls.py`
- Test: `backend/matching/test_shipping_overview.py` (create)

- [ ] **Step 1: Write failing tests**

Create `backend/matching/test_shipping_overview.py`:

```python
"""Organizer shipping-overview endpoint: all shipments, organizer-only."""
from matching.tests import MatchingTestBase
from matching.models import MatchRun, TradeAssignment, Shipment


class ShippingOverviewTests(MatchingTestBase):
    def _url(self):
        return f"/api/events/{self.slug}/shipping/overview/"

    def _setup_run(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_a1, giver=self.user_a,
            receiver=self.user_b, cycle_id=1,
        )
        TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_b1, giver=self.user_b,
            receiver=self.user_a, cycle_id=1,
        )
        return run

    def test_organizer_sees_all_shipments(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_a)  # organizer
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 2)  # both, not just user_a's

    def test_non_organizer_forbidden(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_b)  # not organizer
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 403)

    def test_lazily_creates_shipments(self):
        run = self._setup_run()
        self.assertEqual(Shipment.objects.filter(assignment__match_run=run).count(), 0)
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())
        self.assertEqual(Shipment.objects.filter(assignment__match_run=run).count(), 2)

    def test_empty_when_no_done_run(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, [])
```

> Confirm `TradeAssignment`/`MatchRun` create kwargs against `matching/models.py` (the thumbnail test `backend/matching/test_thumbnails.py` uses the same `create(...)` shape successfully, so they're valid).

- [ ] **Step 2: Run — verify fail (404, route missing)**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview -v 2`
Expected: FAIL (404).

- [ ] **Step 3: Add `ShippingOverviewView`**

In `backend/matching/views.py`, after `ShippingView` (it already imports `permissions`, `Response`, `APIView`, `PermissionDenied`, `TradeAssignment`, `Shipment`, `ShipmentSerializer`, and the helpers `_get_event`/`_latest_done_run`):

```python
class ShippingOverviewView(APIView):
    """
    GET /api/events/{slug}/shipping/overview/

    Organizer-only: ALL shipments for the latest DONE run (lazily created).
    Read-only browse of overall shipping status.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        assignments = (
            TradeAssignment.objects.filter(match_run=run)
            .select_related("event_listing__copy__board_game", "giver", "receiver")
        )
        shipments = [Shipment.objects.get_or_create(assignment=a)[0] for a in assignments]
        return Response(ShipmentSerializer(shipments, many=True, context={"request": request}).data)
```

- [ ] **Step 4: Route it** (`backend/matching/urls.py`)

Import `ShippingOverviewView` and add the route **before** the `shipping/<int:pk>/` route (order-independent thanks to the int converter, but keep it tidy):

```python
    path(
        "events/<slug:slug>/shipping/overview/",
        ShippingOverviewView.as_view(),
        name="shipping-overview",
    ),
```

- [ ] **Step 5: Run — verify pass (4 tests)**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview -v 2`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `cd backend && ./venv/bin/python manage.py test -v 1`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_shipping_overview.py
git commit -m "feat(shipping): organizer shipping-overview endpoint (all shipments)"
```

---

## Task 2: Frontend api — `useShippingOverview`

**Files:**
- Modify: `frontend/src/api/shipping.ts`

- [ ] **Step 1: Add fetch fn + hook**

In `frontend/src/api/shipping.ts`, add (after `fetchShipments`):

```typescript
async function fetchShippingOverview(slug: string): Promise<Shipment[]> {
  const { data } = await apiClient.get<Shipment[]>(`/events/${slug}/shipping/overview/`)
  return data
}
```

And after `useShipments`:

```typescript
export function useShippingOverview(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['shipping', 'overview', slug ?? ''],
    queryFn: () => fetchShippingOverview(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/shipping.ts
git commit -m "feat(shipping): FE useShippingOverview hook"
```

---

## Task 3: Frontend — `ShippingOverviewTab` dashboard

**Files:**
- Create: `frontend/src/features/matching/ShippingOverviewTab.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/features/matching/ShippingOverviewTab.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useShippingOverview } from '../../api/shipping'
import type { Shipment } from '../../api/shipping'
import { GameThumb } from '../../components/GameThumb'

type StatusFilter = 'all' | 'PENDING' | 'SENT' | 'RECEIVED'

const STATUS_PILL: Record<Shipment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEIVED: 'bg-green-50 text-green-700 border-green-200',
}

interface TraderRow {
  username: string
  outTotal: number
  outSent: number
  inTotal: number
  inReceived: number
}

function buildRollup(shipments: Shipment[]): TraderRow[] {
  const map = new Map<string, TraderRow>()
  const row = (u: string) => {
    let r = map.get(u)
    if (!r) {
      r = { username: u, outTotal: 0, outSent: 0, inTotal: 0, inReceived: 0 }
      map.set(u, r)
    }
    return r
  }
  for (const s of shipments) {
    const g = row(s.giver_username)
    g.outTotal++
    if (s.status === 'SENT' || s.status === 'RECEIVED') g.outSent++
    const rcv = row(s.receiver_username)
    rcv.inTotal++
    if (s.status === 'RECEIVED') rcv.inReceived++
  }
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username))
}

const label = (s: Shipment['status']) => s.charAt(0) + s.slice(1).toLowerCase()

export function ShippingOverviewTab({ slug }: { slug: string }) {
  const { data: shipments = [], isLoading } = useShippingOverview(slug, true)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const counts = useMemo(
    () => ({
      PENDING: shipments.filter((s) => s.status === 'PENDING').length,
      SENT: shipments.filter((s) => s.status === 'SENT').length,
      RECEIVED: shipments.filter((s) => s.status === 'RECEIVED').length,
    }),
    [shipments],
  )
  const rollup = useMemo(() => buildRollup(shipments), [shipments])
  const rows = filter === 'all' ? shipments : shipments.filter((s) => s.status === filter)

  if (isLoading) return <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
  if (shipments.length === 0)
    return <p className="py-6 text-center text-sm text-gray-400">No shipments yet.</p>

  return (
    <div className="space-y-5">
      {/* Status count bar */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">Pending {counts.PENDING}</span>
        <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 font-medium text-blue-700">Sent {counts.SENT}</span>
        <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1 font-medium text-green-700">Received {counts.RECEIVED}</span>
      </div>

      {/* Per-trader rollup */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Per-trader progress</h3>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {rollup.map((t) => {
            const behind = t.outSent < t.outTotal || t.inReceived < t.inTotal
            return (
              <div key={t.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 truncate font-medium text-gray-800">{t.username}</span>
                <span className="text-xs text-gray-500">sending {t.outSent}/{t.outTotal}</span>
                <span className="text-xs text-gray-500">receiving {t.inReceived}/{t.inTotal}</span>
                {behind && <span className="ml-auto text-xs font-medium text-amber-600" title="Behind">⚠ behind</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Filterable table */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">All shipments</h3>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="RECEIVED">Received</option>
          </select>
        </div>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
              <GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{s.board_game_name}</p>
                <p className="text-xs text-gray-500">{s.giver_username} → {s.receiver_username}</p>
              </div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${STATUS_PILL[s.status]}`}>
                {label(s.status)}
              </span>
              <span className="hidden w-24 shrink-0 text-right text-[11px] text-gray-400 sm:block">
                {s.status === 'RECEIVED' && s.received_at
                  ? new Date(s.received_at).toLocaleDateString()
                  : s.status === 'SENT' && s.sent_at
                  ? new Date(s.sent_at).toLocaleDateString()
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (the component isn't imported anywhere yet — that's Task 4; tsc still type-checks the file).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/matching/ShippingOverviewTab.tsx
git commit -m "feat(shipping): ShippingOverviewTab dashboard (counts + rollup + table)"
```

---

## Task 4: Frontend — wire the organizer tab into `MatchRunPage`

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: Import the component**

At the top of `MatchRunPage.tsx`, add: `import { ShippingOverviewTab } from './ShippingOverviewTab'`.

- [ ] **Step 2: Thread `isOrganizer` into `RunResultView`**

`RunResultView` is declared `function RunResultView({ slug, run, eventStatus }: { slug: string; run: MatchRunDetail; eventStatus: EventStatus })`. Add an `isOrganizer: boolean` prop:

```tsx
function RunResultView({ slug, run, eventStatus, isOrganizer }: { slug: string; run: MatchRunDetail; eventStatus: EventStatus; isOrganizer: boolean }) {
```

At its call site (currently `<RunResultView slug={slug!} run={activeRun} eventStatus={event.status} />`), pass it:

```tsx
<RunResultView slug={slug!} run={activeRun} eventStatus={event.status} isOrganizer={!!event.is_organizer} />
```

- [ ] **Step 3: Add the tab (organizer + shipping only)**

Extend the `activeTab` state union to include `'shipping-overview'`:

```tsx
const [activeTab, setActiveTab] = useState<'my-trades' | 'cycles' | 'stats' | 'shipping' | 'shipping-overview'>('my-trades')
```

In the `tabs` array, after the existing shipping entry, add the organizer-only overview tab:

```tsx
    ...(showShipping ? [{ id: 'shipping' as const, label: 'Shipping' }] : []),
    ...(showShipping && isOrganizer ? [{ id: 'shipping-overview' as const, label: 'Shipping Overview' }] : []),
```

- [ ] **Step 4: Render the tab content**

After the `{activeTab === 'shipping' && ...}` block, add:

```tsx
{activeTab === 'shipping-overview' && <ShippingOverviewTab slug={slug} />}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual verify**

As the organizer on a SHIPPING-status event with a DONE run: a "Shipping Overview" tab appears (it does NOT appear for non-organizers, nor before SHIPPING). It shows the count bar, the per-trader rollup (with ⚠ on anyone behind), and the filterable table of all shipments.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(shipping): organizer-only Shipping Overview tab in MatchRunPage"
```

---

## Final verification

- [ ] `cd backend && ./venv/bin/python manage.py test` — full suite green.
- [ ] `cd frontend && npx tsc --noEmit` — clean.
- [ ] Manual: organizer sees the Shipping Overview tab in SHIPPING/ARCHIVED with counts, per-trader rollup, and the filterable table; a non-organizer never sees it and `GET /shipping/overview/` returns 403 for them.
