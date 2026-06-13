"""
matching/services.py

Lazy, N+1-free creation of fulfillment rows for a DONE match run.
Idempotent — safe to call on every read.
"""

from django.contrib.auth import get_user_model

from .models import Shipment, TradeAssignment, SettlementPayment


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
