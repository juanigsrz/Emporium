# Lifecycle Locks & Read-only (#2, #8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock price edits once an event leaves WANTLIST_OPEN, freeze a user's distance-relevant location while they're in an active event, and grey out the My Wants builder when locked.

**Architecture:** Add the existing `_assert_editable` lock to the price endpoints + the listing sell_price PATCH; add a location-change guard to `ProfileMeView`; wrap the My Wants view area in a non-interactive greyed container when the event is locked.

**Tech Stack:** Django/DRF (backend, `manage.py test`); React/TS (frontend, `npm run build` + targeted eslint + manual).

**Spec:** `docs/superpowers/specs/2026-06-22-lifecycle-locks-readonly-design.md`

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd `backend/` (interpreter `./.venv/bin/python`); frontend cwd `frontend/`. FE lint baseline: `npm run lint` fails only on pre-existing `CopyForm.tsx:15` — gate is the changed file clean via `npx eslint <file>`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/lifecycle-locks
```

Expected: `Switched to a new branch 'feat/lifecycle-locks'`

---

### Task 1: Lock price edits when the event is locked

**Files:**
- Modify: `backend/trades/views.py`
- Modify: `backend/events/views.py`
- Create: `backend/trades/test_price_lock.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/trades/test_price_lock.py`:

```python
"""Price edits (UserGamePrice, WantBid, EventListing.sell_price) lock at MATCHING."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class PriceLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("pl", "pl@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=20001, name="PL")
        cls.event = TradeEvent.objects.create(
            name="PL Ev", organizer=cls.u, status="WANTLIST_OPEN", money_enabled=True
        )
        cls.copy = Copy.objects.create(owner=cls.u, board_game=cls.bg,
                                       condition="GOOD", language="EN")
        cls.el = EventListing.objects.create(event=cls.event, copy=cls.copy)

    def _lock(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])

    def test_game_price_put_open_then_locked(self):
        self.client.force_authenticate(self.u)
        url = f"/api/events/{self.event.slug}/game-prices/"
        ok = self.client.put(url, {"board_game": self.bg.bgg_id, "price": "10.00"}, format="json")
        self.assertEqual(ok.status_code, status.HTTP_200_OK, ok.data)
        self._lock()
        locked = self.client.put(url, {"board_game": self.bg.bgg_id, "price": "12.00"}, format="json")
        self.assertEqual(locked.status_code, status.HTTP_403_FORBIDDEN)

    def test_game_price_delete_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/game-prices/?board_game={self.bg.bgg_id}"
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_want_bid_put_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/want-bids/"
        resp = self.client.put(url, {"event_listing": self.el.id, "amount": "5.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_sell_price_patch_locked(self):
        self.client.force_authenticate(self.u)
        self._lock()
        url = f"/api/events/{self.event.slug}/listings/{self.el.id}/"
        resp = self.client.patch(url, {"sell_price": "9.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_sell_price_patch_open_ok(self):
        self.client.force_authenticate(self.u)
        url = f"/api/events/{self.event.slug}/listings/{self.el.id}/"
        resp = self.client.patch(url, {"sell_price": "9.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_price_lock -v 2`
Expected: FAIL — the locked PUT/DELETE/PATCH return 200/204 (no lock yet).

- [ ] **Step 3: Guard `GamePriceView`**

In `backend/trades/views.py`, in `GamePriceView`, the `put` starts:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        ser = UserGamePriceSerializer(data=request.data)
```

Insert the guard after the event line:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ser = UserGamePriceSerializer(data=request.data)
```

And `GamePriceView.delete` starts:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        bgg_id = request.query_params.get("board_game")
```

Insert:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        bgg_id = request.query_params.get("board_game")
```

- [ ] **Step 4: Guard `WantBidView`**

In `WantBidView`, `put` starts:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        ser = WantBidSerializer(data=request.data)
```

Insert:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ser = WantBidSerializer(data=request.data)
```

And `WantBidView.delete` starts:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        combo = request.query_params.get("combo")
```

Insert:

```python
    def delete(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        combo = request.query_params.get("combo")
```

- [ ] **Step 5: Guard the listing sell_price PATCH**

In `backend/events/views.py`, `listing_detail`, the PATCH path is:

```python
        # PATCH — only sell_price is editable via this route (never copy/active)
        data = {"sell_price": request.data.get("sell_price")} if "sell_price" in request.data else {}
```

Insert the lock check before it:

```python
        # PATCH — only sell_price is editable via this route (never copy/active)
        if event.inputs_locked:
            raise PermissionDenied("Prices are locked — this event has moved to matching.")
        data = {"sell_price": request.data.get("sell_price")} if "sell_price" in request.data else {}
```

(`PermissionDenied` is already imported in `events/views.py` and used elsewhere in this method.)

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_price_lock -v 2`
Expected: PASS (5 tests).

- [ ] **Step 7: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades events -v 1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/views.py backend/events/views.py backend/trades/test_price_lock.py
git commit -m "feat(locks): lock price edits (game price / want bid / sell price) at MATCHING"
```

---

### Task 2: Lock distance-relevant location during an active event

**Files:**
- Modify: `backend/accounts/views.py`
- Create: `backend/accounts/test_location_lock.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/accounts/test_location_lock.py`:

```python
"""Profile lat/lng/max_trade_distance_km freeze while in a non-archived event."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Profile
from events.models import EventParticipation, TradeEvent

