# Event Fulfillment: Leave-gating, Cascade, Shipping Pagination & Settlement Payments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate event join/leave, make leaving run the kick cascade, fix the profile back button, paginate + de-N+1 the shipping overview, and add a settlement-payment lifecycle consolidated with shipping.

**Architecture:** Django REST backend (`events`, `matching` apps) + Vite/React/react-query frontend. Backend keeps shipping and payment endpoints separate (per-item vs per-pair data); the frontend consolidates them into one stage view. Payments mirror the existing `Shipment` two-step pattern.

**Tech Stack:** Django, DRF, SQLite (dev); React, TypeScript, @tanstack/react-query, axios, TailwindCSS.

**Test commands:**
- Backend: from `backend/` → `./venv/bin/python manage.py test <path> -v 2`
- Frontend: from `frontend/` → `npm run build` (tsc + vite) and `npm run lint`

---

## Item 1 & 2 — Backend: join/leave gating + leave cascade

### Task 1: Leave is blocked after Matching and runs the kick cascade

**Files:**
- Modify: `backend/events/views.py` (`TradeEventViewSet.leave`, ~lines 270-278)
- Test: `backend/events/test_participation_rules.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `backend/events/test_participation_rules.py`:

```python
"""Join-exclusivity + leave-gating/cascade rules (items 1 & 2)."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from events.models import EventParticipation, EventListing, TradeEvent
from events.test_admin_dashboard import AdminDashboardBase
from trades.models import TradeWish, WantGroupItem

User = get_user_model()


class LeaveRulesTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org", password="x")
        self.u = User.objects.create_user("alice", password="x")
        self.event = TradeEvent.objects.create(name="E1", organizer=self.org)
        EventParticipation.objects.create(event=self.event, user=self.u)
        self.client.force_authenticate(self.u)

    def _leave(self):
        return self.client.delete(f"/api/events/{self.event.slug}/leave/")

    def test_leave_allowed_before_matching(self):
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.assertEqual(self._leave().status_code, 200)
        self.assertFalse(
            EventParticipation.objects.filter(event=self.event, user=self.u).exists()
        )

    def test_leave_blocked_after_matching(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])
        r = self._leave()
        self.assertEqual(r.status_code, 400)
        self.assertTrue(
            EventParticipation.objects.filter(event=self.event, user=self.u).exists()
        )

    def test_leave_when_not_participant(self):
        EventParticipation.objects.filter(event=self.event, user=self.u).delete()
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.assertEqual(self._leave().status_code, 400)


class LeaveCascadeTests(AdminDashboardBase):
    """Reuses the kick-cascade fixtures: victim has a listing + offer/want/wish,
    and `other` references the victim's specific listing."""

    def test_leave_runs_full_kick_cascade(self):
        self.event.status = TradeEvent.Status.WANTLIST_OPEN
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.victim)
        r = self.client.delete(f"/api/events/{self.event.slug}/leave/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["removed_listings"], 1)
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        self.assertFalse(TradeWish.objects.filter(user=self.victim, event=self.event).exists())
        # other user's reference to the victim's specific listing is cascaded away
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./venv/bin/python manage.py test events.test_participation_rules.LeaveRulesTests events.test_participation_rules.LeaveCascadeTests -v 2`
Expected: FAIL — `test_leave_runs_full_kick_cascade` (currently leave only deletes participation, so listing/wish survive) and `test_leave_blocked_after_matching` (currently leave succeeds in MATCHING).

- [ ] **Step 3: Implement the new `leave` body**

In `backend/events/views.py`, replace the `leave` action body:

```python
    @action(detail=True, methods=["delete"], url_path="leave")
    def leave(self, request, slug=None):
        event = self.get_object()
        if event.inputs_locked:
            raise ValidationError(
                {"detail": "You can't leave once matching has started."}
            )
        if not EventParticipation.objects.filter(
            event=event, user=request.user
        ).exists():
            raise ValidationError(
                {"detail": "You are not a participant in this event."}
            )
        summary = kick_participant(event, request.user)
        return Response(summary, status=status.HTTP_200_OK)
```

(`kick_participant` is already imported at the top of `views.py`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_participation_rules.LeaveRulesTests events.test_participation_rules.LeaveCascadeTests -v 2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/events/views.py backend/events/test_participation_rules.py
git commit -m "feat(events): block leave after matching + leave runs kick cascade"
```

---

### Task 2: Join is blocked while in another non-archived event

**Files:**
- Modify: `backend/events/views.py` (`TradeEventViewSet.join`, ~line 206; add `_enforce_single_event` helper)
- Test: `backend/events/test_participation_rules.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/events/test_participation_rules.py`:

```python
class JoinExclusivityTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org2", password="x")
        self.u = User.objects.create_user("bob", password="x")
        self.e1 = TradeEvent.objects.create(name="E-one", organizer=self.org)
        self.e2 = TradeEvent.objects.create(name="E-two", organizer=self.org)
        self.client.force_authenticate(self.u)

    def _join(self, e):
        return self.client.post(f"/api/events/{e.slug}/join/", {}, format="json")

    def test_blocked_while_in_another_active_event(self):
        self.assertEqual(self._join(self.e1).status_code, 201)
        r = self._join(self.e2)
        self.assertEqual(r.status_code, 400)
        self.assertIn("already participating", str(r.data).lower())

    def test_rejoin_same_event_is_idempotent(self):
        self.assertEqual(self._join(self.e1).status_code, 201)
        self.assertEqual(self._join(self.e1).status_code, 200)

    def test_allowed_once_other_event_archived(self):
        self._join(self.e1)
        self.e1.status = "ARCHIVED"
        self.e1.save(update_fields=["status"])
        self.assertEqual(self._join(self.e2).status_code, 201)

    def test_organizing_without_joining_does_not_block(self):
        # u organizes e3 but never joins it; should still be free to join e1.
        TradeEvent.objects.create(name="E-three", organizer=self.u)
        self.assertEqual(self._join(self.e1).status_code, 201)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./venv/bin/python manage.py test events.test_participation_rules.JoinExclusivityTests -v 2`
Expected: FAIL on `test_blocked_while_in_another_active_event` (currently join always succeeds).

- [ ] **Step 3: Implement the guard**

In `backend/events/views.py`, add a call at the start of the `join` action body (right after `event = self.get_object()` and the location gate):

```python
    @action(detail=True, methods=["post"], url_path="join")
    def join(self, request, slug=None):
        event = self.get_object()
        self._enforce_location_gate(event, request.user)
        self._enforce_single_event(event, request.user)
        participation, created = EventParticipation.objects.get_or_create(
            event=event,
            user=request.user,
            defaults={
                "region": request.data.get("region", ""),
                "shipping_pref": request.data.get("shipping_pref", ""),
            },
        )
```

And add the helper method to the viewset (place next to `_enforce_location_gate`):

```python
    @staticmethod
    def _enforce_single_event(event, user):
        clash = (
            EventParticipation.objects
            .filter(user=user)
            .exclude(event=event)
            .exclude(event__status=TradeEvent.Status.ARCHIVED)
            .select_related("event")
            .first()
        )
        if clash:
            raise ValidationError({"detail":
                f"You're already participating in “{clash.event.name}”. "
                f"Leave it before joining another event."})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_participation_rules -v 2`
Expected: PASS (all classes)

- [ ] **Step 5: Regression-check existing events tests**

Run: `cd backend && ./venv/bin/python manage.py test events -v 1`
Expected: PASS (no regressions in join_gate/admin tests).

- [ ] **Step 6: Commit**

```bash
git add backend/events/views.py backend/events/test_participation_rules.py
git commit -m "feat(events): block joining a second event while in a non-archived one"
```

---

## Item 1 & 2 — Frontend: join/leave UI

### Task 3: Hide Leave once matching starts + warn it is destructive

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx` (`JoinLeaveButton`, ~lines 88-191)

- [ ] **Step 1: Compute a `canLeave` flag and gate the Leave control**

In `JoinLeaveButton`, after the `canJoin` line (~line 117), add:

```tsx
  // Leaving is only allowed before matching begins (server enforces too).
  const lockedStatuses: EventStatus[] = ['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED']
  const canLeave = !lockedStatuses.includes(event.status)
```

- [ ] **Step 2: Use `canLeave` to render the Leave button**

In the `event.is_participant` branch, replace the non-confirm block (the `<div className="flex items-center gap-3">` that shows "You're participating" + Leave button, ~lines 163-177) so the Leave button only renders when `canLeave`:

```tsx
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              You're participating
            </span>
            {canLeave && (
              <button
                onClick={() => setConfirmLeave(true)}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Leave
              </button>
            )}
          </div>
        )
