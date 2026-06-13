# Event leave-gating, leave-cascade, profile back, shipping pagination & settlement payments

Date: 2026-06-13

A five-item batch spanning event participation rules, a profile bug, a
matching-section performance/pagination fix, and a new settlement-payment
subsystem consolidated with shipping.

## Goals

1. Users can't leave an event once Matching has started; users can't join a
   second event while still participating in a non-archived one.
2. Leaving an event runs the same cascade as an organizer kick (delist copies;
   delete offer/want groups and wishes; adjust other users' affected
   groups/wishes).
3. A trader's public-profile "← Back" returns to the previous page, not home.
4. The matching Shipping Overview is paginated and free of N+1 queries.
5. Settlement payments gain a status lifecycle (mark-paid / confirm-received),
   mirroring shipping, surfaced for both participants and the organizer.
   Shipping and payments are **consolidated**: same lifecycle stage, one
   combined participant view, one combined organizer overview.

Non-goals: no change to the solver, settlement math, or the netting plan; no
change to how `result.settlement` is produced.

---

## Item 1 — Join / leave gating

File: `backend/events/views.py` (`TradeEventViewSet.join`, `.leave`).

**No leave after Matching.** `leave` rejects when `event.inputs_locked`
(status ∈ {MATCHING, MATCH_REVIEW, FINALIZATION, SHIPPING, ARCHIVED}):

```python
if event.inputs_locked:
    raise ValidationError({"detail": "You can't leave once matching has started."})
```

**One active event at a time.** `join`, before `get_or_create`, rejects if the
user already participates in another non-archived event:

```python
clash = (EventParticipation.objects
         .filter(user=request.user)
         .exclude(event=event)
         .exclude(event__status=TradeEvent.Status.ARCHIVED)
         .select_related("event")
         .first())
if clash:
    raise ValidationError({"detail":
        f"You're already participating in “{clash.event.name}”. "
        f"Leave it before joining another event."})
```

Re-joining the same event (`exclude(event=event)`) and organizer-only users
(no `EventParticipation` row) are unaffected. A user is freed to join a new
event once their current one reaches `ARCHIVED`.

**Frontend** (`EventDetailPage.tsx`, `JoinLeaveButton`): hide the Leave control
when `event.status` is matching-or-later (server still enforces). Join errors
surface the server message as today (no extra client data needed).

---

## Item 2 — Leave = kick cascade

`leave` calls the existing `kick_participant(event, request.user)` instead of a
bare participation delete, then returns the impact summary (HTTP 200) instead of
204. Because item 1 blocks leaving once Matching starts, the cascade only ever
runs pre-matching — there are no `TradeAssignment`/`Shipment` rows to clean up
mid-flight, so the existing kick cascade is sufficient unchanged.

```python
summary = kick_participant(event, request.user)
return Response(summary, status=status.HTTP_200_OK)
```

The "not a participant" guard remains: if `kick_participant` removed nothing
(no participation), return the existing 400. Implementation: check
participation exists first, else `ValidationError({"detail": "You are not a
participant in this event."})`.

**Frontend** (`JoinLeaveButton`): the leave-confirm copy is updated to warn the
cascade is destructive — e.g. "Leaving removes all your copies, want lists, and
wishes from this event." The `useLeaveEvent` hook ignores the response body
(only invalidates), so the 204→200 change is transparent.

---

## Item 3 — Profile back button

File: `frontend/src/features/profile/PublicProfilePage.tsx`.

The bottom `← Back` `<Link to="/">` becomes `useNavigate()` + a button calling
`navigate(-1)` (previous page). The error-state "← Back to home" link stays
pointing at `/` (sensible fallback when arriving at a broken URL).

---

## Item 4 — Shipping Overview: pagination + N+1 fix

Files: `backend/matching/views.py`, `urls.py`, `serializers.py`;
`frontend/src/api/shipping.ts`, `frontend/src/features/matching/ShippingOverviewTab.tsx`.

