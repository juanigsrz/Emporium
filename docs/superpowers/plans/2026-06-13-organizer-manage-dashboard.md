# Organizer Manage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an event organizer an in-app dashboard to inspect/edit any participant's submissions (toggle wishes, edit X/Y bounds, unlist copies) and kick a user with a safe cascade, so they can fix problems and re-run the solver.

**Architecture:** A pure-Python kick service (`events/admin_actions.py`) does the transactional cascade; thin organizer-only `@action` endpoints on the existing `TradeEventViewSet` expose inspect/edit/kick under `/api/events/{slug}/admin/…`. The frontend adds an organizer-only `/events/:slug/manage` page that calls those endpoints. No schema changes — the cross-user cascade rides existing `on_delete=CASCADE` FKs.

**Tech Stack:** Django + DRF (backend, `manage.py test` / `APITestCase`); React + Vite + TypeScript + TanStack Query + Tailwind (frontend, verified by `tsc` + `eslint` — repo has no JS test runner).

**Spec:** `docs/superpowers/specs/2026-06-13-organizer-manage-dashboard-design.md`

**Run commands** (from repo root):
- Backend tests: `cd backend && ./venv/bin/python manage.py test events -v 1`
- Frontend check: `cd frontend && npx tsc -b && npx eslint src --ext ts,tsx --max-warnings 0`

---

## File Structure

**Backend (create):**
- `backend/events/admin_actions.py` — `kick_participant(event, user) -> dict`. The transactional cascade + impact summary.
- `backend/events/test_admin_dashboard.py` — all backend tests for this feature.

**Backend (modify):**
- `backend/events/views.py` — add `_check_admin`, `_resolve_target_user`, and six `@action` methods on `TradeEventViewSet`.

**Frontend (create):**
- `frontend/src/api/eventAdmin.ts` — types, API functions, TanStack hooks.
- `frontend/src/features/events/ManageEventPage.tsx` — the dashboard page.

**Frontend (modify):**
- `frontend/src/routes/index.tsx` — add the `/events/:slug/manage` route.
- `frontend/src/features/events/EventDetailPage.tsx` — add a "Manage" button in the organizer header controls.

---

## Task 1: Kick service + cascade behavior

**Files:**
- Create: `backend/events/admin_actions.py`
- Test: `backend/events/test_admin_dashboard.py`

- [ ] **Step 1: Write the failing test**

Create `backend/events/test_admin_dashboard.py`:

