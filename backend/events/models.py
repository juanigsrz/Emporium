"""
events/models.py

F4 Trade Events models.

Models:
    TradeEvent     — the top-level trade event with lifecycle status.
    EventParticipation — a user joining an event.
    EventListing   — a Copy entered into an event (the matchable unit).

State machine (ALLOWED_TRANSITIONS):
    DRAFT               → SUBMISSIONS_OPEN
    SUBMISSIONS_OPEN    → WANTLIST_OPEN, DRAFT  (organizer can re-open/retract)
    WANTLIST_OPEN       → MATCHING, SUBMISSIONS_OPEN  (re-open submissions)
    MATCHING            → MATCH_REVIEW, WANTLIST_OPEN  (re-open wantlist)
    MATCH_REVIEW        → FINALIZATION, WANTLIST_OPEN  (re-open for rework)
    FINALIZATION        → SHIPPING
    SHIPPING            → ARCHIVED
    ARCHIVED            → (terminal — no transitions out)

Notes:
    - TradeRating.event_id in accounts stays as an integer placeholder (F4 note).
    - slug is auto-generated from name on create (not on update).
"""

from django.conf import settings
from django.db import models
from django.utils.text import slugify


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

ALLOWED_TRANSITIONS: dict[str, list[str]] = {
    "DRAFT":            ["SUBMISSIONS_OPEN"],
    "SUBMISSIONS_OPEN": ["WANTLIST_OPEN", "DRAFT"],
    "WANTLIST_OPEN":    ["MATCHING", "SUBMISSIONS_OPEN"],
    "MATCHING":         ["MATCH_REVIEW", "WANTLIST_OPEN"],
    "MATCH_REVIEW":     ["FINALIZATION", "WANTLIST_OPEN"],
    "FINALIZATION":     ["SHIPPING"],
    "SHIPPING":         ["ARCHIVED"],
    "ARCHIVED":         [],
}


# ---------------------------------------------------------------------------
# TradeEvent
# ---------------------------------------------------------------------------

class TradeEvent(models.Model):
    """Top-level trade event record."""

    class Status(models.TextChoices):
        DRAFT            = "DRAFT",            "Draft"
        SUBMISSIONS_OPEN = "SUBMISSIONS_OPEN", "Submissions Open"
        WANTLIST_OPEN    = "WANTLIST_OPEN",    "Want-list Open"
        MATCHING         = "MATCHING",         "Matching"
        MATCH_REVIEW     = "MATCH_REVIEW",     "Match Review"
        FINALIZATION     = "FINALIZATION",     "Finalization"
        SHIPPING         = "SHIPPING",         "Shipping"
        ARCHIVED         = "ARCHIVED",         "Archived"

    name        = models.CharField(max_length=200)
    slug        = models.SlugField(unique=True, db_index=True, max_length=240)
    description = models.TextField(blank=True)
    organizer   = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="events_organized",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    # Lifecycle timestamps (all optional)
    submissions_open_at  = models.DateTimeField(null=True, blank=True)
    submissions_close_at = models.DateTimeField(null=True, blank=True)
    wantlist_close_at    = models.DateTimeField(null=True, blank=True)

    # Textual configuration
    shipping_rules        = models.TextField(blank=True)
    regional_restrictions = models.TextField(blank=True)
    trade_policies        = models.TextField(blank=True)

    # Solver configuration
    algorithm_settings = models.JSONField(default=dict)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"TradeEvent({self.slug}, {self.status})"

    # ------------------------------------------------------------------
    # Slug auto-generation
    # ------------------------------------------------------------------

    def _generate_unique_slug(self):
        """Generate a slug from name; append a numeric suffix if needed."""
        base = slugify(self.name)[:220]
        slug = base
        n = 1
        while TradeEvent.objects.filter(slug=slug).exclude(pk=self.pk).exists():
            slug = f"{base}-{n}"
            n += 1
        return slug

    def save(self, *args, **kwargs):
        # Only auto-generate slug on first save (when slug is empty)
        if not self.slug:
            self.slug = self._generate_unique_slug()
        super().save(*args, **kwargs)

    # ------------------------------------------------------------------
    # State machine helper
    # ------------------------------------------------------------------

    def can_transition_to(self, target: str) -> bool:
        """Return True if a transition from current status to target is allowed."""
        return target in ALLOWED_TRANSITIONS.get(self.status, [])

    @property
    def allowed_transitions_list(self) -> list[str]:
        """Return the list of valid next statuses from the current state."""
        return ALLOWED_TRANSITIONS.get(self.status, [])


# ---------------------------------------------------------------------------
# EventParticipation
# ---------------------------------------------------------------------------

class EventParticipation(models.Model):
    """A user registering to participate in a trade event."""

    event = models.ForeignKey(
        TradeEvent,
        on_delete=models.CASCADE,
        related_name="participations",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="event_participations",
    )
    region        = models.CharField(max_length=64, blank=True)
    shipping_pref = models.CharField(max_length=120, blank=True)

    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("event", "user")]
        ordering = ["created"]

    def __str__(self):
        return f"EventParticipation({self.user}, {self.event.slug})"


# ---------------------------------------------------------------------------
# EventListing
# ---------------------------------------------------------------------------

class EventListing(models.Model):
    """A physical copy entered into a specific trade event."""

    event = models.ForeignKey(
        TradeEvent,
        on_delete=models.CASCADE,
        related_name="listings",
    )
    copy = models.ForeignKey(
        "copies.Copy",
        on_delete=models.CASCADE,
        related_name="event_listings",
    )
    active = models.BooleanField(default=True)

    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("event", "copy")]
        ordering = ["created"]

    def __str__(self):
        return f"EventListing({self.copy.listing_code} @ {self.event.slug})"
