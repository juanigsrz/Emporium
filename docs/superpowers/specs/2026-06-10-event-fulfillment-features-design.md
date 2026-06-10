# Event Fulfillment Features — Design

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — pending implementation plan.

Three independent post-matching features for the math-trade platform, sharing the
event / participant / MatchRun context:

1. **Payments view** — surface who pays whom (cash trades) in the matching results.
2. **Shipping** — per-trade shipping status (pending / sent / received) + shipping info.
3. **Notifications** — in-app feed; notify participants when the organizer advances the event stage.

Each is a separate task-group in the implementation plan and can merge independently.

**Out of scope (v1):** email + websockets, file-upload shipping labels, notifications for
anything other than organizer status transitions.

---

## Current state (context)

- `matching.models.TradeAssignment` is one row per moved listing: `match_run`, `event_listing`,
  `giver`, `receiver`, `wish`, `cycle_id`. **No money amount stored.** Cash trades already load
  as TradeAssignment rows (giver = seller, receiver = buyer) via `external_solver.load_solution`
  + `parse_gurobi_cash`, but the `$N` from the solver's `Cash Purchases:` section is currently
  dropped.
- Money export scales amounts to **integer cents** (`external_solver._to_cents`, ×100). The
  solver echoes those integers, so its `Cash Purchases:` lines carry cents.
- Matching FE: `frontend/src/features/matching/MatchRunPage.tsx`. `MyTrades` section splits
  `assignments` into Giving/Receiving by username; tabs are `my-trades | cycles | stats`.
  `/api/events/{slug}/matches/{id}/mine/` returns the current user's assignments;
  `/result/` returns the full result JSON.
- Event status transitions: organizer-only `POST /api/events/{slug}/transition/`
  (`events/views.py`, `EventViewSet.transition`).
- **No notification infra, no websockets, no EMAIL_BACKEND.** Celery runs eager (sync) in dev.
- Inputs (wants + listings) lock at status `MATCHING` (`TradeEvent.inputs_locked`).

---

## Feature 1 — Payments view

### Data
Add to `TradeAssignment`:
```python
cash_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```
- `null` → barter move (no cash).
- set → a cash purchase: the **receiver (buyer) pays the giver (seller)** `cash_amount` dollars.

### Backend changes
- `external_solver.parse_gurobi_cash(output)` → return `(moved_code, buyer_username, amount_cents)`
  instead of 2-tuples. The cash line is `CODE: seller -> buyer  (buyer pays seller $N)`; capture `N`
  (an integer in **cents**, per the ×100 export scale).
- `external_solver.load_solution` — when appending cash rows, carry the amount and set
  `cash_amount = Decimal(amount_cents) / 100` (back to dollars) on the created TradeAssignment.
  Swap rows keep `cash_amount = None`.
- Result-step JSON (`result["cycles"][].steps[]`) gains a `cash_amount` field (null for barter)
  so the FE renders payments without an extra query.
- The TradeAssignment serializer (used by `/mine/`) exposes `cash_amount`.

### FE (`MatchRunPage.tsx`, `my-trades` tab)
A **Payments** block, rendered only when at least one of my assignments has `cash_amount`:
- **You pay:** rows where I'm the `receiver` and `cash_amount` is set → "Pay **<giver>** $X for <game>".
- **You receive:** rows where I'm the `giver` and `cash_amount` is set → "Receive $X from **<receiver>** for <game>".
- Totals line: total pay, total receive, net.

### Tests
- `parse_gurobi_cash` returns the amount (cents) and is robust to the real solver line format.
- `load_solution` sets `cash_amount` in dollars (cents/100) on cash rows; barter rows stay null.
- TradeAssignment serializer includes `cash_amount`; result step includes it.

---

## Feature 2 — Shipping

### Data — new model `matching.models.Shipment`
```python
class Shipment(models.Model):
    class Status(models.TextChoices):
        PENDING  = "PENDING",  "Pending"
        SENT     = "SENT",     "Sent"
        RECEIVED = "RECEIVED", "Received"

    assignment    = models.OneToOneField(TradeAssignment, on_delete=models.CASCADE,
                                          related_name="shipment")
    status        = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    shipping_info = models.TextField(blank=True)   # tracking #, carrier, or label URL
    sent_at       = models.DateTimeField(null=True, blank=True)
    received_at   = models.DateTimeField(null=True, blank=True)
    created       = models.DateTimeField(auto_now_add=True)
    updated       = models.DateTimeField(auto_now=True)
```
One Shipment per TradeAssignment, created lazily via `get_or_create` when shipments are listed.
Scoped (indirectly) to the event's **latest DONE MatchRun** — the shipping endpoint operates on
that run's assignments.