```

- [ ] **Step 3: Update the confirm copy to warn about the cascade**

Replace the confirm prompt text (~line 147) `<span className="text-xs text-gray-500">Leave this event?</span>` with:

```tsx
            <span className="text-xs text-gray-500">
              Leave this event? This removes all your copies, want lists, and wishes from it.
            </span>
```

- [ ] **Step 4: Verify build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS (no TS/lint errors)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): hide Leave after matching + warn leave is destructive"
```

---

### Task 4: Trader profile "← Back" returns to previous page

**Files:**
- Modify: `frontend/src/features/profile/PublicProfilePage.tsx`

- [ ] **Step 1: Import `useNavigate`**

Change the import on line 2 from:

```tsx
import { useParams, Link } from 'react-router-dom'
```

to:

```tsx
import { useParams, Link, useNavigate } from 'react-router-dom'
```

- [ ] **Step 2: Create the navigate handle**

Inside `PublicProfilePage`, after `const { username } = useParams...` add:

```tsx
  const navigate = useNavigate()
```

- [ ] **Step 3: Replace the bottom Back link with a back-navigating button**

Replace the final link (~lines 107-109):

```tsx
      <Link to="/" className="mt-6 inline-block text-sm text-indigo-600 hover:underline">
        ← Back
      </Link>
```

with:

```tsx
      <button
        onClick={() => navigate(-1)}
        className="mt-6 inline-block text-sm text-indigo-600 hover:underline"
      >
        ← Back
      </button>
```

(Leave the error-state "← Back to home" `<Link to="/">` unchanged — it is the right fallback for a broken URL.)

- [ ] **Step 4: Verify build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/profile/PublicProfilePage.tsx
git commit -m "fix(profile): Back button returns to previous page, not home"
```

---

## Item 4 — Backend: shipping overview pagination + N+1

### Task 5: Add `ensure_shipments` service and remove the get_or_create N+1

**Files:**
- Create: `backend/matching/services.py`
- Modify: `backend/matching/views.py` (`ShippingView`, `ShippingOverviewView`)
- Test: `backend/matching/test_shipping_overview.py` (append an N+1 guard)

- [ ] **Step 1: Write the failing N+1 guard test**

Append to `backend/matching/test_shipping_overview.py`:

```python
from django.db import connection
from django.test.utils import CaptureQueriesContext


class ShippingOverviewQueryTests(ShippingOverviewTests):
    def test_query_count_does_not_grow_with_shipments(self):
        run = self._setup_run()  # 2 assignments
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())  # warm: create the 2 shipments
        with CaptureQueriesContext(connection) as small:
            self.client.get(self._url() + "?page_size=100")

        # Add 4 more assignments (one per remaining listing) → 6 shipments total.
        for el in (self.el_a2, self.el_b2, self.el_c1, self.el_c2):
            TradeAssignment.objects.create(
                match_run=run, event_listing=el, giver=self.user_a,
                receiver=self.user_b, cycle_id=2,
            )
        self.client.get(self._url())  # create the new shipments
        with CaptureQueriesContext(connection) as large:
            self.client.get(self._url() + "?page_size=100")

        self.assertEqual(
            len(large.captured_queries), len(small.captured_queries),
            "shipping overview query count must be constant w.r.t. shipment count",
        )
```

Note: this test subclasses `ShippingOverviewTests` for its `_url`/`_setup_run` helpers and relies on the `MatchingTestBase` listings `el_a2, el_b2, el_c1, el_c2`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview.ShippingOverviewQueryTests -v 2`
Expected: FAIL — current code runs one `get_or_create` per assignment plus per-row serializer lookups, so the large run issues more queries than the small one. (It will also error on the unknown `?page_size` until Task 6; that is fine — it must at minimum not be equal/passing yet.)

- [ ] **Step 3: Create the service helper**

Create `backend/matching/services.py` with **only** `ensure_shipments` for now — `ensure_payments` is added in Task 9 (its `SettlementPayment` model does not exist until Task 8):

```python
"""
matching/services.py

Lazy, N+1-free creation of fulfillment rows for a DONE match run.
Idempotent — safe to call on every read.
"""

from .models import Shipment, TradeAssignment


def ensure_shipments(run):
    """Bulk-create any missing Shipment rows for `run` in a single insert."""
    existing = set(
        Shipment.objects.filter(assignment__match_run=run)
        .values_list("assignment_id", flat=True)
    )
    missing = (
        TradeAssignment.objects.filter(match_run=run)
        .exclude(id__in=existing)
        .values_list("id", flat=True)
    )
    Shipment.objects.bulk_create(
        [Shipment(assignment_id=aid) for aid in missing],
        ignore_conflicts=True,
    )
```

- [ ] **Step 4: Refactor the two shipping views to use `ensure_shipments`**

In `backend/matching/views.py`, add the import near the top:

```python
from .services import ensure_shipments
```

Replace `ShippingView.get`:

```python
    def get(self, request, slug):
        event = _get_event(slug)
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        ensure_shipments(run)
        shipments = (
            Shipment.objects.filter(assignment__match_run=run)
            .filter(Q(assignment__giver=request.user) | Q(assignment__receiver=request.user))
            .select_related(
                "assignment__event_listing__copy__board_game",
                "assignment__giver", "assignment__receiver",
            )
            .order_by("id")
        )
        return Response(
            ShipmentSerializer(shipments, many=True, context={"request": request}).data
        )
```

Replace `ShippingOverviewView.get` (pagination added in Task 6; for now just remove the N+1 loop):

```python
    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        ensure_shipments(run)
        shipments = (
            Shipment.objects.filter(assignment__match_run=run)
            .select_related(
                "assignment__event_listing__copy__board_game",
                "assignment__giver", "assignment__receiver",
            )
            .order_by("id")
        )
        return Response(
            ShipmentSerializer(shipments, many=True, context={"request": request}).data
        )
```