```python
"""
events/test_admin_dashboard.py

Organizer manage-dashboard tests: kick cascade + admin endpoints.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from events.admin_actions import kick_participant
from events.tests import import_boardgames_csv, _make_csv, SAMPLE_ROWS
from trades.models import (
    OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, WantBid,
)

User = get_user_model()


class AdminDashboardBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        import os
        csv_path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=csv_path)
        os.unlink(csv_path)

        cls.organizer = User.objects.create_user("org", password="pass1234", email="o@x.com")
        cls.victim = User.objects.create_user("victim", password="pass1234", email="v@x.com")
        cls.other = User.objects.create_user("other", password="pass1234", email="t@x.com")
        cls.game1 = BoardGame.objects.get(bgg_id=224517)
        cls.game2 = BoardGame.objects.get(bgg_id=342942)

    def setUp(self):
        # Fresh event per test so deletes don't leak across tests.
        self.event = TradeEvent.objects.create(
            name="Manage Test", slug="manage-test", organizer=self.organizer,
            status=TradeEvent.Status.MATCH_REVIEW,
        )
        # victim lists copy of game1; other lists copy of game2.
        EventParticipation.objects.create(event=self.event, user=self.victim)
        EventParticipation.objects.create(event=self.event, user=self.other)
        self.victim_copy = Copy.objects.create(owner=self.victim, board_game=self.game1)
        self.other_copy = Copy.objects.create(owner=self.other, board_game=self.game2)
        self.victim_listing = EventListing.objects.create(event=self.event, copy=self.victim_copy)
        self.other_listing = EventListing.objects.create(event=self.event, copy=self.other_copy)

        # victim has an offer+want+wish trio.
        self.v_offer = OfferGroup.objects.create(event=self.event, user=self.victim, name="vo")
        OfferGroupItem.objects.create(offer_group=self.v_offer, event_listing=self.victim_listing)
        self.v_want = WantGroup.objects.create(event=self.event, user=self.victim, name="vw")
        WantGroupItem.objects.create(want_group=self.v_want,
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game2)
        TradeWish.objects.create(event=self.event, user=self.victim,
            offer_group=self.v_offer, want_group=self.v_want)

        # other wants victim's SPECIFIC listing (LISTING target) + a bid on it.
        self.o_want = WantGroup.objects.create(event=self.event, user=self.other, name="ow")
        self.o_listing_item = WantGroupItem.objects.create(want_group=self.o_want,
            target_type=WantGroupItem.TargetType.LISTING, event_listing=self.victim_listing)
        # other also wants game2 by BOARD_GAME (must survive the kick).
        self.o_game_item = WantGroupItem.objects.create(want_group=self.o_want,
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game2)
        self.o_bid = WantBid.objects.create(user=self.other, event=self.event,
            target_type=WantBid.TargetType.LISTING, event_listing=self.victim_listing, amount=5)


class KickServiceTests(AdminDashboardBase):
    def test_kick_removes_victim_event_data_keeps_copy(self):
        summary = kick_participant(self.event, self.victim)
        # victim's event-scoped rows gone
        self.assertFalse(EventParticipation.objects.filter(event=self.event, user=self.victim).exists())
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        self.assertFalse(OfferGroup.objects.filter(user=self.victim, event=self.event).exists())
        self.assertFalse(WantGroup.objects.filter(user=self.victim, event=self.event).exists())
        self.assertFalse(TradeWish.objects.filter(user=self.victim, event=self.event).exists())
        # Copy preserved
        self.assertTrue(Copy.objects.filter(pk=self.victim_copy.pk).exists())
        # summary
        self.assertEqual(summary["removed_listings"], 1)
        self.assertEqual(summary["removed_wishes"], 1)
        self.assertEqual(summary["affected_other_users"], 1)

    def test_kick_cascades_other_users_listing_refs_only(self):
        kick_participant(self.event, self.victim)
        # other's LISTING-type want + listing bid (pointed at victim's listing) gone
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())
        self.assertFalse(WantBid.objects.filter(pk=self.o_bid.pk).exists())
        # other's BOARD_GAME want survives, and other's own want group + listing remain
        self.assertTrue(WantGroupItem.objects.filter(pk=self.o_game_item.pk).exists())
        self.assertTrue(WantGroup.objects.filter(pk=self.o_want.pk).exists())
        self.assertTrue(EventListing.objects.filter(pk=self.other_listing.pk).exists())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.KickServiceTests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'events.admin_actions'` (or ImportError).

- [ ] **Step 3: Write the kick service**

Create `backend/events/admin_actions.py`:

