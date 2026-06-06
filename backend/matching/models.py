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

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["cycle_id", "id"]

    def __str__(self):
        return (
            f"TradeAssignment(run={self.match_run_id}, cycle={self.cycle_id}, "
            f"listing={self.event_listing_id}, {self.giver} → {self.receiver})"
        )