- [ ] **Step 5: Run shipping tests**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping matching.test_shipping_overview -v 2`
Expected: the N+1 guard now passes (constant query count); existing list-shape tests still pass. (Pagination shape comes in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add backend/matching/services.py backend/matching/views.py backend/matching/test_shipping_overview.py
git commit -m "perf(matching): bulk-ensure shipments + select_related to kill overview N+1"
```

---

### Task 6: Paginate the shipping overview + status filter

**Files:**
- Modify: `backend/matching/views.py` (`ShippingOverviewView`)
- Test: `backend/matching/test_shipping_overview.py` (update existing assertions to the paginated shape)

- [ ] **Step 1: Update existing tests to the paginated shape**

In `backend/matching/test_shipping_overview.py`, update assertions:

```python
    def test_organizer_sees_all_shipments(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_a)  # organizer
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["count"], 2)
        self.assertEqual(len(r.data["results"]), 2)

    def test_empty_when_no_done_run(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["count"], 0)
        self.assertEqual(r.data["results"], [])
```

And add a status-filter test:

```python
    def test_status_filter(self):
        run = self._setup_run()
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())  # create shipments
        Shipment.objects.filter(assignment__match_run=run).update(status="SENT")
        r = self.client.get(self._url() + "?status=SENT")
        self.assertEqual(r.data["count"], 2)
        r2 = self.client.get(self._url() + "?status=PENDING")
        self.assertEqual(r2.data["count"], 0)
```

(`test_lazily_creates_shipments` and `test_non_organizer_forbidden` are unchanged and still pass.)

- [ ] **Step 2: Run to verify the shape tests fail**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview.ShippingOverviewTests -v 2`
Expected: FAIL — current view returns a bare list, so `r.data["count"]` raises.

- [ ] **Step 3: Add pagination + status filter to the view**

Replace `ShippingOverviewView.get` in `backend/matching/views.py`:

```python
    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"count": 0, "next": None, "previous": None, "results": []})
        ensure_shipments(run)
        qs = (
            Shipment.objects.filter(assignment__match_run=run)
            .select_related(
                "assignment__event_listing__copy__board_game",
                "assignment__giver", "assignment__receiver",
            )
            .order_by("id")
        )
        status_f = request.query_params.get("status")
        if status_f:
            qs = qs.filter(status=status_f)
        paginator = MatchPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            ShipmentSerializer(page, many=True, context={"request": request}).data
        )
```

- [ ] **Step 4: Run all shipping-overview tests**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview -v 2`
Expected: PASS (shape, status filter, lazy-create, forbidden, N+1 guard).

- [ ] **Step 5: Commit**

```bash
git add backend/matching/views.py backend/matching/test_shipping_overview.py
git commit -m "feat(matching): paginate shipping overview + status filter"
```

---

### Task 7: Shipping overview summary endpoint (counts + per-trader rollup)

**Files:**
- Modify: `backend/matching/views.py` (new `ShippingOverviewSummaryView`), `backend/matching/urls.py`
- Test: `backend/matching/test_shipping_overview.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/matching/test_shipping_overview.py`:

```python
class ShippingOverviewSummaryTests(ShippingOverviewTests):
    def _summary_url(self):
        return f"/api/events/{self.slug}/shipping/overview/summary/"

    def test_summary_counts_and_rollup(self):
        run = self._setup_run()  # a1: alice→bob, b1: bob→alice
        self.client.force_authenticate(user=self.user_a)
        self.client.get(self._url())  # create shipments
        Shipment.objects.filter(
            assignment__match_run=run, assignment__giver=self.user_a
        ).update(status="SENT")
        r = self.client.get(self._summary_url())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["counts"].get("SENT"), 1)
        self.assertEqual(r.data["counts"].get("PENDING"), 1)
        alice = next(t for t in r.data["traders"] if t["username"] == "alice")
        self.assertEqual(alice["out_total"], 1)
        self.assertEqual(alice["out_sent"], 1)
        self.assertEqual(alice["in_total"], 1)
        self.assertEqual(alice["in_received"], 0)

    def test_summary_non_organizer_forbidden(self):
        self._setup_run()
        self.client.force_authenticate(user=self.user_b)
        self.assertEqual(self.client.get(self._summary_url()).status_code, 403)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview.ShippingOverviewSummaryTests -v 2`
Expected: FAIL — route 404 (no summary endpoint yet).

- [ ] **Step 3: Add the view**

In `backend/matching/views.py`, add `Count` to the django imports:

```python
from django.db.models import Count, Q
```

Add the view (after `ShippingOverviewView`):

```python
class ShippingOverviewSummaryView(APIView):
    """GET /api/events/{slug}/shipping/overview/summary/ — organizer-only.
    Global status counts + per-trader rollup (independent of pagination)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"counts": {}, "traders": []})
        ensure_shipments(run)
        base = Shipment.objects.filter(assignment__match_run=run)
        counts = {
            row["status"]: row["c"]
            for row in base.values("status").annotate(c=Count("id"))
        }
        traders: dict[str, dict] = {}

        def slot(username):
            return traders.setdefault(username, {
                "username": username, "out_total": 0, "out_sent": 0,
                "in_total": 0, "in_received": 0,
            })

        for row in base.values("assignment__giver__username").annotate(
            out_total=Count("id"),
            out_sent=Count("id", filter=Q(status__in=["SENT", "RECEIVED"])),
        ):
            s = slot(row["assignment__giver__username"])
            s["out_total"] = row["out_total"]
            s["out_sent"] = row["out_sent"]
        for row in base.values("assignment__receiver__username").annotate(
            in_total=Count("id"),
            in_received=Count("id", filter=Q(status="RECEIVED")),
        ):
            s = slot(row["assignment__receiver__username"])
            s["in_total"] = row["in_total"]
            s["in_received"] = row["in_received"]

        return Response({
            "counts": counts,
            "traders": sorted(traders.values(), key=lambda t: t["username"]),
        })
```

- [ ] **Step 4: Wire the URL**

In `backend/matching/urls.py`, import `ShippingOverviewSummaryView` and add (before the `shipping/<int:pk>/` route):

```python
    path(
        "events/<slug:slug>/shipping/overview/summary/",
        ShippingOverviewSummaryView.as_view(),
        name="shipping-overview-summary",
    ),
```

- [ ] **Step 5: Run tests**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_shipping_overview -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_shipping_overview.py
git commit -m "feat(matching): shipping overview summary (counts + per-trader rollup)"
```

---

## Item 5 — Backend: settlement payments

### Task 8: `SettlementPayment` model + migration

**Files:**
- Modify: `backend/matching/models.py`
- Create: `backend/matching/migrations/000X_settlementpayment.py` (via makemigrations)
- Test: `backend/matching/test_payments.py` (create)

- [ ] **Step 1: Write the failing model test**

Create `backend/matching/test_payments.py`:

```python
"""Settlement payments (item 5): model, derivation, endpoints."""
from matching.tests import MatchingTestBase
from matching.models import MatchRun, SettlementPayment