```python
"""
events/admin_actions.py

Organizer admin operations that mutate other users' event data.

kick_participant() removes ALL of a user's event-scoped rows from an event while
keeping their Copy inventory. Deleting the user's EventListings relies on the
existing on_delete=CASCADE FKs to clean up OTHER users' references to those
specific listings (WantGroupItem[LISTING], WantBid[LISTING], OfferGroupItem,
plus any stale TradeAssignment/Shipment). BOARD_GAME-type wants are untouched.
"""

from django.db import transaction

from trades.models import (
    OfferGroup, WantGroup, WantGroupItem, TradeWish, WantBid, UserGamePrice,
)
from .models import EventListing, EventParticipation


@transaction.atomic
def kick_participant(event, user):
    """Remove `user` from `event`. Returns an impact summary dict."""
    listings = EventListing.objects.filter(event=event, copy__owner=user)
    listing_ids = list(listings.values_list("id", flat=True))

    # Count distinct OTHER users whose specific-listing refs the cascade removes.
    affected = set(
        WantBid.objects.filter(event=event, event_listing_id__in=listing_ids)
        .exclude(user=user).values_list("user_id", flat=True)
    )
    affected.update(
        WantGroupItem.objects.filter(event_listing_id__in=listing_ids)
        .exclude(want_group__user=user).values_list("want_group__user_id", flat=True)
    )

    summary = {
        "username": user.username,
        "removed_listings": len(listing_ids),
        "removed_wishes": TradeWish.objects.filter(event=event, user=user).count(),
        "removed_groups": (
            OfferGroup.objects.filter(event=event, user=user).count()
            + WantGroup.objects.filter(event=event, user=user).count()
        ),
        "affected_other_users": len(affected),
    }

    # Delete the victim's event-scoped rows. Deleting the groups cascades to their
    # own wishes/items; deleting the listings cascades to other users' refs.
    TradeWish.objects.filter(event=event, user=user).delete()
    OfferGroup.objects.filter(event=event, user=user).delete()
    WantGroup.objects.filter(event=event, user=user).delete()
    WantBid.objects.filter(event=event, user=user).delete()
    UserGamePrice.objects.filter(event=event, user=user).delete()
    listings.delete()
    EventParticipation.objects.filter(event=event, user=user).delete()

    return summary
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.KickServiceTests -v 2`
Expected: PASS (2 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/events/admin_actions.py backend/events/test_admin_dashboard.py
git commit -m "feat(events): kick_participant cascade service for organizer dashboard"
```

---

## Task 2: Admin guards + submissions endpoint

**Files:**
- Modify: `backend/events/views.py` (imports + `TradeEventViewSet`)
- Test: `backend/events/test_admin_dashboard.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/events/test_admin_dashboard.py`:

```python
class AdminSubmissionsTests(AdminDashboardBase):
    URL = "/api/events/manage-test/admin/submissions/"

    def test_non_organizer_gets_403(self):
        self.client.force_authenticate(self.other)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 403)

    def test_organizer_sees_victim_listings_and_wishes(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["username"], "victim")
        self.assertEqual(len(r.data["listings"]), 1)
        self.assertEqual(len(r.data["wishes"]), 1)
        self.assertEqual(r.data["offer_groups"][0]["max_give"], 1)
        self.assertEqual(r.data["want_groups"][0]["min_receive"], 1)

    def test_archived_event_blocks_admin(self):
        self.event.status = TradeEvent.Status.ARCHIVED
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.organizer)
        r = self.client.get(self.URL, {"user": "victim"})
        self.assertEqual(r.status_code, 403)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.AdminSubmissionsTests -v 2`
Expected: FAIL — 404 (route does not exist yet) on the 200 test.

- [ ] **Step 3: Add imports + helpers + the submissions action**

In `backend/events/views.py`, extend the trades import and add the kick import near the top imports (after the existing `from .serializers import (...)` block):

```python
from trades.models import OfferGroup, WantGroup, TradeWish
from .admin_actions import kick_participant
```

Add these two helpers to `TradeEventViewSet`, right after the existing `_check_organizer` method:

```python
    def _check_admin(self, event):
        """Organizer-only admin guard; disabled once the event is archived."""
        self._check_organizer(event)
        if event.status == TradeEvent.Status.ARCHIVED:
            raise PermissionDenied("Event is archived; admin actions are disabled.")

    def _resolve_target_user(self, username):
        from django.contrib.auth import get_user_model
        if not username:
            raise ValidationError({"username": "This field is required."})
        return get_object_or_404(get_user_model(), username=username)
```

Add the submissions action to `TradeEventViewSet` (place it after the `games` action):

```python
    # ------------------------------------------------------------------
    # Organizer admin dashboard
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="admin/submissions")
    def admin_submissions(self, request, slug=None):
        event = self.get_object()
        self._check_admin(event)
        user = self._resolve_target_user(request.query_params.get("user"))

        listings = event.listings.select_related(
            "copy", "copy__owner", "copy__board_game"
        ).filter(copy__owner=user)
        offer_groups = OfferGroup.objects.filter(event=event, user=user)
        want_groups = WantGroup.objects.filter(event=event, user=user)
        wishes = TradeWish.objects.filter(event=event, user=user).select_related(
            "offer_group", "want_group"
        )

        return Response({
            "username": user.username,
            "listings": EventListingSerializer(
                listings, many=True, context={"request": request}
            ).data,
            "offer_groups": [
                {"id": g.id, "name": g.name, "max_give": g.max_give} for g in offer_groups
            ],
            "want_groups": [
                {"id": g.id, "name": g.name, "min_receive": g.min_receive}
                for g in want_groups
            ],
            "wishes": [
                {
                    "id": w.id, "active": w.active,
                    "offer_group": w.offer_group_id, "offer_group_name": w.offer_group.name,
                    "want_group": w.want_group_id, "want_group_name": w.want_group.name,
                }
                for w in wishes
            ],
        })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.AdminSubmissionsTests -v 2`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/events/views.py backend/events/test_admin_dashboard.py
git commit -m "feat(events): organizer admin submissions endpoint + guards"
```

