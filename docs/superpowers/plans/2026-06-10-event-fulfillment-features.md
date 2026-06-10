# Event Fulfillment Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a payments view, a per-trade shipping workflow, and an in-app notification system to the math-trade platform.

**Architecture:** Three independent task groups. **A (Payments)** is additive to the matching-result path (one field + parser/serializer exposure + FE block). **B (Shipping)** is a new `Shipment` model (1:1 with `TradeAssignment`) + event-scoped endpoints in the `matching` app. **C (Notifications)** is a new `notifications` Django app + a fan-out call in the organizer status-transition action + a NavBar bell. Each group merges on its own.

**Tech Stack:** Django + DRF (backend, tests via `venv/bin/python manage.py test`), Vite + React + TS + TanStack Query (frontend; no unit-test runner — verify with `npm run build` + `npm run lint` + manual).

**Spec:** `docs/superpowers/specs/2026-06-10-event-fulfillment-features-design.md`

**Test commands:**
- Backend: `cd backend && venv/bin/python manage.py test <app>`
- Migrations: `cd backend && venv/bin/python manage.py makemigrations <app>`
- Frontend: `cd frontend && npm run build && npm run lint`

**Conventions:** No `Co-Authored-By` trailer on commits. Money amounts: the solver works in **integer cents** (export scales ×100); persisted `cash_amount` is **dollars** (cents ÷ 100).

---

## File Structure

| Group | Create | Modify |
|---|---|---|
| A | — | `backend/matching/models.py`, `backend/matching/external_solver.py`, `backend/matching/serializers.py`, `backend/matching/test_external_solver.py`, `frontend/src/api/matching.ts`, `frontend/src/features/matching/MatchRunPage.tsx` |
| B | `backend/matching/test_shipping.py`, `frontend/src/api/shipping.ts` | `backend/matching/models.py`, `backend/matching/serializers.py`, `backend/matching/views.py`, `backend/matching/urls.py`, `frontend/src/features/matching/MatchRunPage.tsx` |
| C | `backend/notifications/__init__.py`, `backend/notifications/apps.py`, `backend/notifications/models.py`, `backend/notifications/serializers.py`, `backend/notifications/views.py`, `backend/notifications/urls.py`, `backend/notifications/tests.py`, `frontend/src/api/notifications.ts` | `backend/bgtrade/settings.py`, `backend/bgtrade/urls.py`, `backend/events/views.py`, `frontend/src/components/NavBar.tsx` |

---

# GROUP A — Payments

## Task A1: Persist `cash_amount` on TradeAssignment

**Files:** Modify `backend/matching/models.py`; migration.

- [ ] **Step 1: Write the failing test**

Add to `backend/matching/test_external_solver.py` (in `ParserTests` or a small new `TestCase` — it only needs the model):

```python
def test_trade_assignment_has_cash_amount_field(self):
    from decimal import Decimal
    from matching.models import TradeAssignment
    f = TradeAssignment._meta.get_field("cash_amount")
    self.assertTrue(f.null)
    self.assertEqual(f.decimal_places, 2)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 1`
Expected: FAIL — `FieldDoesNotExist: TradeAssignment has no field named 'cash_amount'`.

- [ ] **Step 3: Add the field**

In `backend/matching/models.py`, on `TradeAssignment`, after `cycle_id` (line ~85):

```python
    # Cash purchase amount in dollars (null = barter move). Receiver pays giver.
    cash_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
```

- [ ] **Step 4: Make the migration + run tests**

Run: `cd backend && venv/bin/python manage.py makemigrations matching && venv/bin/python manage.py test matching.test_external_solver -v 1`
Expected: migration created; PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/matching/models.py backend/matching/migrations/ backend/matching/test_external_solver.py
git commit -m "feat: add cash_amount to TradeAssignment"
```

## Task A2: Capture the cash amount through the parser + loader

**Files:** Modify `backend/matching/external_solver.py`, `backend/matching/test_external_solver.py`.

- [ ] **Step 1: Update/extend the failing tests**

In `backend/matching/test_external_solver.py`:
- Change `test_parse_gurobi_cash_extracts_moves` to expect amounts (cents):

```python
def test_parse_gurobi_cash_extracts_moves(self):
    out = (
        "Cash Purchases:\n"
        "C-C: carol -> bob  (bob pays carol $500)\n"
        "C-D: dave -> eve  (eve pays dave $700)\n"
        "\nCash Summary:\n  bob: spent $500, earned $0, net $500 (cap $inf)\n"
    )
    moves = external_solver.parse_gurobi_cash(out)
    self.assertEqual(moves, [("C-C", "bob", 500), ("C-D", "eve", 700)])
