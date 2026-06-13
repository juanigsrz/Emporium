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