### N+1 fix

New helper (matching/views or a small `matching/services.py`):

```python
def ensure_shipments(run):
    existing = set(Shipment.objects
                   .filter(assignment__match_run=run)
                   .values_list("assignment_id", flat=True))
    missing = (TradeAssignment.objects.filter(match_run=run)
               .exclude(id__in=existing).values_list("id", flat=True))
    Shipment.objects.bulk_create(
        [Shipment(assignment_id=aid) for aid in missing], ignore_conflicts=True)
```

Replaces the per-assignment `get_or_create` loops in both `ShippingView` and
`ShippingOverviewView`. The overview queryset then reads shipments directly with
`select_related("assignment__event_listing__copy__board_game",
"assignment__giver", "assignment__receiver")`, so `ShipmentSerializer`'s
sources resolve without extra queries.

### Pagination

`GET …/shipping/overview/` is paginated (`MatchPagination`, page_size 24) and
accepts `?status=PENDING|SENT|RECEIVED`. Returns the standard DRF paginated
envelope (`count`, `next`, `previous`, `results`).

### Server-side summary

Counts and the per-trader rollup must stay global (not per-page), so they move
to a new endpoint:

`GET …/shipping/overview/summary/` (organizer-only) →

```json
{
  "counts": {"PENDING": 12, "SENT": 30, "RECEIVED": 8},
  "traders": [
    {"username": "alice", "out_total": 3, "out_sent": 2,
     "in_total": 4, "in_received": 1}
  ]
}
```

`counts` from `Shipment.objects.filter(...).values("status").annotate(c=Count("id"))`.
`traders` from two aggregates — group by `assignment__giver__username`
(out_total / out_sent) and by `assignment__receiver__username`
(in_total / in_received) — merged in Python. `ensure_shipments(run)` runs first.
"SENT or RECEIVED" counts toward `out_sent`; "RECEIVED" toward `in_received`.

### Frontend

`ShippingOverviewTab` fetches the summary once (counts + rollup) and the
paginated list with the active status filter + page state; renders page
controls. Existing `fetchShippingOverview` is replaced by a paginated fetch
(`page`, `status`) plus a `fetchShippingOverviewSummary`.

---

## Item 5 — Settlement payments, consolidated with shipping

Files: `backend/matching/models.py` (+migration), `serializers.py`, `views.py`,
`urls.py`; `frontend/src/api/payments.ts` (new),
`frontend/src/features/matching/MatchRunPage.tsx`.

### Model

```python
class SettlementPayment(models.Model):
    class Status(models.TextChoices):
        PENDING   = "PENDING",   "Pending"
        PAID      = "PAID",      "Paid"
        CONFIRMED = "CONFIRMED", "Confirmed"

    match_run    = models.ForeignKey(MatchRun, on_delete=models.CASCADE,
                                     related_name="payments")
    from_user    = models.ForeignKey(settings.AUTH_USER_MODEL,
                                     on_delete=models.CASCADE,
                                     related_name="payments_owed")
    to_user      = models.ForeignKey(settings.AUTH_USER_MODEL,
                                     on_delete=models.CASCADE,
                                     related_name="payments_due")
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    status       = models.CharField(max_length=10, choices=Status.choices,
                                    default=Status.PENDING)
    note         = models.TextField(blank=True)   # payer's reference / notes
    paid_at      = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created      = models.DateTimeField(auto_now_add=True)
    updated      = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("match_run", "from_user", "to_user")]
```

Per-counterparty (netted) — payments key off the settlement plan's
`(from_user, to_user)` pairs, **not** off `TradeAssignment` (which is per item).

### Derivation