```

- Update `test_upload_with_cash_purchase_creates_assignment` (in `UploadXToYTests`) to use a cents value and assert the persisted dollars amount:

```python
def test_upload_with_cash_purchase_creates_assignment(self):
    from decimal import Decimal
    a1, b1 = self.copy_a1.listing_code, self.copy_b1.listing_code
    c1 = self.copy_c1.listing_code
    out = (
        f"Trade Results:\n{a1} -> {b1}\n{b1} -> {a1}\n"
        f"\nCash Purchases:\n{c1}: carol -> bob  (bob pays carol $1000)\n"
        f"\nCash Summary:\n  bob: spent $1000, earned $0, net $1000 (cap $inf)\n"
    )
    resp = self.client.post(upload_url(self.slug), data=out, content_type="text/plain")
    self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
    run = MatchRun.objects.get(pk=resp.data["id"])
    cash_row = TradeAssignment.objects.get(match_run=run, event_listing=self.el_c1)
    self.assertEqual(cash_row.giver, self.user_c)
    self.assertEqual(cash_row.receiver, self.user_b)
    self.assertEqual(cash_row.cash_amount, Decimal("10.00"))  # 1000 cents -> $10.00
    self.assertEqual(TradeAssignment.objects.filter(match_run=run).count(), 3)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 1`
Expected: FAIL — `parse_gurobi_cash` returns 2-tuples; `cash_amount` is None.

- [ ] **Step 3: Parser returns the amount**

In `backend/matching/external_solver.py`, update the cash regex + `parse_gurobi_cash` (added in a prior task):

```python
_CASH_LINE = re.compile(r"^(\S+):\s+\S+\s+->\s+(\S+)\s+\(\S+ pays \S+ \$(\d+)")


def parse_gurobi_cash(output: str):
    """gurobi `Cash Purchases:` section -> [(moved_code, buyer_username, amount_cents), ...].

    Line form: `CODE: seller -> buyer  (buyer pays seller $N)`. N is in cents
    (export scales money ×100). The seller is owner(CODE); the buyer is named only
    here, so it is carried out as a username.
    """
    moves = []
    in_cash = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Cash Purchases"):
            in_cash = True
            continue
        if line.startswith("Cash Summary"):
            break
        if not in_cash or not line:
            continue
        m = _CASH_LINE.match(line)
        if m:
            moves.append((m.group(1), m.group(2), int(m.group(3))))
    return moves
```

- [ ] **Step 4: Loader sets `cash_amount` (cents → dollars)**

In `load_solution`, the cash block currently does
`resolved.append([moved_el, moved_el.copy.owner, buyer, None])`. The `resolved` row is a
4-list `[moved_el, giver, receiver, group]` consumed later to build `rows` and
`TradeAssignment`s. Carry the amount through:

1. Change the cash unpack loop to also read the amount and stash it on the moved element via a side dict keyed by `(moved_el.id)` — simplest is a local `cash_by_listing = {}`:

```python
    cash_by_listing = {}  # event_listing_id -> Decimal dollars
    if event.matching_mode == TradeEvent.MatchingMode.XTOY:
        cash_moves = parse_gurobi_cash(raw_output)
        if cash_moves:
            from decimal import Decimal
            from django.contrib.auth import get_user_model

            names = {bn for _, bn, _ in cash_moves}
            users_by_name = {
                u.username: u
                for u in get_user_model().objects.filter(username__in=names)
            }
            for moved_code, buyer_username, amount_cents in cash_moves:
                moved_el = by_code.get(moved_code)
                if moved_el is None:
                    raise ValueError(f"Unknown listing code in cash purchase: {moved_code!r}")
                buyer = users_by_name.get(buyer_username)
                if buyer is None:
                    raise ValueError(f"Unknown buyer in cash purchase: {buyer_username!r}")
                cash_by_listing[moved_el.id] = Decimal(amount_cents) / 100
                resolved.append([moved_el, moved_el.copy.owner, buyer, None])