class PaymentModelTests(MatchingTestBase):
    def test_payment_defaults_pending(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        p = SettlementPayment.objects.create(
            match_run=run, from_user=self.user_b, to_user=self.user_a, amount="5.00"
        )
        self.assertEqual(p.status, SettlementPayment.Status.PENDING)
        self.assertEqual(p.note, "")
        self.assertIsNone(p.paid_at)
        self.assertIsNone(p.confirmed_at)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.PaymentModelTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'SettlementPayment'`.

- [ ] **Step 3: Add the model**

Append to `backend/matching/models.py`:

```python
class SettlementPayment(models.Model):
    """A netted money transfer between two users for a match run.

    Derived from MatchRun.result["settlement"] (minimal-transfer plan).
    Keyed per (run, from_user, to_user) — NOT per assignment.
    """

    class Status(models.TextChoices):
        PENDING   = "PENDING",   "Pending"
        PAID      = "PAID",      "Paid"
        CONFIRMED = "CONFIRMED", "Confirmed"

    match_run = models.ForeignKey(
        MatchRun, on_delete=models.CASCADE, related_name="payments"
    )
    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="payments_owed",
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="payments_due",
    )
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    status       = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    note         = models.TextField(blank=True)
    paid_at      = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created      = models.DateTimeField(auto_now_add=True)
    updated      = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("match_run", "from_user", "to_user")]
        ordering = ["id"]

    def __str__(self):
        return (
            f"SettlementPayment(run={self.match_run_id}, "
            f"{self.from_user_id}->{self.to_user_id}, {self.status})"
        )
```

- [ ] **Step 4: Make + run the migration**

Run:
```bash
cd backend && ./venv/bin/python manage.py makemigrations matching
```
Expected: creates `matching/migrations/000X_settlementpayment.py`.

- [ ] **Step 5: Run the model test**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.PaymentModelTests -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/models.py backend/matching/migrations/
git commit -m "feat(matching): SettlementPayment model + migration"
```

---

### Task 9: `ensure_payments` service + `SettlementPaymentSerializer`

**Files:**
- Modify: `backend/matching/services.py` (add `ensure_payments` if not already present from Task 5), `backend/matching/serializers.py`
- Test: `backend/matching/test_payments.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/matching/test_payments.py`:

```python
from matching.services import ensure_payments


class EnsurePaymentsTests(MatchingTestBase):
    def _run_with_settlement(self):
        return MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE,
            result={"settlement": [
                {"from_user": "bob", "to_user": "alice", "amount": "5.00"},
            ]},
        )

    def test_creates_and_is_idempotent(self):
        run = self._run_with_settlement()
        ensure_payments(run)
        ensure_payments(run)
        self.assertEqual(
            SettlementPayment.objects.filter(match_run=run).count(), 1
        )
        p = SettlementPayment.objects.get(match_run=run)
        self.assertEqual(p.from_user, self.user_b)
        self.assertEqual(p.to_user, self.user_a)
        self.assertEqual(str(p.amount), "5.00")

    def test_noop_without_settlement(self):
        run = MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE, result={}
        )
        ensure_payments(run)
        self.assertEqual(SettlementPayment.objects.filter(match_run=run).count(), 0)


class PaymentSerializerTests(MatchingTestBase):
    def test_serializer_fields(self):
        from matching.serializers import SettlementPaymentSerializer
        fields = set(SettlementPaymentSerializer().fields)
        self.assertTrue({
            "id", "status", "amount", "note", "from_username",
            "to_username", "my_role", "paid_at", "confirmed_at",
        }.issubset(fields))
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.EnsurePaymentsTests matching.test_payments.PaymentSerializerTests -v 2`
Expected: FAIL — `ensure_payments` missing and/or serializer missing.

- [ ] **Step 3: Add `ensure_payments` to services.py**

In `backend/matching/services.py`, add the user-model import and the `SettlementPayment` model import, then append the function:

```python
from django.contrib.auth import get_user_model

from .models import Shipment, TradeAssignment, SettlementPayment  # update existing import


def ensure_payments(run):
    """Bulk-create SettlementPayment rows from the run's netted settlement plan.

    No-op when the run has no settlement (barter-only / money disabled).
    """
    transfers = (run.result or {}).get("settlement", [])
    if not transfers:
        return
    User = get_user_model()
    names = {t["from_user"] for t in transfers} | {t["to_user"] for t in transfers}
    users = {u.username: u for u in User.objects.filter(username__in=names)}
    existing = set(
        SettlementPayment.objects.filter(match_run=run)
        .values_list("from_user_id", "to_user_id")
    )
    rows = []
    for t in transfers:
        f = users.get(t["from_user"])
        to = users.get(t["to_user"])
        if not f or not to or (f.id, to.id) in existing:
            continue
        rows.append(
            SettlementPayment(
                match_run=run, from_user=f, to_user=to, amount=t["amount"]
            )
        )
    SettlementPayment.objects.bulk_create(rows, ignore_conflicts=True)
```

- [ ] **Step 4: Add the serializer**

In `backend/matching/serializers.py`, update the model import to include `SettlementPayment`:

```python
from .models import MatchRun, TradeAssignment, Shipment, SettlementPayment
```

Append:

```python
class SettlementPaymentSerializer(serializers.ModelSerializer):
    from_username = serializers.CharField(source="from_user.username", read_only=True)
    to_username   = serializers.CharField(source="to_user.username", read_only=True)
    my_role       = serializers.SerializerMethodField()

    class Meta:
        model = SettlementPayment
        fields = ["id", "status", "amount", "note", "from_username",
                  "to_username", "my_role", "paid_at", "confirmed_at"]
        read_only_fields = fields

    def get_my_role(self, obj):
        uid = self.context["request"].user.id
        if obj.from_user_id == uid:
            return "payer"
        if obj.to_user_id == uid:
            return "payee"
        return None
```

- [ ] **Step 5: Run tests**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.EnsurePaymentsTests matching.test_payments.PaymentSerializerTests -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/services.py backend/matching/serializers.py backend/matching/test_payments.py
git commit -m "feat(matching): ensure_payments derivation + SettlementPaymentSerializer"
```

---

### Task 10: Payment endpoints — mine (GET) + status PATCH

**Files:**
- Modify: `backend/matching/views.py`, `backend/matching/urls.py`
- Test: `backend/matching/test_payments.py` (append)

- [ ] **Step 1: Write failing endpoint tests**

Append to `backend/matching/test_payments.py`:

```python
class PaymentEndpointBase(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"
        self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE,
            result={"settlement": [
                {"from_user": "bob", "to_user": "alice", "amount": "5.00"},
            ]},
        )

    def _mine(self):
        return f"/api/events/{self.slug}/payments/"

    def _detail(self, pk):
        return f"/api/events/{self.slug}/payments/{pk}/"


class PaymentMineTests(PaymentEndpointBase):
    def test_payer_sees_pending_payment(self):
        self.client.force_authenticate(self.user_b)  # bob = payer
        r = self.client.get(self._mine())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["my_role"], "payer")
        self.assertEqual(r.data[0]["status"], "PENDING")

    def test_payee_sees_payment(self):
        self.client.force_authenticate(self.user_a)  # alice = payee
        r = self.client.get(self._mine())
        self.assertEqual(r.data[0]["my_role"], "payee")

    def test_uninvolved_user_sees_none(self):
        self.client.force_authenticate(self.user_c)  # carol
        r = self.client.get(self._mine())
        self.assertEqual(r.data, [])