---

## Task 3: Admin edit endpoints (wish toggle, X/Y bounds, unlist)

**Files:**
- Modify: `backend/events/views.py` (`TradeEventViewSet`)
- Test: `backend/events/test_admin_dashboard.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/events/test_admin_dashboard.py`:

```python
class AdminEditTests(AdminDashboardBase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.organizer)
        self.wish = TradeWish.objects.get(event=self.event, user=self.victim)

    def test_toggle_wish_active(self):
        url = f"/api/events/manage-test/admin/wishes/{self.wish.id}/"
        r = self.client.patch(url, {"active": False}, format="json")
        self.assertEqual(r.status_code, 200)
        self.wish.refresh_from_db()
        self.assertFalse(self.wish.active)

    def test_edit_offer_max_give(self):
        url = f"/api/events/manage-test/admin/offer-groups/{self.v_offer.id}/"
        r = self.client.patch(url, {"max_give": 3}, format="json")
        self.assertEqual(r.status_code, 200)
        self.v_offer.refresh_from_db()
        self.assertEqual(self.v_offer.max_give, 3)

    def test_edit_offer_max_give_rejects_zero(self):
        url = f"/api/events/manage-test/admin/offer-groups/{self.v_offer.id}/"
        r = self.client.patch(url, {"max_give": 0}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_edit_want_min_receive(self):
        url = f"/api/events/manage-test/admin/want-groups/{self.v_want.id}/"
        r = self.client.patch(url, {"min_receive": 2}, format="json")
        self.assertEqual(r.status_code, 200)
        self.v_want.refresh_from_db()
        self.assertEqual(self.v_want.min_receive, 2)

    def test_unlist_listing_cascades(self):
        url = f"/api/events/manage-test/admin/listings/{self.victim_listing.id}/"
        r = self.client.delete(url)
        self.assertEqual(r.status_code, 204)
        self.assertFalse(EventListing.objects.filter(pk=self.victim_listing.pk).exists())
        # other's LISTING want at that listing is cascade-removed
        self.assertFalse(WantGroupItem.objects.filter(pk=self.o_listing_item.pk).exists())

    def test_non_organizer_cannot_edit(self):
        self.client.force_authenticate(self.other)
        url = f"/api/events/manage-test/admin/wishes/{self.wish.id}/"
        r = self.client.patch(url, {"active": False}, format="json")
        self.assertEqual(r.status_code, 403)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.AdminEditTests -v 2`
Expected: FAIL — 404 (routes do not exist yet).

- [ ] **Step 3: Add the edit actions**

Add a positive-int parser helper to `TradeEventViewSet` (next to `_resolve_target_user`):

```python
    @staticmethod
    def _positive_int(value, field):
        try:
            n = int(value)
        except (TypeError, ValueError):
            raise ValidationError({field: "Must be an integer."})
        if n < 1:
            raise ValidationError({field: "Must be at least 1."})
        return n
```

Add the four actions after `admin_submissions`:

```python
    @action(detail=True, methods=["patch"], url_path=r"admin/wishes/(?P<wish_id>[^/.]+)")
    def admin_wish(self, request, slug=None, wish_id=None):
        event = self.get_object()
        self._check_admin(event)
        wish = get_object_or_404(TradeWish, pk=wish_id, event=event)
        wish.active = bool(request.data.get("active", wish.active))
        wish.save(update_fields=["active", "updated"])
        return Response({"id": wish.id, "active": wish.active})

    @action(detail=True, methods=["patch"], url_path=r"admin/offer-groups/(?P<group_id>[^/.]+)")
    def admin_offer_group(self, request, slug=None, group_id=None):
        event = self.get_object()
        self._check_admin(event)
        group = get_object_or_404(OfferGroup, pk=group_id, event=event)
        group.max_give = self._positive_int(request.data.get("max_give"), "max_give")
        group.save(update_fields=["max_give", "updated"])
        return Response({"id": group.id, "max_give": group.max_give})

    @action(detail=True, methods=["patch"], url_path=r"admin/want-groups/(?P<group_id>[^/.]+)")
    def admin_want_group(self, request, slug=None, group_id=None):
        event = self.get_object()
        self._check_admin(event)
        group = get_object_or_404(WantGroup, pk=group_id, event=event)
        group.min_receive = self._positive_int(request.data.get("min_receive"), "min_receive")
        group.save(update_fields=["min_receive", "updated"])
        return Response({"id": group.id, "min_receive": group.min_receive})

    @action(detail=True, methods=["delete"], url_path=r"admin/listings/(?P<listing_id>[^/.]+)")
    def admin_listing(self, request, slug=None, listing_id=None):
        event = self.get_object()
        self._check_admin(event)
        listing = get_object_or_404(EventListing, pk=listing_id, event=event)
        listing.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.AdminEditTests -v 2`
