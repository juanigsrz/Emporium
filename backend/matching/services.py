"""
matching/services.py

Lazy, N+1-free creation of fulfillment rows for a DONE match run.
Idempotent — safe to call on every read.
"""

from django.contrib.auth import get_user_model

from django.db import transaction

from .models import MatchRun, Shipment, TradeAssignment, SettlementPayment


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