class PaymentPatchTests(PaymentEndpointBase):
    def _payment(self):
        ensure_payments(self.run)
        return SettlementPayment.objects.get(match_run=self.run)

    def test_payer_marks_paid_with_note(self):
        p = self._payment()
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(self._detail(p.id),
                              {"status": "PAID", "note": "venmo #42"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        p.refresh_from_db()
        self.assertEqual(p.status, "PAID")
        self.assertEqual(p.note, "venmo #42")
        self.assertIsNotNone(p.paid_at)

    def test_payee_cannot_mark_paid(self):
        p = self._payment()
        self.client.force_authenticate(self.user_a)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "PAID"}, format="json").status_code,
            403,
        )

    def test_payee_confirms_after_paid(self):
        p = self._payment()
        p.status = "PAID"; p.save(update_fields=["status"])
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        p.refresh_from_db()
        self.assertEqual(p.status, "CONFIRMED")
        self.assertIsNotNone(p.confirmed_at)

    def test_confirm_requires_paid_first(self):
        p = self._payment()
        self.client.force_authenticate(self.user_a)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json").status_code,
            400,
        )

    def test_payer_cannot_confirm(self):
        p = self._payment()
        p.status = "PAID"; p.save(update_fields=["status"])
        self.client.force_authenticate(self.user_b)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json").status_code,
            403,
        )

    def test_patch_blocked_when_not_shipping(self):
        p = self._payment()
        self.event.status = "ARCHIVED"; self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.user_b)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "PAID"}, format="json").status_code,
            403,
        )
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.PaymentMineTests matching.test_payments.PaymentPatchTests -v 2`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add the views**

In `backend/matching/views.py`:
- extend the models import: `from .models import MatchRun, TradeAssignment, Shipment, SettlementPayment`
- extend the serializers import to include `SettlementPaymentSerializer`
- extend the services import: `from .services import ensure_shipments, ensure_payments`

Add the views (after `ShipmentDetailView`):

```python
# ---------------------------------------------------------------------------
# Settlement payments
# ---------------------------------------------------------------------------

class PaymentsView(APIView):
    """GET /api/events/{slug}/payments/ — current user's payments (payer or payee)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        ensure_payments(run)
        qs = (
            SettlementPayment.objects.filter(match_run=run)
            .filter(Q(from_user=request.user) | Q(to_user=request.user))
            .select_related("from_user", "to_user")
            .order_by("id")
        )
        return Response(
            SettlementPaymentSerializer(qs, many=True, context={"request": request}).data
        )


class PaymentDetailView(APIView):
    """PATCH /api/events/{slug}/payments/{pk}/ — payer marks PAID; payee CONFIRMS.
    Only while event.status == SHIPPING."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, slug, pk):
        event = _get_event(slug)
        if event.status != "SHIPPING":
            raise PermissionDenied("Payment updates are only allowed while the event is shipping.")
        try:
            payment = (
                SettlementPayment.objects
                .select_related("from_user", "to_user", "match_run")
                .get(pk=pk, match_run__event=event)
            )
        except SettlementPayment.DoesNotExist:
            raise NotFound("Payment not found.")

        target = request.data.get("status")
        if target == "PAID":
            if request.user != payment.from_user:
                raise PermissionDenied("Only the payer can mark a payment paid.")
            payment.status = SettlementPayment.Status.PAID
            payment.paid_at = timezone.now()
            if "note" in request.data:
                payment.note = request.data["note"]
        elif target == "CONFIRMED":
            if request.user != payment.to_user:
                raise PermissionDenied("Only the payee can confirm a payment.")
            if payment.status != SettlementPayment.Status.PAID:
                raise ValidationError(
                    {"status": "Payment must be marked paid before it can be confirmed."}
                )
            payment.status = SettlementPayment.Status.CONFIRMED
            payment.confirmed_at = timezone.now()
        else:
            raise ValidationError({"status": "Must be 'PAID' (payer) or 'CONFIRMED' (payee)."})

        payment.save()
        return Response(
            SettlementPaymentSerializer(payment, context={"request": request}).data
        )
```

- [ ] **Step 4: Wire the URLs**

In `backend/matching/urls.py`, import `PaymentsView, PaymentDetailView` and add:

```python
    path(
        "events/<slug:slug>/payments/",
        PaymentsView.as_view(),
        name="payments-list",
    ),
    path(
        "events/<slug:slug>/payments/<int:pk>/",
        PaymentDetailView.as_view(),
        name="payments-detail",
    ),
```

- [ ] **Step 5: Run tests**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_payments.py
git commit -m "feat(matching): settlement payment endpoints (mine + mark paid/confirm)"
```

---

### Task 11: Payments overview + summary (organizer)

**Files:**
- Modify: `backend/matching/views.py`, `backend/matching/urls.py`
- Test: `backend/matching/test_payments.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/matching/test_payments.py`:

```python
class PaymentOverviewTests(PaymentEndpointBase):
    def _overview(self):
        return f"/api/events/{self.slug}/payments/overview/"

    def _summary(self):
        return f"/api/events/{self.slug}/payments/overview/summary/"

    def test_overview_organizer_only(self):
        self.client.force_authenticate(self.user_b)  # not organizer
        self.assertEqual(self.client.get(self._overview()).status_code, 403)

    def test_overview_paginated(self):
        self.client.force_authenticate(self.user_a)  # organizer
        r = self.client.get(self._overview())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(len(r.data["results"]), 1)

    def test_overview_status_filter(self):
        self.client.force_authenticate(self.user_a)
        self.client.get(self._overview())  # create payment rows
        SettlementPayment.objects.filter(match_run=self.run).update(status="PAID")
        self.assertEqual(self.client.get(self._overview() + "?status=PAID").data["count"], 1)
        self.assertEqual(self.client.get(self._overview() + "?status=PENDING").data["count"], 0)

    def test_summary_counts_and_rollup(self):
        self.client.force_authenticate(self.user_a)
        self.client.get(self._overview())  # create payment rows
        r = self.client.get(self._summary())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["counts"].get("PENDING"), 1)
        bob = next(u for u in r.data["users"] if u["username"] == "bob")
        self.assertEqual(bob["owe_total"], 1)
        self.assertEqual(bob["owe_paid"], 0)
        alice = next(u for u in r.data["users"] if u["username"] == "alice")
        self.assertEqual(alice["due_total"], 1)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && ./venv/bin/python manage.py test matching.test_payments.PaymentOverviewTests -v 2`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add the views**

In `backend/matching/views.py`, add (after `PaymentDetailView`):