Expected: PASS (6 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/events/views.py backend/events/test_admin_dashboard.py
git commit -m "feat(events): organizer admin wish/bounds/unlist endpoints"
```

---

## Task 4: Admin kick endpoint

**Files:**
- Modify: `backend/events/views.py` (`TradeEventViewSet`)
- Test: `backend/events/test_admin_dashboard.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/events/test_admin_dashboard.py`:

```python
class AdminKickEndpointTests(AdminDashboardBase):
    URL = "/api/events/manage-test/admin/kick/"

    def test_organizer_kicks_user(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.post(self.URL, {"username": "victim"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["removed_listings"], 1)
        self.assertFalse(
            EventParticipation.objects.filter(event=self.event, user=self.victim).exists()
        )

    def test_cannot_kick_self(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.post(self.URL, {"username": "org"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_non_organizer_cannot_kick(self):
        self.client.force_authenticate(self.other)
        r = self.client.post(self.URL, {"username": "victim"}, format="json")
        self.assertEqual(r.status_code, 403)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard.AdminKickEndpointTests -v 2`
Expected: FAIL — 404 (route does not exist yet).

- [ ] **Step 3: Add the kick action**

Add after `admin_listing`:

```python
    @action(detail=True, methods=["post"], url_path="admin/kick")
    def admin_kick(self, request, slug=None):
        event = self.get_object()
        self._check_admin(event)
        user = self._resolve_target_user(request.data.get("username"))
        if user == request.user:
            raise ValidationError({"username": "You can't kick yourself."})
        summary = kick_participant(event, user)
        return Response(summary)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./venv/bin/python manage.py test events.test_admin_dashboard -v 1`
Expected: PASS (all classes in the file OK).

- [ ] **Step 5: Run the full events suite (no regressions)**

Run: `cd backend && ./venv/bin/python manage.py test events -v 1`
Expected: PASS (existing events tests + new ones).

- [ ] **Step 6: Commit**

```bash
git add backend/events/views.py backend/events/test_admin_dashboard.py
git commit -m "feat(events): organizer admin kick endpoint"
```

---

## Task 5: Frontend admin API client

**Files:**
- Create: `frontend/src/api/eventAdmin.ts`

- [ ] **Step 1: Write the API client**

Create `frontend/src/api/eventAdmin.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { EventListing } from './events'

export interface AdminGroup { id: number; name: string; max_give?: number; min_receive?: number }
export interface AdminWish {
  id: number
  active: boolean
  offer_group: number
  offer_group_name: string
  want_group: number
  want_group_name: string
}
export interface AdminSubmissions {
  username: string
  listings: EventListing[]
  offer_groups: AdminGroup[]
  want_groups: AdminGroup[]
  wishes: AdminWish[]
}
export interface KickSummary {
  username: string
  removed_listings: number
  removed_wishes: number
  removed_groups: number
  affected_other_users: number
}

const base = (slug: string) => `/events/${slug}/admin`

export function useAdminSubmissions(slug: string, username: string | null) {
  return useQuery({
    queryKey: ['admin', 'submissions', slug, username],
    queryFn: async () =>
      (await apiClient.get<AdminSubmissions>(`${base(slug)}/submissions/`, {
        params: { user: username },
      })).data,
    enabled: !!slug && !!username,
  })
}

function useInvalidateSubmissions(slug: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin', 'submissions', slug] })
}

export function useToggleWish(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) =>
      (await apiClient.patch(`${base(slug)}/wishes/${id}/`, { active })).data,
    onSuccess: invalidate,
  })
}

export function useEditOfferBound(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, max_give }: { id: number; max_give: number }) =>
      (await apiClient.patch(`${base(slug)}/offer-groups/${id}/`, { max_give })).data,
    onSuccess: invalidate,
  })
}

