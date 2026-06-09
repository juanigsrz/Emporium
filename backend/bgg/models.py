from django.conf import settings
from django.db import models


class ImportJob(models.Model):
    """An async BGG scrape+import job; pollable like matching.MatchRun."""

    class Kind(models.TextChoices):
        WISHLIST = "WISHLIST", "Wishlist sync"
        RATINGS = "RATINGS", "Ratings import"
        OWNED = "OWNED", "Owned collection import"
        GEEKLIST = "GEEKLIST", "Geeklist import"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bgg_imports"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    source_ref = models.CharField(max_length=120, blank=True, default="")
    options = models.JSONField(default=dict)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    summary = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    log = models.TextField(blank=True, default="")

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"ImportJob({self.kind}, {self.status}, user={self.user_id})"