```python
class PaymentsOverviewView(APIView):
    """GET /api/events/{slug}/payments/overview/ — organizer-only, paginated."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the payments overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"count": 0, "next": None, "previous": None, "results": []})
        ensure_payments(run)
        qs = (
            SettlementPayment.objects.filter(match_run=run)
            .select_related("from_user", "to_user")
            .order_by("id")
        )
        status_f = request.query_params.get("status")
        if status_f:
            qs = qs.filter(status=status_f)
        paginator = MatchPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            SettlementPaymentSerializer(page, many=True, context={"request": request}).data
        )


class PaymentsOverviewSummaryView(APIView):
    """GET /api/events/{slug}/payments/overview/summary/ — organizer counts + rollup."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the payments overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"counts": {}, "users": []})
        ensure_payments(run)
        base = SettlementPayment.objects.filter(match_run=run)
        counts = {
            row["status"]: row["c"]
            for row in base.values("status").annotate(c=Count("id"))
        }
        users: dict[str, dict] = {}

        def slot(username):
            return users.setdefault(username, {
                "username": username, "owe_total": 0, "owe_paid": 0,
                "due_total": 0, "due_confirmed": 0,
            })

        for row in base.values("from_user__username").annotate(
            owe_total=Count("id"),
            owe_paid=Count("id", filter=Q(status__in=["PAID", "CONFIRMED"])),
        ):
            s = slot(row["from_user__username"])
            s["owe_total"] = row["owe_total"]
            s["owe_paid"] = row["owe_paid"]
        for row in base.values("to_user__username").annotate(
            due_total=Count("id"),
            due_confirmed=Count("id", filter=Q(status="CONFIRMED")),
        ):
            s = slot(row["to_user__username"])
            s["due_total"] = row["due_total"]
            s["due_confirmed"] = row["due_confirmed"]

        return Response({
            "counts": counts,
            "users": sorted(users.values(), key=lambda u: u["username"]),
        })
```

- [ ] **Step 4: Wire the URLs**

In `backend/matching/urls.py`, import `PaymentsOverviewView, PaymentsOverviewSummaryView` and add (the summary route MUST come before `payments/<int:pk>/`):

```python
    path(
        "events/<slug:slug>/payments/overview/",
        PaymentsOverviewView.as_view(),
        name="payments-overview",
    ),
    path(
        "events/<slug:slug>/payments/overview/summary/",
        PaymentsOverviewSummaryView.as_view(),
        name="payments-overview-summary",
    ),
```

Note: `<int:pk>` won't match `overview`, so ordering relative to the detail route is safe, but keep `overview/` and `overview/summary/` together for clarity.

- [ ] **Step 5: Run tests + full matching suite**

Run: `cd backend && ./venv/bin/python manage.py test matching -v 1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_payments.py
git commit -m "feat(matching): organizer payments overview + summary"
```

---

## Item 4 & 5 — Frontend

### Task 12: `shipping.ts` — paginated overview + summary

**Files:**
- Modify: `frontend/src/api/shipping.ts`

- [ ] **Step 1: Replace the overview fetchers/hooks**

Edit `frontend/src/api/shipping.ts`. Add the import at the top:

```ts
import type { PaginatedResponse } from './games'
```

Add the summary type after the `Shipment` interface:

```ts
export interface ShippingSummary {
  counts: Partial<Record<Shipment['status'], number>>
  traders: {
    username: string
    out_total: number
    out_sent: number
    in_total: number
    in_received: number
  }[]
}
```

Replace `fetchShippingOverview` and `useShippingOverview` with:

```ts
async function fetchShippingOverview(
  slug: string, page: number, status: string,
): Promise<PaginatedResponse<Shipment>> {
  const { data } = await apiClient.get<PaginatedResponse<Shipment>>(
    `/events/${slug}/shipping/overview/`,
    { params: { page, status: status || undefined } },
  )
  return data
}

async function fetchShippingSummary(slug: string): Promise<ShippingSummary> {
  const { data } = await apiClient.get<ShippingSummary>(
    `/events/${slug}/shipping/overview/summary/`,
  )
  return data
}

export function useShippingOverview(
  slug: string | undefined, page: number, status: string, enabled: boolean,
) {
  return useQuery({
    queryKey: ['shipping', 'overview', slug ?? '', page, status],
    queryFn: () => fetchShippingOverview(slug!, page, status),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function useShippingSummary(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['shipping', 'summary', slug ?? ''],
    queryFn: () => fetchShippingSummary(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: FAIL — `ShippingOverviewTab.tsx` still calls the old `useShippingOverview(slug, true)` signature. That is fixed in Task 13. (Confirm the error is only in `ShippingOverviewTab.tsx`.)

- [ ] **Step 3: Commit (with Task 13 — do not commit a broken build alone)**

Defer the commit to the end of Task 13.

---

### Task 13: Rewrite `ShippingOverviewTab` for pagination + summary

**Files:**
- Modify: `frontend/src/features/matching/ShippingOverviewTab.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `frontend/src/features/matching/ShippingOverviewTab.tsx`:

```tsx
import { useState } from 'react'
import { useShippingOverview, useShippingSummary } from '../../api/shipping'
import type { Shipment } from '../../api/shipping'
import { GameThumb } from '../../components/GameThumb'

type StatusFilter = '' | 'PENDING' | 'SENT' | 'RECEIVED'

const STATUS_PILL: Record<Shipment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEIVED: 'bg-green-50 text-green-700 border-green-200',
}

const label = (s: Shipment['status']) => s.charAt(0) + s.slice(1).toLowerCase()

export function ShippingOverviewTab({ slug }: { slug: string }) {
  const [filter, setFilter] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const { data: summary } = useShippingSummary(slug, true)
  const { data: pageData, isLoading } = useShippingOverview(slug, page, filter, true)

  const counts = summary?.counts ?? {}
  const rollup = summary?.traders ?? []
  const rows = pageData?.results ?? []
  const total = pageData?.count ?? 0
  const pageSize = 24
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  function changeFilter(next: StatusFilter) {
    setFilter(next)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      {/* Status count bar */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">Pending {counts.PENDING ?? 0}</span>
        <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 font-medium text-blue-700">Sent {counts.SENT ?? 0}</span>
        <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1 font-medium text-green-700">Received {counts.RECEIVED ?? 0}</span>
      </div>

      {/* Per-trader rollup */}
      {rollup.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Per-trader progress</h3>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {rollup.map((t) => {
              const behind = t.out_sent < t.out_total || t.in_received < t.in_total
              return (
                <div key={t.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-28 truncate font-medium text-gray-800">{t.username}</span>
                  <span className="text-xs text-gray-500">sending {t.out_sent}/{t.out_total}</span>
                  <span className="text-xs text-gray-500">receiving {t.in_received}/{t.in_total}</span>
                  {behind && <span className="ml-auto text-xs font-medium text-amber-600" title="Behind">⚠ behind</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filterable, paginated table */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">All shipments</h3>
          <select
            value={filter}
            onChange={(e) => changeFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="RECEIVED">Received</option>
          </select>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No shipments.</p>
        ) : (
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
              </div>
            ))}
          </div>
        )}

        {/* Pagination controls */}
        {total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>Page {page} of {lastPage}</span>
            <button
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage}
              className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit (Tasks 12 + 13 together)**

```bash
git add frontend/src/api/shipping.ts frontend/src/features/matching/ShippingOverviewTab.tsx
git commit -m "feat(matching): paginate shipping overview UI + server-side summary"
```

---

### Task 14: `api/payments.ts`

**Files:**
- Create: `frontend/src/api/payments.ts`

- [ ] **Step 1: Create the module**

Create `frontend/src/api/payments.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export interface SettlementPayment {
  id: number
  status: 'PENDING' | 'PAID' | 'CONFIRMED'
  amount: string
  note: string
  from_username: string
  to_username: string
  my_role: 'payer' | 'payee' | null
  paid_at: string | null
  confirmed_at: string | null
}