```

2. When building `rows` and the cycle step dicts, include the amount. In the `rows` build loop and the `cycles[cid].append({...})` step dict, add:

```python
        # rows tuple gains the amount:
        rows.append((moved_el, giver, receiver, (group or 0) + 1, wid,
                     cash_by_listing.get(moved_el.id)))
```
and unpack the extra element everywhere `rows` is iterated (the `cycles` loop and the `bulk_create`). In the step dict add `"cash_amount": str(amt) if amt is not None else None`. In `bulk_create` pass `cash_amount=amt`.

(Read the current `rows`/`cycles`/`bulk_create` block and thread the 6th tuple element consistently — every `for ... in rows:` unpack must match.)

- [ ] **Step 5: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching -v 1`
Expected: PASS (incl. the updated cash tests).

- [ ] **Step 6: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat: carry cash purchase amounts into TradeAssignment + result steps"
```

## Task A3: Expose `cash_amount` on the assignment serializer

**Files:** Modify `backend/matching/serializers.py`, `backend/matching/test_external_solver.py`.

- [ ] **Step 1: Failing test**

```python
def test_mine_includes_cash_amount(self):
    # reuse UploadXToYTests-style setup or assert the serializer field directly
    from matching.serializers import TradeAssignmentSerializer
    self.assertIn("cash_amount", TradeAssignmentSerializer().fields)
```
(Place in a class that has DB access, e.g. `ParserTests`.)

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 1`
Expected: FAIL — `cash_amount` not in fields.

- [ ] **Step 3: Add the field**

In `backend/matching/serializers.py`, `TradeAssignmentSerializer.Meta.fields`, add `"cash_amount"` after `"wish"`. `cash_amount` is a model field; `ModelSerializer` serializes it automatically (Decimal → string).

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/matching/serializers.py backend/matching/test_external_solver.py
git commit -m "feat: expose cash_amount on TradeAssignment serializer"
```

## Task A4: Payments block in the matching UI

**Files:** Modify `frontend/src/api/matching.ts`, `frontend/src/features/matching/MatchRunPage.tsx`.

- [ ] **Step 1: Types**

In `frontend/src/api/matching.ts`: add `cash_amount: string | null` to the `TradeAssignment` interface and to `CycleStep`.

- [ ] **Step 2: Payments block**

In `MatchRunPage.tsx`, in the `MyTrades` component (renders Giving/Receiving from `assignments`), add a **Payments** section after Receiving, rendered only if `assignments.some(a => a.cash_amount != null)`:
- `youPay = assignments.filter(a => a.cash_amount != null && a.receiver_username === currentUsername)` → each row: "Pay **{a.giver_username}** ${a.cash_amount} for {a.board_game_name}".
- `youReceive = assignments.filter(a => a.cash_amount != null && a.giver_username === currentUsername)` → "Receive ${a.cash_amount} from **{a.receiver_username}** for {a.board_game_name}".
- Totals row: sum of youPay amounts (Number), sum of youReceive, net = receive − pay. Format with 2 decimals.
Match the existing Giving/Receiving block styling (reuse the section/card classes already in `MyTrades`).

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run build && npm run lint`
Manual: open a money XTOY event's DONE run → my-trades tab shows Payments with correct pay/receive/net.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/matching.ts frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat: payments section in matching results (who pays/receives cash)"
```

---

# GROUP B — Shipping

## Task B1: `Shipment` model

**Files:** Modify `backend/matching/models.py`; migration; test `backend/matching/test_shipping.py` (new).

- [ ] **Step 1: Failing test**

Create `backend/matching/test_shipping.py`:

```python
from matching.tests import MatchingTestBase
from matching.models import MatchRun, TradeAssignment, Shipment


class ShipmentModelTests(MatchingTestBase):
    def test_shipment_defaults_pending(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1,
        )
        s = Shipment.objects.create(assignment=a)
        self.assertEqual(s.status, Shipment.Status.PENDING)
        self.assertEqual(s.shipping_info, "")
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: FAIL — `cannot import name 'Shipment'`.

