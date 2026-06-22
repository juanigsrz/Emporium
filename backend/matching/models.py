"""
matching/models.py

F6 Matching models.

Models:
    MatchRun      — a single execution of the matching algorithm for an event.
    TradeAssignment — one step in a trade cycle (normalized result row).
"""

from django.conf import settings
from django.db import models


class MatchRun(models.Model):
    """A single execution of the matching algorithm for an event."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE    = "DONE",    "Done"
        FAILED  = "FAILED",  "Failed"

    event = models.ForeignKey(
        "events.TradeEvent",
        on_delete=models.CASCADE,
        related_name="match_runs",
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
    )
    algorithm   = models.CharField(max_length=40, default="fake")
    started_at  = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    summary     = models.JSONField(default=dict)  # counts: matched_wishes, cycles, unmatched
    result      = models.JSONField(default=dict)  # full result blob per DATA_MODEL schema
    log         = models.TextField(blank=True)    # human-readable progress log
    # Set once apply_carryover has flipped traded copies + minted fresh ones for
    # this run's receivers (idempotency guard).
    carried_over = models.BooleanField(default=False)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"MatchRun(event={self.event.slug}, status={self.status}, id={self.pk})"


class TradeAssignment(models.Model):
    """
    One step in a trade cycle — normalized result row for queries and visualization.

    One row per listing moved: giver → receiver, within a cycle.
    """

    match_run = models.ForeignKey(
        MatchRun,
        on_delete=models.CASCADE,
        related_name="assignments",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="trade_assignments",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="trade_assignments",
        null=True, blank=True,
    )
    giver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assignments_given",
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assignments_received",
    )
    wish = models.ForeignKey(
        "trades.TradeWish",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assignments",
    )
    cycle_id = models.IntegerField()  # groups assignments into a trade cycle

    # Cash purchase amount in dollars (null = barter move). Receiver pays giver.
    cash_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # Money that moves with this item = its ask. Set for BOTH swap legs and cash
    # buys (cash buys reuse the parsed Cash Purchases amount). null = unpriced /
    # barter-only. Frozen at solve time, like cash_amount.
    item_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["cycle_id", "id"]
        constraints = [
            models.CheckConstraint(
                check=(models.Q(event_listing__isnull=False) & models.Q(combo__isnull=True))
                | (models.Q(event_listing__isnull=True) & models.Q(combo__isnull=False)),
                name="assignment_exactly_one_target",
            ),
        ]

    def __str__(self):
        return (
            f"TradeAssignment(run={self.match_run_id}, cycle={self.cycle_id}, "
            f"listing={self.event_listing_id}, {self.giver} → {self.receiver})"
        )


class Shipment(models.Model):
    class Status(models.TextChoices):
        PENDING  = "PENDING",  "Pending"
        SENT     = "SENT",     "Sent"
        RECEIVED = "RECEIVED", "Received"

    assignment    = models.OneToOneField(TradeAssignment, on_delete=models.CASCADE, related_name="shipment")
    status        = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    shipping_info = models.TextField(blank=True)
    sent_at       = models.DateTimeField(null=True, blank=True)
    received_at   = models.DateTimeField(null=True, blank=True)
    created       = models.DateTimeField(auto_now_add=True)
    updated       = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Shipment(assignment={self.assignment_id}, {self.status})"


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