export function useEditWantBound(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, min_receive }: { id: number; min_receive: number }) =>
      (await apiClient.patch(`${base(slug)}/want-groups/${id}/`, { min_receive })).data,
    onSuccess: invalidate,
  })
}

export function useUnlistCopy(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async (listingId: number) => {
      await apiClient.delete(`${base(slug)}/listings/${listingId}/`)
    },
    onSuccess: invalidate,
  })
}

export function useKickUser(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (username: string) =>
      (await apiClient.post<KickSummary>(`${base(slug)}/kick/`, { username })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'submissions', slug] }),
  })
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc -b`
Expected: exit 0 (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/eventAdmin.ts
git commit -m "feat(events): frontend admin API client + hooks"
```

---

## Task 6: Manage page + route + entry button

**Files:**
- Create: `frontend/src/features/events/ManageEventPage.tsx`
- Modify: `frontend/src/routes/index.tsx`
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

- [ ] **Step 1: Write the Manage page**

Create `frontend/src/features/events/ManageEventPage.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEvent, useEventParticipants } from '../../api/events'
import {
  useAdminSubmissions, useToggleWish, useEditOfferBound, useEditWantBound,
  useUnlistCopy, useKickUser,
} from '../../api/eventAdmin'
import type { KickSummary } from '../../api/eventAdmin'

export default function ManageEventPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: event, isLoading } = useEvent(slug)
  const { data: participants } = useEventParticipants(slug)
  const [selected, setSelected] = useState<string | null>(null)
  const [kickResult, setKickResult] = useState<KickSummary | null>(null)
  const [confirmKick, setConfirmKick] = useState(false)

  const subs = useAdminSubmissions(slug, selected)
  const toggleWish = useToggleWish(slug)
  const editOffer = useEditOfferBound(slug)
  const editWant = useEditWantBound(slug)
  const unlist = useUnlistCopy(slug)
  const kick = useKickUser(slug)

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading…</p>
  if (!event) return <p className="p-6 text-sm text-gray-400">Event not found.</p>
  if (!event.is_organizer) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-red-600">Only the organizer can manage this event.</p>
        <Link to={`/events/${slug}`} className="text-sm text-indigo-600 hover:underline">← Back</Link>
      </div>
    )
  }

  async function doKick() {
    if (!selected) return
    const res = await kick.mutateAsync(selected)
    setKickResult(res)
    setConfirmKick(false)
    setSelected(null)
  }

  const rows = participants?.results ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link to={`/events/${slug}`} className="text-xs text-gray-400 hover:text-indigo-600">← {event.name}</Link>
      <h1 className="text-xl font-bold text-gray-900">Manage event</h1>

      {kickResult && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Removed <strong>{kickResult.username}</strong>: {kickResult.removed_listings} listings,
          {' '}{kickResult.removed_wishes} wishes, {kickResult.removed_groups} groups.
          {' '}{kickResult.affected_other_users} other user(s) had references removed. Re-run the solver to refresh matches.
        </div>
      )}

      {/* Participant picker */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Participant</label>
        <select
          value={selected ?? ''}
          onChange={(e) => { setSelected(e.target.value || null); setKickResult(null) }}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a participant…</option>
          {rows.map((p) => (
            <option key={p.username} value={p.username}>{p.username}</option>
          ))}
        </select>
      </div>

      {selected && subs.data && (
        <div className="space-y-4">
          {/* Listings */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Listings</h2>
            {subs.data.listings.length === 0 ? (
              <p className="text-xs text-gray-400">No listings.</p>
            ) : subs.data.listings.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1.5 last:border-0">
                <span className="truncate text-sm text-gray-700">{l.board_game_name} <span className="font-mono text-xs text-gray-400">{l.listing_code}</span></span>
                <button
                  onClick={() => unlist.mutate(l.id)}
                  disabled={unlist.isPending}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Unlist
                </button>
              </div>
            ))}
          </section>

          {/* Offer groups (X) */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Offer groups — give up to X</h2>
            {subs.data.offer_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-gray-700">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.max_give}
                  onBlur={(e) => editOffer.mutate({ id: g.id, max_give: Number(e.target.value) })}
                  className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Want groups (Y) */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Want groups — receive at least Y</h2>
            {subs.data.want_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-gray-700">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.min_receive}
                  onBlur={(e) => editWant.mutate({ id: g.id, min_receive: Number(e.target.value) })}
                  className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Wishes */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Wishes</h2>
            {subs.data.wishes.map((w) => (
              <label key={w.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate text-gray-700">{w.offer_group_name} → {w.want_group_name}</span>
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  Active
                  <input
                    type="checkbox" checked={w.active}
                    onChange={(e) => toggleWish.mutate({ id: w.id, active: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  />
                </span>
              </label>
            ))}
          </section>

          {/* Kick */}
          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h2 className="mb-1 text-sm font-semibold text-red-700">Remove from event</h2>
            <p className="mb-3 text-xs text-red-600">
              Deletes {subs.data.username}'s listings, groups, wishes and bids from this event.
              Their copies are kept. References from other users are cleaned up automatically.
            </p>
            <button
              onClick={() => setConfirmKick(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
            >
              Kick {subs.data.username}
            </button>
          </section>

          <Link to={`/events/${slug}/matches`} className="block text-sm text-indigo-600 hover:underline">
            → Re-run the solver
          </Link>
        </div>
      )}

      {confirmKick && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmKick(false)} aria-hidden="true" />
          <div className="relative w-full sm:max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-gray-900">Kick {selected}?</h3>
            <p className="mb-4 text-sm text-gray-600">
              This removes {subs.data?.listings.length ?? 0} listings and {subs.data?.wishes.length ?? 0} wishes
              from this event. Their copies are preserved. This cannot be undone here.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmKick(false)} disabled={kick.isPending}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={doKick} disabled={kick.isPending}
                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">
                {kick.isPending ? 'Removing…' : 'Confirm kick'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

In `frontend/src/routes/index.tsx`, add the import after the `MatchRunPage` import:

```tsx
import ManageEventPage from '../features/events/ManageEventPage'
```

Add this route object right after the `events/:slug/matches` route entry:

```tsx
      {
        path: 'events/:slug/manage',
        element: (
          <RequireAuth>
            <ManageEventPage />
          </RequireAuth>
        ),
      },