- [ ] **Step 3: Add the model**

In `backend/matching/models.py`, after `TradeAssignment`:

```python
class Shipment(models.Model):
    """Per-trade shipping state for one moved listing."""

    class Status(models.TextChoices):
        PENDING  = "PENDING",  "Pending"
        SENT     = "SENT",     "Sent"
        RECEIVED = "RECEIVED", "Received"

    assignment = models.OneToOneField(
        TradeAssignment, on_delete=models.CASCADE, related_name="shipment",
    )
    status        = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    shipping_info = models.TextField(blank=True)  # tracking #, carrier, or label URL
    sent_at       = models.DateTimeField(null=True, blank=True)
    received_at   = models.DateTimeField(null=True, blank=True)
    created       = models.DateTimeField(auto_now_add=True)
    updated       = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Shipment(assignment={self.assignment_id}, {self.status})"
```

- [ ] **Step 4: Migration + run**

Run: `cd backend && venv/bin/python manage.py makemigrations matching && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/matching/models.py backend/matching/migrations/ backend/matching/test_shipping.py
git commit -m "feat: add Shipment model (per-trade shipping status)"
```

## Task B2: Shipment serializer + latest-DONE-run helper

**Files:** Modify `backend/matching/serializers.py`, `backend/matching/test_shipping.py`.

- [ ] **Step 1: Failing test**

```python
def test_shipment_serializer_fields(self):
    from matching.serializers import ShipmentSerializer
    fields = set(ShipmentSerializer().fields)
    self.assertTrue({
        "id", "status", "shipping_info", "listing_code", "board_game_name",
        "giver_username", "receiver_username", "my_role", "sent_at", "received_at",
    }.issubset(fields))
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: FAIL — no `ShipmentSerializer`.

- [ ] **Step 3: Add the serializer**

In `backend/matching/serializers.py`:

```python
from .models import MatchRun, TradeAssignment, Shipment


class ShipmentSerializer(serializers.ModelSerializer):
    listing_code      = serializers.CharField(
        source="assignment.event_listing.copy.listing_code", read_only=True)
    board_game_name   = serializers.CharField(
        source="assignment.event_listing.copy.board_game.name", read_only=True)
    giver_username    = serializers.CharField(
        source="assignment.giver.username", read_only=True)
    receiver_username = serializers.CharField(
        source="assignment.receiver.username", read_only=True)
    my_role           = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = [
            "id", "status", "shipping_info",
            "listing_code", "board_game_name",
            "giver_username", "receiver_username", "my_role",
            "sent_at", "received_at",
        ]
        read_only_fields = [
            "id", "listing_code", "board_game_name",
            "giver_username", "receiver_username", "my_role",
            "sent_at", "received_at",
        ]

    def get_my_role(self, obj):
        uid = self.context["request"].user.id
        if obj.assignment.giver_id == uid:
            return "sender"
        if obj.assignment.receiver_id == uid:
            return "receiver"
        return None
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/matching/serializers.py backend/matching/test_shipping.py
git commit -m "feat: ShipmentSerializer"
```

## Task B3: Shipping list endpoint (`GET /api/events/{slug}/shipping/`)

**Files:** Modify `backend/matching/views.py`, `backend/matching/urls.py`, `backend/matching/test_shipping.py`.

- [ ] **Step 1: Failing test**

```python
from rest_framework.test import APITestCase  # MatchingTestBase already provides client

class ShippingListTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"; self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        # alice gives el_a1 to bob
        TradeAssignment.objects.create(
            match_run=self.run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1)

    def test_list_lazily_creates_pending_shipments_for_me(self):
        self.client.force_authenticate(self.user_a)  # alice = sender
        r = self.client.get(f"/api/events/{self.slug}/shipping/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["status"], "PENDING")
        self.assertEqual(r.data[0]["my_role"], "sender")

    def test_list_excludes_others(self):
        self.client.force_authenticate(self.user_c)  # carol not in this trade
        r = self.client.get(f"/api/events/{self.slug}/shipping/")
        self.assertEqual(r.data, [])
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: FAIL — 404 (no route).

- [ ] **Step 3: Implement the view + route**

In `backend/matching/views.py` add:

```python
from .models import Shipment
from .serializers import ShipmentSerializer


def _latest_done_run(event):
    return event.match_runs.filter(status=MatchRun.Status.DONE).order_by("-created").first()


class ShippingView(APIView):
    """GET /api/events/{slug}/shipping/ — my shipments for the latest DONE run."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        assignments = (
            TradeAssignment.objects
            .filter(match_run=run)
            .filter(Q(giver=request.user) | Q(receiver=request.user))
            .select_related("event_listing__copy__board_game", "giver", "receiver")
        )
        shipments = []
        for a in assignments:
            s, _ = Shipment.objects.get_or_create(assignment=a)
            shipments.append(s)
        ser = ShipmentSerializer(shipments, many=True, context={"request": request})
        return Response(ser.data)
```

Add imports at top of `views.py`: `from django.db.models import Q`, `from rest_framework import permissions`, and ensure `APIView`, `Response`, `MatchRun`, `TradeAssignment`, `_get_event` are imported/defined (they are — reuse the module's existing `_get_event`).

In `backend/matching/urls.py`, add to `urlpatterns`:

```python
    path("events/<slug:slug>/shipping/", ShippingView.as_view(), name="shipping-list"),
```
(import `ShippingView` from `.views`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_shipping.py
git commit -m "feat: shipping list endpoint (lazy per-trade shipments)"
```

## Task B4: Shipping update endpoint (`PATCH .../shipping/{id}/`) with role rules

**Files:** Modify `backend/matching/views.py`, `backend/matching/urls.py`, `backend/matching/test_shipping.py`.

- [ ] **Step 1: Failing tests**

```python
class ShippingPatchTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"; self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        self.a = TradeAssignment.objects.create(
            match_run=self.run, event_listing=self.el_a1,
            giver=self.user_a, receiver=self.user_b, cycle_id=1)
        self.s = Shipment.objects.create(assignment=self.a)

    def _url(self):
        return f"/api/events/{self.slug}/shipping/{self.s.id}/"

    def test_giver_marks_sent_with_info(self):
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._url(), {"status": "SENT", "shipping_info": "UPS 1Z999"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.s.refresh_from_db()
        self.assertEqual(self.s.status, "SENT")
        self.assertEqual(self.s.shipping_info, "UPS 1Z999")
        self.assertIsNotNone(self.s.sent_at)

    def test_receiver_cannot_mark_sent(self):
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(self._url(), {"status": "SENT"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_receiver_marks_received(self):
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(self._url(), {"status": "RECEIVED"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.s.refresh_from_db()
        self.assertEqual(self.s.status, "RECEIVED")
        self.assertIsNotNone(self.s.received_at)

    def test_giver_cannot_mark_received(self):
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._url(), {"status": "RECEIVED"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_patch_blocked_when_not_shipping_status(self):
        self.event.status = "ARCHIVED"; self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._url(), {"status": "SENT"}, format="json")
        self.assertEqual(r.status_code, 403)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_shipping -v 1`
Expected: FAIL — no PATCH route.

- [ ] **Step 3: Implement the detail view + route**

In `backend/matching/views.py`:

```python
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError


class ShipmentDetailView(APIView):
    """PATCH /api/events/{slug}/shipping/{pk}/ — giver marks SENT, receiver marks RECEIVED."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, slug, pk):
        event = _get_event(slug)
        if event.status != "SHIPPING":
            raise PermissionDenied("Shipping updates are only allowed while the event is shipping.")
        try:
            shipment = (
                Shipment.objects
                .select_related("assignment__giver", "assignment__receiver", "assignment__match_run")
                .get(pk=pk, assignment__match_run__event=event)
            )
        except Shipment.DoesNotExist:
            raise ValidationError({"detail": "Shipment not found."})

        a = shipment.assignment
        target = request.data.get("status")
        if target == "SENT":
            if request.user != a.giver:
                raise PermissionDenied("Only the sender can mark a shipment sent.")
            shipment.status = Shipment.Status.SENT
            shipment.sent_at = timezone.now()
            if "shipping_info" in request.data:
                shipment.shipping_info = request.data["shipping_info"]
        elif target == "RECEIVED":
            if request.user != a.receiver:
                raise PermissionDenied("Only the receiver can mark a shipment received.")
            shipment.status = Shipment.Status.RECEIVED
            shipment.received_at = timezone.now()
        else:
            raise ValidationError({"status": "Must be 'SENT' (sender) or 'RECEIVED' (receiver)."})
        shipment.save()
        return Response(ShipmentSerializer(shipment, context={"request": request}).data)
```

In `backend/matching/urls.py` add:

```python
    path("events/<slug:slug>/shipping/<int:pk>/", ShipmentDetailView.as_view(), name="shipping-detail"),
```
(import `ShipmentDetailView`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching -v 1`
Expected: PASS (all matching tests).

- [ ] **Step 5: Commit**

```bash
git add backend/matching/views.py backend/matching/urls.py backend/matching/test_shipping.py
git commit -m "feat: shipping update endpoint with sender/receiver role rules"
```

## Task B5: Shipping tab in the matching UI

**Files:** Create `frontend/src/api/shipping.ts`; modify `frontend/src/features/matching/MatchRunPage.tsx`.

- [ ] **Step 1: API module**

Create `frontend/src/api/shipping.ts` following the existing `api/matching.ts` pattern (uses `apiClient`, TanStack Query):
- `interface Shipment { id, status: 'PENDING'|'SENT'|'RECEIVED', shipping_info, listing_code, board_game_name, giver_username, receiver_username, my_role: 'sender'|'receiver'|null, sent_at, received_at }`
- `useShipments(slug)` → `GET /events/${slug}/shipping/` (returns `Shipment[]`).
- `useUpdateShipment(slug)` → mutation `PATCH /events/${slug}/shipping/${id}/` with `{ status, shipping_info? }`; invalidates the shipments query.

- [ ] **Step 2: Shipping tab**

In `MatchRunPage.tsx`: add `'shipping'` to the tab union and the tab bar (next to `my-trades | cycles | stats`), shown when the event status is `SHIPPING` or `ARCHIVED`. Render a `ShippingTab` component:
- Calls `useShipments(slug)`.
- **Items I'm sending** (`my_role === 'sender'`): status badge; if `status === 'PENDING'`, a `shipping_info` text input + "Mark sent" button → `useUpdateShipment` with `{ status: 'SENT', shipping_info }`.
- **Items I'm receiving** (`my_role === 'receiver'`): status badge; show `shipping_info` (sender's); if `status === 'SENT'`, a "Mark received" button → `{ status: 'RECEIVED' }`.
- Read-only (no buttons) when event status is `ARCHIVED`.
Match existing card/badge styling in the file.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run build && npm run lint`
Manual: a SHIPPING-status event with a DONE run → Shipping tab; sender marks sent (+info), receiver sees info and marks received.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/shipping.ts frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat: shipping tab in matching UI (sent/received workflow)"
```

---

# GROUP C — Notifications

## Task C1: `notifications` app + `Notification` model

**Files:** Create `backend/notifications/{__init__.py,apps.py,models.py}`; modify `backend/bgtrade/settings.py`; migration.

- [ ] **Step 1: Create the app skeleton**

Create `backend/notifications/__init__.py` (empty) and:

`backend/notifications/apps.py`:
```python
from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "notifications"
```

`backend/notifications/models.py`:
```python
from django.conf import settings
from django.db import models


class Notification(models.Model):
    user    = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    event   = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, null=True, blank=True,
        related_name="notifications")
    kind    = models.CharField(max_length=32, default="EVENT_STATUS")
    message = models.CharField(max_length=255)
    read    = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"Notification(user={self.user_id}, read={self.read}, {self.message!r})"
```

Register in `backend/bgtrade/settings.py` `INSTALLED_APPS`, after `"bgg.apps.BggConfig",`:
```python
    "notifications.apps.NotificationsConfig",
```

- [ ] **Step 2: Migration**

Run: `cd backend && venv/bin/python manage.py makemigrations notifications`
Expected: creates `notifications/migrations/0001_initial.py`.

- [ ] **Step 3: Smoke test**

Create `backend/notifications/tests.py`:
```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from notifications.models import Notification


class NotificationModelTests(TestCase):
    def test_create_defaults(self):
        u = get_user_model().objects.create_user("nina", password="x")
        n = Notification.objects.create(user=u, message="hi")
        self.assertFalse(n.read)
        self.assertEqual(n.kind, "EVENT_STATUS")
```

Run: `cd backend && venv/bin/python manage.py test notifications -v 1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/notifications/ backend/bgtrade/settings.py
git commit -m "feat: notifications app + Notification model"
```

## Task C2: Fan-out notifications on event status transition

**Files:** Modify `backend/events/views.py`; test `backend/notifications/tests.py`.

- [ ] **Step 1: Failing test**

Add to `backend/notifications/tests.py` (build an event + participants; reuse simple inline setup):
```python
from rest_framework.test import APITestCase
from events.models import TradeEvent, EventParticipation


class TransitionNotifyTests(APITestCase):
    def setUp(self):
        U = get_user_model()
        self.org = U.objects.create_user("org", password="x")
        self.p1 = U.objects.create_user("p1", password="x")
        self.p2 = U.objects.create_user("p2", password="x")
        self.event = TradeEvent.objects.create(
            name="E", organizer=self.org, status=TradeEvent.Status.SUBMISSIONS_OPEN)
        EventParticipation.objects.create(event=self.event, user=self.p1)
        EventParticipation.objects.create(event=self.event, user=self.p2)

    def test_transition_notifies_each_participant(self):
        self.client.force_authenticate(self.org)
        r = self.client.post(f"/api/events/{self.event.slug}/transition/", {"to": "WANTLIST_OPEN"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(Notification.objects.filter(user=self.p1, event=self.event).count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.p2, event=self.event).count(), 1)
        msg = Notification.objects.get(user=self.p1).message
        self.assertIn("Want-list Open", msg)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test notifications -v 1`
Expected: FAIL — 0 notifications created.

- [ ] **Step 3: Implement the fan-out**

In `backend/events/views.py`, `EventViewSet.transition`, after `event.save(update_fields=["status", "updated"])` and before building the response:

```python
        from notifications.models import Notification
        Notification.objects.bulk_create([
            Notification(
                user_id=p.user_id, event=event, kind="EVENT_STATUS",
                message=f"{event.name} moved to {event.get_status_display()}.",
            )
            for p in event.participations.all()
        ])
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test notifications events -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/events/views.py backend/notifications/tests.py
git commit -m "feat: notify participants when organizer advances event stage"
```

## Task C3: Notification list + read endpoints

**Files:** Create `backend/notifications/{serializers.py,views.py,urls.py}`; modify `backend/bgtrade/urls.py`; test `backend/notifications/tests.py`.

- [ ] **Step 1: Failing tests**

```python
class NotificationApiTests(APITestCase):
    def setUp(self):
        U = get_user_model()
        self.me = U.objects.create_user("me", password="x")
        self.other = U.objects.create_user("other", password="x")
        Notification.objects.create(user=self.me, message="a")
        Notification.objects.create(user=self.me, message="b", read=True)
        Notification.objects.create(user=self.other, message="c")
        self.client.force_authenticate(self.me)

    def test_list_only_mine(self):
        r = self.client.get("/api/notifications/")
        self.assertEqual(r.data["count"], 2)

    def test_unread_filter(self):
        r = self.client.get("/api/notifications/?unread=1")
        self.assertEqual(r.data["count"], 1)

    def test_mark_one_read(self):
        nid = Notification.objects.filter(user=self.me, read=False).first().id
        r = self.client.post(f"/api/notifications/{nid}/read/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Notification.objects.get(id=nid).read)

    def test_cannot_read_others(self):
        nid = Notification.objects.get(user=self.other).id
        r = self.client.post(f"/api/notifications/{nid}/read/")
        self.assertEqual(r.status_code, 404)

    def test_read_all(self):
        r = self.client.post("/api/notifications/read-all/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Notification.objects.filter(user=self.me, read=False).count(), 0)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test notifications -v 1`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement serializer + views + urls**

`backend/notifications/serializers.py`:
```python
from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    event_slug = serializers.CharField(source="event.slug", read_only=True, default=None)

    class Meta:
        model = Notification
        fields = ["id", "kind", "message", "read", "event", "event_slug", "created"]
        read_only_fields = fields
```

`backend/notifications/views.py`:
```python
from rest_framework import generics, permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer


class _Pagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = _Pagination

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        if self.request.query_params.get("unread") in ("1", "true"):
            qs = qs.filter(read=False)
        return qs


class NotificationReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from django.shortcuts import get_object_or_404
        n = get_object_or_404(Notification, pk=pk, user=request.user)
        if not n.read:
            n.read = True
            n.save(update_fields=["read"])
        return Response(NotificationSerializer(n).data)


class NotificationReadAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response(status=status.HTTP_200_OK)
```

`backend/notifications/urls.py`:
```python
from django.urls import path
from .views import NotificationListView, NotificationReadView, NotificationReadAllView

urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/read-all/", NotificationReadAllView.as_view(), name="notification-read-all"),
    path("notifications/<int:pk>/read/", NotificationReadView.as_view(), name="notification-read"),
]
```

In `backend/bgtrade/urls.py`, add after the bgg include:
```python
    path("api/", include("notifications.urls")),
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && venv/bin/python manage.py test notifications -v 1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/notifications/ backend/bgtrade/urls.py
git commit -m "feat: notification list + read endpoints"
```

## Task C4: NavBar notification bell

**Files:** Create `frontend/src/api/notifications.ts`; modify `frontend/src/components/NavBar.tsx`.

- [ ] **Step 1: API module**

Create `frontend/src/api/notifications.ts` (TanStack Query, `apiClient`):
- `interface Notification { id, kind, message, read, event: number|null, event_slug: string|null, created }`
- `useNotifications()` → `GET /notifications/` (paginated; return `data.results`), with `refetchInterval: 45000`.
- `useUnreadCount()` → `GET /notifications/?unread=1`, read `data.count`, `refetchInterval: 45000`.
- `useMarkRead()` → `POST /notifications/${id}/read/`; `useMarkAllRead()` → `POST /notifications/read-all/`. Both invalidate the notification queries.
Only enable the queries when a user is authenticated (`enabled: !!user`).

- [ ] **Step 2: Bell in NavBar**

In `frontend/src/components/NavBar.tsx`: when `user` is set, add a bell button (before the user menu) showing the unread count badge from `useUnreadCount()`. Clicking toggles a dropdown listing `useNotifications()` results (message + relative time); opening the dropdown calls `useMarkAllRead()` (or per-item mark-read on click). Clicking a notification with `event_slug` navigates to `/events/${event_slug}`. Reuse the existing outside-click pattern (`menuRef`/`useEffect`) already in NavBar for the dropdown.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run build && npm run lint`
Manual: as a participant, have an organizer advance an event → bell badge increments within the poll interval; dropdown lists the message; clicking navigates; badge clears after read.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/notifications.ts frontend/src/components/NavBar.tsx
git commit -m "feat: in-app notification bell with unread polling"
```

---

## Self-Review

**Spec coverage:**
- Payments (cash_amount persist + parser + serializer + FE block): Tasks A1–A4. ✓
- Shipping (Shipment model, lazy create, role-gated PATCH, status gate, FE tab): Tasks B1–B5. ✓
- Notifications (model, transition fan-out, list/read endpoints, NavBar bell, polling): Tasks C1–C4. ✓
- Cents→dollars conversion: A2 Step 4. ✓  Latest-DONE-run scoping: B3 `_latest_done_run`. ✓  Per-user scoping of notifications: C3 `get_queryset`. ✓

**Placeholder scan:** No TBD/TODO. FE steps specify exact files + concrete behavior + verify commands (no FE unit-test runner exists; build/lint/manual is the gate — consistent with the repo).

**Type consistency:** `cash_amount` (model→serializer→`matching.ts` `TradeAssignment`/`CycleStep`) consistent. `Shipment.my_role` values `sender`/`receiver` match the FE filter in B5. `parse_gurobi_cash` 3-tuple `(code, buyer, cents)` matches A2 loader unpack. Notification fields (`event_slug`, `read`) consistent across serializer (C3) and FE (C4).

**Cross-group ordering:** Groups are independent and may be done in any order; within a group, tasks are sequential. A2 edits `parse_gurobi_cash`/`load_solution` introduced in the earlier cash-parse work — read the current function bodies before editing and thread the amount through without breaking the existing 3 cash tests.
