# Event-Cycle Carryover 11b — Import Wants + Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import their per-game prices and their wants (re-targeted by canonical game) from a previous event they joined into a new event, best-effort.

**Architecture:** A new `import_user_trades(user, source_event, target_event)` service (`trades/services.py`) upserts `UserGamePrice` rows and re-creates `WantGroup`s (items re-resolved to the target event's listings by game). A `POST /events/{slug}/import-trades/` endpoint guards participation + lock and returns a summary. A small `EventDetailPage` control triggers it.

**Tech Stack:** Django/DRF (backend, `manage.py test`); React/TS (frontend, `npm run build` + targeted eslint + manual — no test runner).

**Spec:** `docs/superpowers/specs/2026-06-22-event-cycle-carryover-design.md` (Part B).

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd `backend/` (interpreter `./.venv/bin/python`); frontend cwd `frontend/`. Frontend lint baseline: `npm run lint` fails only on pre-existing `CopyForm.tsx:15` — gate is the changed file clean via `npx eslint <file>`.

**This is Plan 11b of 2.** Builds on 11a (carryover, merged).

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/carryover-11b
```

Expected: `Switched to a new branch 'feat/carryover-11b'`

---

### Task 1: Import service + endpoint

**Files:**
- Create: `backend/trades/services.py`
- Modify: `backend/trades/views.py`
- Modify: `backend/trades/urls.py`
- Create: `backend/trades/test_import.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/trades/test_import.py`:

```python
"""import_user_trades + the import-trades endpoint."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from trades.models import UserGamePrice, WantGroup, WantGroupItem

User = get_user_model()


class ImportTradesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.me = User.objects.create_user("imp_me", "me@t.test", "pass1234")
        cls.other = User.objects.create_user("imp_other", "o@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=12001, name="Imp1")
        cls.bg2 = BoardGame.objects.create(bgg_id=12002, name="Imp2")

        cls.src = TradeEvent.objects.create(name="Src Ev", organizer=cls.me,
                                            status="ARCHIVED")
        cls.dst = TradeEvent.objects.create(name="Dst Ev", organizer=cls.me,
                                            status="WANTLIST_OPEN")
        for ev in (cls.src, cls.dst):
            EventParticipation.objects.create(event=ev, user=cls.me)
            EventParticipation.objects.create(event=ev, user=cls.other)

        # Source: my per-game price + a want group wanting bg1 (other's copy).
        UserGamePrice.objects.create(user=cls.me, event=cls.src, board_game=cls.bg1, price=15)
        src_copy = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        src_el = EventListing.objects.create(event=cls.src, copy=src_copy)
        wg = WantGroup.objects.create(user=cls.me, event=cls.src, name="my wants",
                                      min_receive=1, duplicate_protection=True)
        WantGroupItem.objects.create(want_group=wg, event_listing=src_el)

        # Target: another copy of bg1 by other, plus an unrelated bg2 copy.
        dst_copy1 = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.dst_el1 = EventListing.objects.create(event=cls.dst, copy=dst_copy1)
        dst_copy2 = Copy.objects.create(owner=cls.other, board_game=cls.bg2)
        cls.dst_el2 = EventListing.objects.create(event=cls.dst, copy=dst_copy2)

    def _url(self, slug):
        return f"/api/events/{slug}/import-trades/"

    def test_import_copies_prices_and_wants(self):
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["prices"], 1)
        self.assertEqual(resp.data["want_groups"], 1)
        # price copied to target
        self.assertTrue(UserGamePrice.objects.filter(
            user=self.me, event=self.dst, board_game=self.bg1, price=15).exists())
        # want group re-created, targeting the target's bg1 listing
        wg = WantGroup.objects.get(user=self.me, event=self.dst)
        self.assertEqual(wg.name, "my wants")
        self.assertTrue(wg.items.filter(event_listing=self.dst_el1).exists())
        self.assertFalse(wg.items.filter(event_listing=self.dst_el2).exists())

    def test_wants_skipped_when_target_has_want_groups(self):
        WantGroup.objects.create(user=self.me, event=self.dst, name="existing",
                                 min_receive=1)
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["want_groups"], 0)  # dedup guard

    def test_reject_same_event(self):
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.dst.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_non_participant_source(self):
        stranger_event = TradeEvent.objects.create(name="Stranger", organizer=self.other,
                                                   status="ARCHIVED")
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": stranger_event.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_locked_target(self):
        self.dst.status = "MATCHING"
        self.dst.save(update_fields=["status"])
        self.client.force_authenticate(self.me)
        resp = self.client.post(self._url(self.dst.slug), {"from_event": self.src.slug}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_import -v 2`
Expected: FAIL — 404 (no `/import-trades/` route).

- [ ] **Step 3: Add the import service**

Create `backend/trades/services.py`:

```python
"""trades/services.py — cross-event import (best-effort)."""

from django.db import transaction


@transaction.atomic
def import_user_trades(user, source_event, target_event):
    """Copy the user's per-game prices and wants from source_event into
    target_event. Prices upsert. Wants are re-created (items re-resolved to the
    target's active listings by canonical game) only if the user has no want
    groups in the target yet. Returns {"prices": n, "want_groups": m}."""
    from events.models import EventListing
    from .models import UserGamePrice, WantGroup, WantGroupItem

    prices = 0
    for gp in UserGamePrice.objects.filter(user=user, event=source_event):
        UserGamePrice.objects.update_or_create(
            user=user, event=target_event, board_game=gp.board_game,
            defaults={"price": gp.price},
        )
        prices += 1

    want_groups = 0
    if not WantGroup.objects.filter(user=user, event=target_event).exists():
        # Target's active listings owned by others, grouped by canonical game.
        by_game = {}
        target_listings = (
            EventListing.objects.filter(event=target_event, active=True)
            .select_related("copy")
            .exclude(copy__owner=user)
        )
        for el in target_listings:
            by_game.setdefault(el.copy.board_game_id, []).append(el)

        src_groups = (
            WantGroup.objects.filter(user=user, event=source_event)
            .prefetch_related("items__event_listing__copy")
        )
        for wg in src_groups:
            games = set()
            for it in wg.items.all():
                if it.event_listing_id and it.event_listing:
                    games.add(it.event_listing.copy.board_game_id)
                # combo want items have no single canonical game -> skipped
            target_items = []
            for g in games:
                target_items.extend(by_game.get(g, []))
            if not target_items:
                continue
            new_wg = WantGroup.objects.create(
                user=user, event=target_event, name=wg.name,
                min_receive=wg.min_receive,
                duplicate_protection=wg.duplicate_protection,
            )
            for el in target_items:
                WantGroupItem.objects.create(want_group=new_wg, event_listing=el)
            want_groups += 1

    return {"prices": prices, "want_groups": want_groups}
```

- [ ] **Step 4: Add the endpoint**

In `backend/trades/views.py`, append a view (uses the existing `EventScopedMixin`, `get_object_or_404`, `ValidationError`, `PermissionDenied`, `Response`, `status` already imported in the module):

```python
class ImportTradesView(EventScopedMixin, APIView):
    """POST /api/events/{slug}/import-trades/ — import the user's prices + wants
    from a previous event they joined. Body: {"from_event": "<source slug>"}."""

    def post(self, request, slug):
        target = self._get_event(slug)
        self._assert_editable(target)

        from_slug = request.data.get("from_event")
        if not from_slug:
            raise ValidationError({"from_event": "This field is required."})
        if from_slug == slug:
            raise ValidationError({"from_event": "Choose a different event."})

        from events.models import EventParticipation, TradeEvent
        source = get_object_or_404(TradeEvent, slug=from_slug)

        if not EventParticipation.objects.filter(event=target, user=request.user).exists():
            raise PermissionDenied("Join this event before importing into it.")
        if not EventParticipation.objects.filter(event=source, user=request.user).exists():
            raise ValidationError({"from_event": "You did not participate in that event."})

        from .services import import_user_trades
        summary = import_user_trades(request.user, source, target)
        return Response(summary, status=status.HTTP_200_OK)
```

- [ ] **Step 5: Wire the route**

In `backend/trades/urls.py`, import `ImportTradesView` (add to the `from .views import (...)` block) and add a route before the closing `]` of `urlpatterns`:

```python
    # Cross-event import
    path(
        "events/<slug:slug>/import-trades/",
        ImportTradesView.as_view(),
        name="import-trades",
    ),
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_import -v 2`
Expected: PASS (5 tests).

- [ ] **Step 7: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades events -v 1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/services.py backend/trades/views.py backend/trades/urls.py backend/trades/test_import.py
git commit -m "feat(import): import wants + per-game prices from a prior event"
```

---

### Task 2: Frontend import control

**Files:**
- Modify: `frontend/src/api/trades.ts`
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

- [ ] **Step 1: Add the API helper**

In `frontend/src/api/trades.ts`, append (after the want-bid helpers):

```ts
// ---- Cross-event import ----

export interface ImportTradesSummary {
  prices: number
  want_groups: number
}

export async function importTrades(
  targetSlug: string,
  fromEvent: string
): Promise<ImportTradesSummary> {
  const { data } = await apiClient.post<ImportTradesSummary>(
    `/events/${targetSlug}/import-trades/`,
    { from_event: fromEvent }
  )
  return data
}
```

- [ ] **Step 2: Add the import control to `EventDetailPage`**

In `frontend/src/features/events/EventDetailPage.tsx`, add `useEvents` to the
`../../api/events` import block (it currently imports `useEventListings` etc.; add
`useEvents`), and add a trades import:

```tsx
import { importTrades } from '../../api/trades'
```

Then add this component (place it near the other event-page section components,
e.g. directly after `MyCombosSection`):

```tsx
// ---- Import from a previous event ----

function ImportTradesSection({ event, username }: { event: TradeEvent; username: string }) {
  const qc = useQueryClient()
  const { data: eventsData } = useEvents({})
  const [fromSlug, setFromSlug] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (event.inputs_locked) return null

  const others = (eventsData?.results ?? []).filter(
    (e) => e.is_participant && e.slug !== event.slug
  )
  if (others.length === 0) return null

  async function handleImport() {
    if (!fromSlug) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const s = await importTrades(event.slug, fromSlug)
      setMsg(`Imported ${s.prices} price${s.prices !== 1 ? 's' : ''} and ${s.want_groups} want group${s.want_groups !== 1 ? 's' : ''}.`)
      qc.invalidateQueries({ queryKey: ['trades', 'want-groups', event.slug] })
      qc.invalidateQueries({ queryKey: ['trades', 'game-prices', event.slug] })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <h3 className="font-display text-base font-bold text-ink mb-2">Import from a previous event</h3>
      <p className="mb-3 text-xs text-moss/80">
        Copy your per-game prices and your wants (matched by game) from another
        event you joined. Best-effort — copies that are gone are skipped.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={fromSlug}
          onChange={(e) => setFromSlug(e.target.value)}
          className="rounded-xl border-2 border-ink/15 bg-parchment px-3 py-1.5 text-sm"
        >
          <option value="">Choose an event…</option>
          {others.map((e) => (
            <option key={e.slug} value={e.slug}>{e.name}</option>
          ))}
        </select>
        <button
          onClick={handleImport}
          disabled={!fromSlug || busy}
          className="rounded-full border-2 border-ink bg-fern px-3 py-1.5 text-xs font-semibold text-cream disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-green-700">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </section>
  )
}
```

Render it after `<MyCombosSection .../>` (it self-hides when locked or when the
user has no other joined events):

```tsx
        <MyCombosSection event={event} username={user.username} />
        <ImportTradesSection event={event} username={user.username} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors. (`useEvents`, `useQueryClient`, `useState`, `extractErrorMsg`, `TradeEvent` are already available/imported in `EventDetailPage.tsx` from prior work — verify; only add the two new import lines for `useEvents` and `importTrades`. If `useEvents` is already imported, don't duplicate.)

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/api/trades.ts src/features/events/EventDetailPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 4: Manual QA checklist**

On a non-locked event you've joined, with at least one OTHER event you also joined:
- An "Import from a previous event" section appears with a dropdown of your other joined events.
- Pick a prior event + Import → a summary ("Imported N prices and M want groups") shows; the want-groups / prices panels reflect the imports.
- Re-importing when you already have want groups → prices update but want groups stay at 0 (dedup).
- The section is hidden when the event is locked (MATCHING+) or you have no other joined events.

- [ ] **Step 5: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/api/trades.ts frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(import): import-from-previous-event control on the event page"
```

---

## Self-Review

**Spec coverage (Part B):**
- `import_user_trades`: per-game price upsert; wants re-targeted by game; dedup guard (skip if target has want groups); combo items skipped; offers/wishes/per-copy overrides excluded → Task 1 ✔
- Endpoint guards: participation in both, locked target → 403, same/unknown from_event → 400 → Task 1 ✔
- FE control (dropdown of joined events + import + summary), hidden when locked / no other events → Task 2 ✔
- Tests (copy prices+wants, dedup, same-event, non-participant, locked) + FE build/lint/manual → Tasks 1–2 ✔

**Placeholder scan:** none.

**Type/name consistency:** `import_user_trades(user, source_event, target_event)` returns `{"prices","want_groups"}`, consumed by `ImportTradesView` and surfaced via `importTrades()` → `ImportTradesSummary {prices, want_groups}` in the FE; endpoint path `events/{slug}/import-trades/` consistent between urls, view, and FE helper; `EventParticipation`/`TradeEvent`/`UserGamePrice`/`WantGroup`/`WantGroupItem`/`EventListing` match existing models.

**Notes for the executor:**
- Task 2 imports: `useEvents` from `../../api/events` and `importTrades` from `../../api/trades` are the only new imports needed; `useQueryClient`/`useState`/`extractErrorMsg`/`TradeEvent` already exist in the file (do not duplicate — eslint flags dupes). Verify the current import lines first.
- The want-group/game-price query keys used for invalidation (`['trades','want-groups',slug]`, `['trades','game-prices',slug]`) match the keys used elsewhere in the app (`TRADES_KEYS.wantGroups`, the game-prices query in the Prices panel).