```python
def ensure_payments(run):
    transfers = (run.result or {}).get("settlement", [])
    if not transfers:
        return
    users = {u.username: u for u in get_user_model().objects.filter(
        username__in={t["from_user"] for t in transfers}
                     | {t["to_user"] for t in transfers})}
    existing = set(SettlementPayment.objects.filter(match_run=run)
                   .values_list("from_user_id", "to_user_id"))
    rows = []
    for t in transfers:
        f, to = users.get(t["from_user"]), users.get(t["to_user"])
        if not f or not to or (f.id, to.id) in existing:
            continue
        rows.append(SettlementPayment(match_run=run, from_user=f, to_user=to,
                                      amount=t["amount"]))
    SettlementPayment.objects.bulk_create(rows, ignore_conflicts=True)
```

Idempotent and N+1-free. No-op for barter-only / non-money events (empty
settlement). Derives only for the latest DONE run, like shipments.

### Serializer

`SettlementPaymentSerializer`: `id`, `status`, `amount`, `note`,
`from_username`, `to_username`, `my_role` (`"payer"` | `"payee"` | `null`),
`paid_at`, `confirmed_at`.

### Endpoints (mirror shipping)

- `GET  …/payments/` — current user's payments (payer or payee) for the latest
  DONE run; `ensure_payments` first.
- `PATCH …/payments/{pk}/` — `status:"PAID"` (payer only, optional `note`) sets
  `paid_at`; `status:"CONFIRMED"` (payee only, requires current status PAID)
  sets `confirmed_at`. Gated to `event.status == "SHIPPING"` — identical to
  shipping.
- `GET  …/payments/overview/` — organizer-only, paginated, `?status=`,
  `select_related("from_user", "to_user")`. N+1-free from the start.
- `GET  …/payments/overview/summary/` — organizer counts + per-user rollup
  (owed vs paid, due vs confirmed), analogous to the shipping summary.

### Consolidated UI

Shipping and payments share the same stage (SHIPPING) and are presented
together.

**Participant — one "Shipping & Payments" tab** (replaces the standalone
Shipping tab; visible when `status ∈ {SHIPPING, ARCHIVED}`):

- Items to send (shipment sender cards: mark sent + tracking).
- Items to receive (shipment receiver cards: mark received).
- Payments to send (payer cards: mark paid + note) — only if `money_enabled`.
- Payments to receive (payee cards: confirm received) — only if `money_enabled`.

All edits gated to SHIPPING; read-only in ARCHIVED.

**Organizer — one "Overview" tab** with a shipping sub-panel and a payments
sub-panel, each paginated + each backed by its summary endpoint.

**My Trades tab:** keep the per-item buy/sell breakdown and the net-balance
"why" line. Remove the read-only "Settlement — what to actually do" transfer
list (its actionable form now lives in the Shipping & Payments tab). Pre-shipping
the net-balance line still conveys who owes whom; the per-transfer action list
appears once the event is in SHIPPING.

New FE module `api/payments.ts` mirrors `api/shipping.ts`
(`useMyPayments`, `useUpdatePayment`, `usePaymentsOverview`,
`usePaymentsOverviewSummary`).

---

## Testing (TDD, backend first)

- **events/test_join_gate.py** (extend): join blocked while in another
  non-archived event; allowed when the other event is ARCHIVED; re-joining the
  same event allowed; organizer-only (no participation) not blocked.
- **events** leave tests: leave blocked once status is MATCHING+; leave
  pre-matching runs the full cascade (victim's listings/groups/wishes gone,
  other users' refs adjusted) and returns the summary.
- **matching/test_shipping_overview.py** (extend): overview is paginated;
  `?status=` filters; `assertNumQueries` is bounded and independent of the
  number of shipments (proves N+1 gone); summary counts + rollup correct.
- **matching** payment tests: `ensure_payments` idempotent and money-only;
  `GET /payments/` returns the user's payer+payee rows; payer→PAID, payee→
  CONFIRMED; payee cannot mark PAID and payer cannot CONFIRM; edits rejected
  unless status==SHIPPING; overview organizer-only + paginated.

## Migration

One migration adds `SettlementPayment`. No data migration — payment rows are
created lazily on first access of the payments endpoints.