export interface PaymentsSummary {
  counts: Partial<Record<SettlementPayment['status'], number>>
  users: {
    username: string
    owe_total: number
    owe_paid: number
    due_total: number
    due_confirmed: number
  }[]
}

const PAYMENTS_KEYS = {
  list: (slug: string) => ['payments', slug] as const,
}

async function fetchMyPayments(slug: string): Promise<SettlementPayment[]> {
  const { data } = await apiClient.get<SettlementPayment[]>(`/events/${slug}/payments/`)
  return data
}

async function fetchPaymentsOverview(
  slug: string, page: number, status: string,
): Promise<PaginatedResponse<SettlementPayment>> {
  const { data } = await apiClient.get<PaginatedResponse<SettlementPayment>>(
    `/events/${slug}/payments/overview/`,
    { params: { page, status: status || undefined } },
  )
  return data
}

async function fetchPaymentsSummary(slug: string): Promise<PaymentsSummary> {
  const { data } = await apiClient.get<PaymentsSummary>(
    `/events/${slug}/payments/overview/summary/`,
  )
  return data
}

async function updatePayment(
  slug: string, id: number, body: { status: 'PAID' | 'CONFIRMED'; note?: string },
): Promise<SettlementPayment> {
  const { data } = await apiClient.patch<SettlementPayment>(
    `/events/${slug}/payments/${id}/`, body,
  )
  return data
}

export function useMyPayments(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: PAYMENTS_KEYS.list(slug ?? ''),
    queryFn: () => fetchMyPayments(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function usePaymentsOverview(
  slug: string | undefined, page: number, status: string, enabled: boolean,
) {
  return useQuery({
    queryKey: ['payments', 'overview', slug ?? '', page, status],
    queryFn: () => fetchPaymentsOverview(slug!, page, status),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function usePaymentsSummary(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['payments', 'summary', slug ?? ''],
    queryFn: () => fetchPaymentsSummary(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function useUpdatePayment(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status: 'PAID' | 'CONFIRMED'; note?: string } }) =>
      updatePayment(slug, id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYMENTS_KEYS.list(slug) })
    },
  })
}
```

- [ ] **Step 2: Verify build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/payments.ts
git commit -m "feat(matching): payments API client (mine, overview, summary, update)"
```

---

### Task 15: Combined "Shipping & Payments" participant tab + drop My Trades settlement list

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: Add imports**

In `MatchRunPage.tsx`, after the shipping import (line 16-18) add:

```tsx
import { useMyPayments, useUpdatePayment } from '../../api/payments'
import type { SettlementPayment } from '../../api/payments'
```

- [ ] **Step 2: Add payment card components + a PaymentsSections block**

Add near the shipping card components (after `ShipmentReceiverCard`, ~line 957):

```tsx
// ---- Payment cards ----

const PAYMENT_STATUS_PILL: Record<SettlementPayment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-violet-50 text-violet-700 border-violet-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function PaymentStatusBadge({ status }: { status: SettlementPayment['status'] }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_PILL[status]}`}>
      {status}
    </span>
  )
}

function PaymentPayerCard({
  payment: p, readOnly, onUpdate,
}: {
  payment: SettlementPayment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdatePayment>
}) {
  const [note, setNote] = useState(p.note)
  const [error, setError] = useState<string | null>(null)

  async function handleMarkPaid() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: p.id, body: { status: 'PAID', note } })
    } catch (err) {
      setError(extractErrorMsg(err))
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-900">
          Pay{' '}
          <Link to={`/u/${p.to_username}`} className="font-semibold text-indigo-500 hover:underline">
            {p.to_username}
          </Link>{' '}
          <span className="font-semibold">${p.amount}</span>
        </p>
        <PaymentStatusBadge status={p.status} />
      </div>

      {!readOnly && p.status === 'PENDING' && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Payment reference or notes…"
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleMarkPaid}
            disabled={onUpdate.isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            {onUpdate.isPending ? 'Saving…' : 'Mark paid'}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {p.status !== 'PENDING' && p.note && (
        <p className="text-xs text-gray-500"><span className="font-medium">Reference:</span> {p.note}</p>
      )}
    </div>
  )
}

