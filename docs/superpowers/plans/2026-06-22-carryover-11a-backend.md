# Event-Cycle Carryover 11a — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an event is archived, flip each traded copy to `TRADED` and mint a fresh `ACTIVE` copy for the receiver; and prevent listing a non-`ACTIVE` copy into a new event.

**Architecture:** A new idempotent `apply_carryover(event)` service (in `matching/services.py`) processes the latest DONE `MatchRun`'s assignments — guarded by a new `MatchRun.carried_over` flag — and is called from the `transition` action when an event moves to `ARCHIVED`. Listing creation rejects copies whose `status != ACTIVE`.

**Tech Stack:** Django 5, DRF. Tests: `manage.py test`.

**Spec:** `docs/superpowers/specs/2026-06-22-event-cycle-carryover-design.md` (Part A).

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd: `backend/`. Interpreter: `./.venv/bin/python`. Tests: `./.venv/bin/python manage.py test <dotted.path> -v 2` (from `backend/`).

**This is Plan 11a of 2** (11b = import). Builds on the merged combos (`TradeAssignment.combo`) and caps work.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/carryover-11a
```

Expected: `Switched to a new branch 'feat/carryover-11a'`

---

### Task 1: `apply_carryover` + `MatchRun.carried_over` + transition hook

**Files:**
- Modify: `backend/matching/models.py`
- Modify: `backend/matching/services.py`
- Modify: `backend/events/views.py`
- Create: `backend/matching/test_carryover.py`
- Migration: `backend/matching/migrations/` (generated)

- [ ] **Step 1: Write the failing test**

Create `backend/matching/test_carryover.py`:

```python
"""Carryover: on archive, traded copies -> TRADED + fresh copies for receivers."""
from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from matching.models import MatchRun, TradeAssignment
from matching.services import apply_carryover

User = get_user_model()


class CarryoverTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.giver = User.objects.create_user("cogiver", "g@t.test", "pass1234")
        cls.receiver = User.objects.create_user("coreceiver", "r@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=11001, name="Carry1")
        cls.bg2 = BoardGame.objects.create(bgg_id=11002, name="Carry2")

    def _event_with_done_run(self):
        event = TradeEvent.objects.create(name="Carry Ev", organizer=self.giver)
        run = MatchRun.objects.create(event=event, status=MatchRun.Status.DONE,
                                      algorithm="gurobi")
        return event, run

    def test_listing_assignment_flips_and_mints(self):
        event, run = self._event_with_done_run()
        copy = Copy.objects.create(owner=self.giver, board_game=self.bg1,
                                   condition="GOOD", language="EN")
        el = EventListing.objects.create(event=event, copy=copy)
        TradeAssignment.objects.create(
            match_run=run, event_listing=el, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        copy.refresh_from_db()
        self.assertEqual(copy.status, Copy.Status.TRADED)
        fresh = Copy.objects.filter(owner=self.receiver, board_game=self.bg1,
                                    status=Copy.Status.ACTIVE, import_source="carryover")
        self.assertEqual(fresh.count(), 1)
        self.assertEqual(fresh.first().condition, "GOOD")

    def test_combo_assignment_flips_all_members(self):
        event, run = self._event_with_done_run()
        c1 = Copy.objects.create(owner=self.giver, board_game=self.bg1)
        c2 = Copy.objects.create(owner=self.giver, board_game=self.bg2)
        el1 = EventListing.objects.create(event=event, copy=c1)
        el2 = EventListing.objects.create(event=event, copy=c2)
        combo = Combo.objects.create(event=event, owner=self.giver, name="cb")
        ComboItem.objects.create(combo=combo, event_listing=el1)
        ComboItem.objects.create(combo=combo, event_listing=el2)
        TradeAssignment.objects.create(
            match_run=run, combo=combo, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        c1.refresh_from_db(); c2.refresh_from_db()
        self.assertEqual(c1.status, Copy.Status.TRADED)
        self.assertEqual(c2.status, Copy.Status.TRADED)
        self.assertEqual(
            Copy.objects.filter(owner=self.receiver, status=Copy.Status.ACTIVE,
                                import_source="carryover").count(),
            2,
        )

    def test_idempotent(self):
        event, run = self._event_with_done_run()
        copy = Copy.objects.create(owner=self.giver, board_game=self.bg1)
        el = EventListing.objects.create(event=event, copy=copy)
        TradeAssignment.objects.create(
            match_run=run, event_listing=el, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        apply_carryover(event)  # second call must be a no-op
        self.assertEqual(
            Copy.objects.filter(owner=self.receiver, import_source="carryover").count(),
            1,
        )

    def test_no_done_run_is_noop(self):
        event = TradeEvent.objects.create(name="Empty Ev", organizer=self.giver)
        apply_carryover(event)  # no run -> no error, nothing minted
        self.assertEqual(Copy.objects.filter(import_source="carryover").count(), 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_carryover -v 2`
Expected: FAIL — `ImportError: cannot import name 'apply_carryover'` (and `carried_over` field missing).

- [ ] **Step 3: Add the `carried_over` field**

In `backend/matching/models.py`, in the `MatchRun` model, after the `log` field
(`log = models.TextField(blank=True)  # human-readable progress log`) add:

```python
    # Set once apply_carryover has flipped traded copies + minted fresh ones for
    # this run's receivers (idempotency guard).
    carried_over = models.BooleanField(default=False)
```

- [ ] **Step 4: Add `apply_carryover`**

In `backend/matching/services.py`, change the imports line:

```python
from .models import Shipment, TradeAssignment, SettlementPayment
```

to:

```python
from django.db import transaction

from .models import MatchRun, Shipment, TradeAssignment, SettlementPayment
```

Append to `backend/matching/services.py`:

```python
@transaction.atomic
def apply_carryover(event):
    """On archive: flip each traded copy to TRADED and mint a fresh ACTIVE copy
    for its receiver. Processes the latest DONE MatchRun; idempotent via
    MatchRun.carried_over; no-op when there is no DONE run."""
    from copies.models import Copy

    run = (
        event.match_runs.filter(status=MatchRun.Status.DONE)
        .order_by("-created")
        .first()
    )
    if run is None or run.carried_over:
        return

    assignments = (
        run.assignments
        .select_related("event_listing__copy", "combo", "receiver")
        .prefetch_related("combo__items__event_listing__copy")
    )

    for a in assignments:
        if a.combo_id:
            copies = [ci.event_listing.copy for ci in a.combo.items.all()]
        elif a.event_listing_id:
            copies = [a.event_listing.copy]
        else:
            copies = []
        for copy in copies:
            if copy.status != Copy.Status.TRADED:
                copy.status = Copy.Status.TRADED
                copy.save(update_fields=["status", "updated"])
            # New Copy.save() generates a fresh listing_code (bulk_create would
            # skip that), so create one at a time.
            Copy.objects.create(
                owner=a.receiver,
                board_game=copy.board_game,
                version=copy.version,
                condition=copy.condition,
                language=copy.language,
                status=Copy.Status.ACTIVE,
                import_source="carryover",
            )

    run.carried_over = True
    run.save(update_fields=["carried_over", "updated"])
```

- [ ] **Step 5: Hook the transition action**

In `backend/events/views.py`, add a module-level logger if not already present
(near the top imports):

```python
import logging

logger = logging.getLogger(__name__)
```

In the `transition` action, the status save + notification block is:

```python
        event.status = target
        event.save(update_fields=["status", "updated"])

        from notifications.models import Notification
```

Insert the carryover hook between the save and the notification import:

```python
        event.status = target
        event.save(update_fields=["status", "updated"])

        if target == TradeEvent.Status.ARCHIVED:
            from matching.services import apply_carryover
            try:
                apply_carryover(event)
            except Exception:  # never block archiving on a carryover hiccup (idempotent retry-safe)
                logger.exception("carryover failed for event %s", event.slug)

        from notifications.models import Notification
```

- [ ] **Step 6: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations matching`
Expected: a migration adding `MatchRun.carried_over`.

- [ ] **Step 7: Run the tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_carryover -v 2`
Expected: PASS (4 tests).

- [ ] **Step 8: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching events -v 1`
Expected: PASS (the full event lifecycle test archives an event; carryover runs idempotently with whatever run exists).

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/matching/models.py backend/matching/services.py backend/events/views.py backend/matching/test_carryover.py backend/matching/migrations/
git commit -m "feat(carryover): flip traded copies + mint fresh copies on archive"
```

---

### Task 2: Reject listing a non-ACTIVE copy

**Files:**
- Modify: `backend/events/views.py`
- Create: `backend/events/test_listing_status_guard.py`

- [ ] **Step 1: Write the failing test**

Create `backend/events/test_listing_status_guard.py`:

```python
"""A non-ACTIVE copy (e.g. TRADED from a prior cycle) can't be listed."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import TradeEvent

User = get_user_model()


class ListingStatusGuardTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("lsg", "lsg@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=11500, name="Guarded")
        cls.event = TradeEvent.objects.create(
            name="Guard Ev", organizer=cls.u, status="SUBMISSIONS_OPEN"
        )

    def test_traded_copy_cannot_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN",
                                   status=Copy.Status.TRADED)
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_active_copy_can_be_listed(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_listing_status_guard -v 2`
Expected: FAIL — `test_traded_copy_cannot_be_listed` returns 201 (no status guard yet).

- [ ] **Step 3: Add the status guard**

In `backend/events/views.py`, `_listings_create`, the ownership check is:

```python
        if copy.owner != request.user:
            raise PermissionDenied("You can only add your own copies to an event.")

        if copy.is_pending:
```

Insert the status guard between the ownership check and the `is_pending` check:

```python
        if copy.owner != request.user:
            raise PermissionDenied("You can only add your own copies to an event.")

        if copy.status != Copy.Status.ACTIVE:
            raise ValidationError(
                {"copy": "This copy is not active (it may have been traded in a "
                         "previous event) and can't be listed."}
            )

        if copy.is_pending:
```

(`Copy` is already imported a few lines above in this method.)

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_listing_status_guard -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events matching trades -v 1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/events/views.py backend/events/test_listing_status_guard.py
git commit -m "feat(carryover): reject listing a non-ACTIVE copy"
```

---

## Self-Review

**Spec coverage (Part A):**
- `MatchRun.carried_over` idempotency flag → Task 1 ✔
- `apply_carryover`: latest DONE run, listing + combo moved copies → TRADED, fresh ACTIVE copy per moved copy for the receiver, atomic, guarded → Task 1 ✔
- Transition hook on ARCHIVED, error-swallowed + logged → Task 1 ✔
- Listing rejects non-ACTIVE copy → Task 2 ✔
- Tests: listing flip+mint, combo flip-all, idempotent, no-run no-op, listing guard (TRADED reject + ACTIVE allow) → Tasks 1–2 ✔

**Placeholder scan:** none.

**Type/name consistency:** `apply_carryover(event)` defined in `matching/services.py`, imported in the transition hook + tests; `MatchRun.carried_over` set/read consistently; `MatchRun.Status.DONE`, `Copy.Status.{TRADED,ACTIVE}`, `event.match_runs`, `run.assignments`, `combo.items`, `ci.event_listing.copy`, `a.receiver` all match the existing models.

**Notes for the executor:**
- `Copy.save()` is custom (auto-generates `listing_code`); the fresh copy is created via `Copy.objects.create(...)` one at a time on purpose — do not switch to `bulk_create` (it skips `save()` and would leave `listing_code` blank → unique-violation).
- The transition hook swallows carryover exceptions by design (archiving must not fail on it); `apply_carryover` is idempotent, so a fix-and-retransition or a manual call re-runs safely. (Re-transition out of ARCHIVED isn't allowed, so practically a manual `apply_carryover(event)` call is the retry path.)