```

- [ ] **Step 3: Add the entry button**

In `frontend/src/features/events/EventDetailPage.tsx`, find the organizer Edit button block in the header (the `{event.is_organizer && (` wrapping the "Edit" button) and add a Manage link immediately before that button so it reads:

```tsx
            {event.is_organizer && (
              <Link
                to={`/events/${event.slug}/manage`}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Manage
              </Link>
            )}
            {event.is_organizer && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
            )}
```

(`Link` is already imported in `EventDetailPage.tsx`.)

- [ ] **Step 4: Verify typecheck + lint**

Run: `cd frontend && npx tsc -b && npx eslint src --ext ts,tsx --max-warnings 0`
Expected: exit 0 for both.

- [ ] **Step 5: Manual smoke test**

Start the app, sign in as an event's organizer, open the event, click **Manage**. Verify: participant dropdown lists participants; selecting one shows their listings/groups/wishes; toggling a wish, editing a bound (blur), and unlisting a copy all persist on refresh; the Kick button opens the confirm dialog and, on confirm, shows the removal summary. As a non-organizer, navigating to `/events/:slug/manage` shows the "Only the organizer" message.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/events/ManageEventPage.tsx frontend/src/routes/index.tsx frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): organizer manage dashboard page + route + entry"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** kick cascade (Task 1, 4), inspect submissions (Task 2), toggle wish + X/Y bounds + unlist (Task 3), Manage page + organizer gate + re-run link (Task 6). Lifecycle ARCHIVED block (Task 2 guard, tested). All spec items mapped.
- **Type consistency:** `kick_participant` summary keys (`removed_listings`, `removed_wishes`, `removed_groups`, `affected_other_users`, `username`) match the `KickSummary` TS interface and the page's usage. Endpoint paths in `eventAdmin.ts` match the `@action` `url_path`s exactly (`admin/submissions`, `admin/wishes/{id}`, `admin/offer-groups/{id}`, `admin/want-groups/{id}`, `admin/listings/{id}`, `admin/kick`).
- **Note on trailing slashes:** the project's `apiClient` calls all use trailing slashes and DRF `APPEND_SLASH`/router defaults expect them; keep them on every admin URL.
```