User = get_user_model()


class LocationLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("ll", "ll@t.test", "pass1234")
        cls.org = User.objects.create_user("ll_org", "llo@t.test", "pass1234")

    def setUp(self):
        self.client.force_authenticate(self.u)

    def _profile(self, **kw):
        p, _ = Profile.objects.get_or_create(user=self.u)
        for k, v in kw.items():
            setattr(p, k, v)
        p.save()
        return p

    def _join_active(self):
        ev = TradeEvent.objects.create(name="Active", organizer=self.org,
                                       status="WANTLIST_OPEN")
        EventParticipation.objects.create(event=ev, user=self.u)
        return ev

    def test_first_time_set_allowed_during_active_event(self):
        self._profile(latitude=None, longitude=None)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"latitude": 10.0, "longitude": 20.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_change_existing_blocked_during_active_event(self):
        self._profile(latitude=10.0, longitude=20.0)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"latitude": 11.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_change_max_distance_blocked_during_active_event(self):
        self._profile(max_trade_distance_km=100)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"max_trade_distance_km": 200}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_change_allowed_when_only_event_archived(self):
        self._profile(latitude=10.0, longitude=20.0)
        ev = TradeEvent.objects.create(name="Old", organizer=self.org, status="ARCHIVED")
        EventParticipation.objects.create(event=ev, user=self.u)
        resp = self.client.patch("/api/profiles/me/", {"latitude": 11.0}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_non_location_field_editable_during_active_event(self):
        self._profile(latitude=10.0, longitude=20.0)
        self._join_active()
        resp = self.client.patch("/api/profiles/me/", {"bio": "hi"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test accounts.test_location_lock -v 2`
Expected: FAIL — `test_change_existing_blocked_*` / `test_change_max_distance_*` return 200 (no lock yet). (If `test_non_location_field_editable` errors because `bio` isn't a Profile field, change it to a real editable Profile field — verify the model.)

- [ ] **Step 3: Add the location-lock guard**

In `backend/accounts/views.py`, ensure `PermissionDenied` is imported (add if missing):

```python
from rest_framework.exceptions import PermissionDenied
```

In `ProfileMeView`, add a `perform_update` override:

```python
    def perform_update(self, serializer):
        instance = serializer.instance
        data = serializer.validated_data
        locked_fields = ("latitude", "longitude", "max_trade_distance_km")
        changing_existing = any(
            f in data and getattr(instance, f) is not None and data[f] != getattr(instance, f)
            for f in locked_fields
        )
        if changing_existing:
            from events.models import EventParticipation, TradeEvent
            in_active = (
                EventParticipation.objects.filter(user=self.request.user)
                .exclude(event__status=TradeEvent.Status.ARCHIVED)
                .exists()
            )
            if in_active:
                raise PermissionDenied(
                    "Your location is locked while you're in an active event; "
                    "you can change it once your events are archived."
                )
        serializer.save()
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test accounts.test_location_lock -v 2`
Expected: PASS (5 tests). (If a field isn't writable on `ProfileSerializer` — e.g. the test's set doesn't take effect — confirm `latitude`/`longitude`/`max_trade_distance_km` are in the serializer's writable fields; they must be for the lock to apply.)

- [ ] **Step 5: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test accounts -v 1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/accounts/views.py backend/accounts/test_location_lock.py
git commit -m "feat(locks): freeze profile location/distance while in an active event"
```

---

### Task 3: Grey out the My Wants builder when locked

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Wrap the view area in a non-interactive greyed container when locked**

In `frontend/src/features/trades/MyWantsPage.tsx`, the three views render as:

```tsx
          {view === 'catalog' && (
            <GameBrowse
              slug={slug!}
              editor={editor}
              myListings={myListings}
              username={user?.username}
              customWantGroups={customWantGroups}
              moneyEnabled={event.money_enabled}
            />
          )}
          {view === 'visual' && <VisualMode myListings={myListings} editor={editor} />}
          {view === 'grid' && (
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} />
          )}
```

Wrap them so that when `event.inputs_locked` the whole area is greyed and
non-interactive (the locked banner already explains why; the save bar already
hides):

```tsx
          <div className={event.inputs_locked ? 'pointer-events-none opacity-60' : undefined}>
            {view === 'catalog' && (
              <GameBrowse
                slug={slug!}
                editor={editor}
                myListings={myListings}
                username={user?.username}
                customWantGroups={customWantGroups}
                moneyEnabled={event.money_enabled}
              />
            )}
            {view === 'visual' && <VisualMode myListings={myListings} editor={editor} />}
            {view === 'grid' && (
              <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} />
            )}
          </div>
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 3: Manual QA checklist**

- Open My Wants on a `WANTLIST_OPEN` event → catalog/visual/grid controls are
  fully interactive (rating/price inputs, Want buttons, grid toggles).
- Open My Wants on a `MATCHING` (or later) event → the view area is greyed
  (`opacity-60`) and clicks/typing in those controls do nothing (`pointer-events-none`);
  the "locked for matching" banner shows above. The mode tabs (catalog/visual/grid)
  remain clickable (they're outside the wrapper — switching views to read is fine).

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(locks): grey out My Wants builder when the event is locked"
```

---

## Self-Review

**Spec coverage:**
- Price lock on UserGamePrice (GamePriceView put/delete) + WantBid (WantBidView put/delete) + sell_price (listing PATCH) at `inputs_locked` → Task 1 ✔
- Location lock: lat/lng/max_trade_distance_km change-from-existing blocked during a non-ARCHIVED event; first-time set allowed; other fields editable → Task 2 ✔
- Grey-out My Wants when locked → Task 3 ✔
- Tests for price lock (open vs locked), location lock (first-set/change/archived/other-field), FE manual → all tasks ✔

**Placeholder scan:** none.

**Type/name consistency:** `_assert_editable` is the existing `EventScopedMixin` method (already used by sibling views); `PermissionDenied` raised consistently (already imported in events/views.py; added to accounts/views.py); `event.inputs_locked` used in the listing PATCH guard and the FE wrapper; `EventParticipation`/`TradeEvent.Status.ARCHIVED` match the events models.

**Notes for the executor:**
- Task 2 reads `latitude`/`longitude`/`max_trade_distance_km` off the `Profile` instance and `serializer.validated_data`; those three must be writable on `ProfileSerializer` for the lock (and the edits) to apply — verify when the tests run. If `bio` isn't a real Profile field, swap the "non-location field editable" test to any writable non-distance Profile field.
- Task 3 wraps only the view area; the mode tabs and the back button stay outside so a locked event can still be browsed read-only.