function PaymentPayeeCard({
  payment: p, readOnly, onUpdate,
}: {
  payment: SettlementPayment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdatePayment>
}) {
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: p.id, body: { status: 'CONFIRMED' } })
    } catch (err) {
      setError(extractErrorMsg(err))
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-900">
          Receive <span className="font-semibold">${p.amount}</span> from{' '}
          <Link to={`/u/${p.from_username}`} className="font-semibold text-indigo-500 hover:underline">
            {p.from_username}
          </Link>
        </p>
        <PaymentStatusBadge status={p.status} />
      </div>

      {p.note && (
        <p className="text-xs text-gray-500"><span className="font-medium">Reference:</span> {p.note}</p>
      )}

      {!readOnly && p.status === 'PAID' && (
        <div className="pt-1">
          <button
            onClick={handleConfirm}
            disabled={onUpdate.isPending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors"
          >
            {onUpdate.isPending ? 'Saving…' : 'Confirm received'}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

function PaymentsSections({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const { data: payments = [], isLoading } = useMyPayments(slug, true)
  const update = useUpdatePayment(slug)
  const paying = payments.filter((p) => p.my_role === 'payer')
  const receiving = payments.filter((p) => p.my_role === 'payee')

  if (isLoading) return <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
  if (payments.length === 0) return null

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
          Payments to send ({paying.length})
        </p>
        {paying.length === 0
          ? <p className="text-sm text-gray-400">Nothing to pay.</p>
          : paying.map((p) => <PaymentPayerCard key={p.id} payment={p} readOnly={readOnly} onUpdate={update} />)}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
          Payments to receive ({receiving.length})
        </p>
        {receiving.length === 0
          ? <p className="text-sm text-gray-400">Nothing to receive.</p>
          : receiving.map((p) => <PaymentPayeeCard key={p.id} payment={p} readOnly={readOnly} onUpdate={update} />)}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Add a combined tab component**

Add (after `ShippingTab`, ~line 827):

```tsx
function ShippingPaymentsTab({
  slug, readOnly, moneyEnabled,
}: {
  slug: string
  readOnly: boolean
  moneyEnabled: boolean
}) {
  return (
    <div className="space-y-8">
      <ShippingTab slug={slug} readOnly={readOnly} />
      {moneyEnabled && <PaymentsSections slug={slug} readOnly={readOnly} />}
    </div>
  )
}
```

- [ ] **Step 4: Swap the participant tab in `RunResultView`**

In `RunResultView`, change the `activeTab` union and tab list. Replace the `useState` (~line 969) and `tabs` array (~lines 975-981):

```tsx
  const showShipping = eventStatus === 'SHIPPING' || eventStatus === 'ARCHIVED'
  const [activeTab, setActiveTab] = useState<'my-trades' | 'cycles' | 'stats' | 'shipping-payments' | 'overview'>('my-trades')

  if (!isDone) {
    return <LiveRunView slug={slug} runId={run.id} />
  }

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'my-trades', label: 'My Trades' },
    { id: 'cycles', label: 'All Cycles' },
    { id: 'stats', label: 'Stats & Unmatched' },
    ...(showShipping ? [{ id: 'shipping-payments' as const, label: 'Shipping & Payments' }] : []),
    ...(showShipping && isOrganizer ? [{ id: 'overview' as const, label: 'Overview' }] : []),
  ]
```

Replace the tab-content branches for `shipping` and `shipping-overview` (~lines 1059-1063):

```tsx
        {activeTab === 'shipping-payments' && (
          <ShippingPaymentsTab
            slug={slug}
            readOnly={eventStatus === 'ARCHIVED'}
            moneyEnabled={moneyEnabled}
          />
        )}

        {activeTab === 'overview' && (
          <OverviewTab slug={slug} moneyEnabled={moneyEnabled} />
        )}
```

`RunResultView` needs a `moneyEnabled` prop. Update its signature:

```tsx
function RunResultView({ slug, run, eventStatus, isOrganizer, moneyEnabled }: { slug: string; run: MatchRunDetail; eventStatus: EventStatus; isOrganizer: boolean; moneyEnabled: boolean }) {
```

And its call site (~line 1218):

```tsx
          ) : activeRun ? (
            <RunResultView slug={slug!} run={activeRun} eventStatus={event.status} isOrganizer={!!event.is_organizer} moneyEnabled={!!event.money_enabled} />
```

(`OverviewTab` is defined in Task 16. Build will fail until then — see Task 16 commit.)

- [ ] **Step 5: Drop the read-only settlement list from My Trades**

In `MyTradesSection`, remove the "Settlement — what to actually do" block — delete the JSX from the `{/* Settlement — what to actually do */}` comment through its closing `)}` (~lines 464-491), keeping the buys/sells and the net-balance block. Then remove the now-unused `settlement`/`myTransfers` plumbing:
- Delete `settlement` from the `MyTradesSection` props type and destructuring (~lines 314-322).
- Delete the `const myTransfers = settlement.filter(...)` line (~lines 412-414).
- In the guard `if (bought.length === 0 && sold.length === 0 && myTransfers.length === 0) return null`, drop the `&& myTransfers.length === 0` term.
- At the `MyTradesSection` call site (~line 1015-1019), remove the `settlement={result?.settlement ?? []}` prop.

(The `SettlementTransfer` import on line 15 becomes unused — remove it from the import to satisfy lint.)

- [ ] **Step 6: Verify build + lint (expected partial)**

Run: `cd frontend && npm run build`
Expected: FAIL only on missing `OverviewTab` (defined next task). Confirm no other errors.

- [ ] **Step 7: Defer commit to Task 16** (build must be green before committing).

---

### Task 16: Combined organizer "Overview" tab (shipping + payments)

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`
- Create: `frontend/src/features/matching/PaymentsOverviewTab.tsx`

- [ ] **Step 1: Create `PaymentsOverviewTab`**

Create `frontend/src/features/matching/PaymentsOverviewTab.tsx`:

```tsx
import { useState } from 'react'
import { usePaymentsOverview, usePaymentsSummary } from '../../api/payments'
import type { SettlementPayment } from '../../api/payments'

type StatusFilter = '' | 'PENDING' | 'PAID' | 'CONFIRMED'

const STATUS_PILL: Record<SettlementPayment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-violet-50 text-violet-700 border-violet-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export function PaymentsOverviewTab({ slug }: { slug: string }) {
  const [filter, setFilter] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const { data: summary } = usePaymentsSummary(slug, true)
  const { data: pageData, isLoading } = usePaymentsOverview(slug, page, filter, true)

  const counts = summary?.counts ?? {}
  const rollup = summary?.users ?? []
  const rows = pageData?.results ?? []
  const total = pageData?.count ?? 0
  const pageSize = 24
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  function changeFilter(next: StatusFilter) {
    setFilter(next)
    setPage(1)
  }

  if (!isLoading && total === 0 && rollup.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No settlement payments.</p>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">Pending {counts.PENDING ?? 0}</span>
        <span className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1 font-medium text-violet-700">Paid {counts.PAID ?? 0}</span>
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">Confirmed {counts.CONFIRMED ?? 0}</span>
      </div>

      {rollup.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Per-user settlement</h3>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {rollup.map((u) => {
              const behind = u.owe_paid < u.owe_total || u.due_confirmed < u.due_total
              return (
                <div key={u.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-28 truncate font-medium text-gray-800">{u.username}</span>
                  <span className="text-xs text-gray-500">paying {u.owe_paid}/{u.owe_total}</span>
                  <span className="text-xs text-gray-500">receiving {u.due_confirmed}/{u.due_total}</span>
                  {behind && <span className="ml-auto text-xs font-medium text-amber-600" title="Behind">⚠ behind</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">All payments</h3>
          <select
            value={filter}
            onChange={(e) => changeFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
            <option value="CONFIRMED">Confirmed</option>
          </select>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No payments.</p>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-800">
                    {p.from_username} → {p.to_username}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-700">${p.amount}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${STATUS_PILL[p.status]}`}>
                  {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}

        {total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1}
              className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40">← Prev</button>
            <span>Page {page} of {lastPage}</span>
            <button onClick={() => setPage((x) => Math.min(lastPage, x + 1))} disabled={page >= lastPage}
              className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the `OverviewTab` wrapper in MatchRunPage**

Add the import near the `ShippingOverviewTab` import (line 17):

```tsx
import { PaymentsOverviewTab } from './PaymentsOverviewTab'
```

Add the wrapper component (after `ShippingPaymentsTab` from Task 15):

```tsx
function OverviewTab({ slug, moneyEnabled }: { slug: string; moneyEnabled: boolean }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Shipping</h2>
        <ShippingOverviewTab slug={slug} />
      </div>
      {moneyEnabled && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Settlement payments</h2>
          <PaymentsOverviewTab slug={slug} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit (Tasks 15 + 16)**

```bash
git add frontend/src/features/matching/MatchRunPage.tsx frontend/src/features/matching/PaymentsOverviewTab.tsx
git commit -m "feat(matching): consolidate shipping + settlement payments into one stage view"
```

---

## Final verification

- [ ] **Backend full suite**

Run: `cd backend && ./venv/bin/python manage.py test events matching -v 1`
Expected: PASS (all green, including pre-existing tests).

- [ ] **Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS

- [ ] **Manual smoke (optional, via the running app)**
  - Join an event, try to join a second → blocked.
  - In a pre-matching event, Leave → copies/wants/wishes gone.
  - Advance an event to MATCHING → Leave button hidden.
  - Open a trader profile from a deep link → "← Back" returns to the prior page.
  - As organizer of a money event in SHIPPING → Overview tab shows paginated shipping + payments; as participant, Shipping & Payments tab lets you mark sent/paid and confirm.

---

## Notes / known follow-ups (not in scope)

- `ensure_payments` derives from the latest DONE run only, matching shipping. Re-running the matcher produces a new run with its own payment rows.
- Pre-matching, the My Trades net-balance line still conveys who owes whom; the actionable per-transfer cards appear once the event is in SHIPPING (combined tab).