### API (event-scoped, authenticated)
- `GET /api/events/{slug}/shipping/` — the current user's shipments for the latest DONE run, both
  as sender (giver) and receiver. Lazily `get_or_create`s a PENDING Shipment per relevant
  assignment. Response includes assignment context (listing_code, board_game, counterparty
  username, my role sender/receiver), status, shipping_info, timestamps.
- `PATCH /api/events/{slug}/shipping/{id}/` — update status / shipping_info. Role rules:
  - Only the **giver** may set `status = SENT` (and write `shipping_info`); sets `sent_at`.
  - Only the **receiver** may set `status = RECEIVED`; sets `received_at`.
  - Illegal transitions / wrong role → 403.
- Editable only when event `status == SHIPPING`. Read-only when `ARCHIVED` (PATCH → 403).

### FE (`MatchRunPage.tsx` — new `shipping` tab)
- **Items I'm sending:** status badge; when PENDING, a `shipping_info` text field + "Mark sent".
- **Items I'm receiving:** status badge; show the sender's `shipping_info`; when SENT, a
  "Mark received" button.
- Tab visible when event status is SHIPPING (or ARCHIVED, read-only).

### Tests
- Shipment lazily created PENDING on first list.
- Giver can SENT (+info); receiver cannot. Receiver can RECEIVED; giver cannot. Wrong role → 403.
- PATCH blocked when status != SHIPPING.
- List returns only the requesting user's shipments (sender or receiver), latest DONE run only.

---

## Feature 3 — Notifications (in-app, polled)

### Data — new model `notifications.Notification` (new `notifications` Django app)
```python
class Notification(models.Model):
    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                related_name="notifications")
    event   = models.ForeignKey("events.TradeEvent", on_delete=models.CASCADE, null=True, blank=True)
    kind    = models.CharField(max_length=32, default="EVENT_STATUS")
    message = models.CharField(max_length=255)
    read    = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]
```

### Trigger
In `EventViewSet.transition` (organizer-only), after a successful status change, create one
Notification per participant (`EventParticipation.user` for the event) with
`message = f"{event.name} moved to {new_status_label}."`, `event = event`, `kind = "EVENT_STATUS"`.
Synchronous bulk_create (cheap; no async needed for in-app).

### API (authenticated; always scoped to `request.user`)
- `GET /api/notifications/` — my notifications, newest first, paginated. `?unread=1` filters to unread.
- `POST /api/notifications/{id}/read/` — mark one read (404 if not mine).
- `POST /api/notifications/read-all/` — mark all my notifications read.
- Unread count: the FE reads the DRF paginated `count` field from `GET /api/notifications/?unread=1`
  (no dedicated count endpoint).

### FE (`NavBar.tsx`)
- A **bell** icon with an unread badge. React Query polls `/api/notifications/?unread=1`
  (`refetchInterval`, e.g. 30–60s) for the badge count.
- Dropdown lists recent notifications; opening marks them read (or per-item on click);
  clicking a notification navigates to its event.

### Tests
- A status transition creates exactly one Notification per participant with the right message;
  non-participants get none.
- `GET /api/notifications/` returns only the caller's notifications; `?unread=1` filters.
- `read` / `read-all` mark correctly and reject others' notifications (404/403).

---

## Architecture notes / boundaries

- **Payments** is purely additive to the existing matching result path — one field + parser tweak +
  serializer/JSON exposure + an FE block. No new endpoints.
- **Shipping** is a self-contained model + a small event-scoped view; depends on TradeAssignment but
  not on Payments. Lazy creation keeps it decoupled from `load_solution`.
- **Notifications** is fully independent — a model, a fan-out call in `transition`, a thin viewset,
  and a NavBar widget.
- All three reuse existing auth/permission patterns (event organizer checks, `request.user` scoping).

## Decisions locked
- `cash_amount` lives on TradeAssignment (dollars); cents→dollars conversion happens in `load_solution`.
- Shipment is per-item (1:1 TradeAssignment); shipping label is a text field.
- Notifications are in-app + polled; triggered only by organizer status transitions; notify participants.
