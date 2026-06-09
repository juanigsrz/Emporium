"""
copies/models.py

Copy — a physical board game listing owned by a user.

Key design notes:
- listing_code: "C-" + 6 random uppercase base32 chars (no padding), e.g. "C-4F2A9X"
  Total length = 8 chars, fits in char(12). Generated server-side at create time;
  unique + db_index. On collision the generator retries up to MAX_CODE_RETRIES times.
- board_game FK uses related_name="copies" to match the Count("copies") annotation
  already in catalog/views.py.
- owner FK uses related_name="copies".
- copies_count on catalog counts only ACTIVE copies (see catalog/views.py).
- status default: ACTIVE.
- sleeved default: UNKNOWN.
"""

import base64
import os

from django.contrib.auth import get_user_model
from django.db import models, IntegrityError

User = get_user_model()

MAX_CODE_RETRIES = 10


def _generate_listing_code():
    """
    Generate a unique listing_code of the form "C-XXXXXX" where XXXXXX is 6
    random uppercase base32 characters (no '=' padding, digits 2-7 and A-Z).
    Caller is responsible for collision handling.
    """
    raw = os.urandom(4)  # 4 bytes → 7 base32 chars; we take the first 6
    encoded = base64.b32encode(raw).decode("ascii")  # always 8 chars (with padding)
    # base32 alphabet: A-Z + 2-7. Strip the padding '=' chars.
    chars = encoded.rstrip("=")[:6]
    return f"C-{chars}"


class Copy(models.Model):

    class Condition(models.TextChoices):
        NEW = "NEW", "New"
        LIKE_NEW = "LIKE_NEW", "Like New"
        EXCELLENT = "EXCELLENT", "Excellent"
        GOOD = "GOOD", "Good"
        FAIR = "FAIR", "Fair"
        POOR = "POOR", "Poor"

    class Sleeved(models.TextChoices):
        UNKNOWN = "UNKNOWN", "Unknown"
        NONE = "NONE", "None"
        SLEEVED = "SLEEVED", "Sleeved"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        RESERVED = "RESERVED", "Reserved"
        TRADED = "TRADED", "Traded"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    # Primary key
    id = models.BigAutoField(primary_key=True)

    # Human-readable short code — generated server-side, never supplied by client
    listing_code = models.CharField(max_length=12, unique=True, db_index=True)

    # Relations
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="copies",
    )
    board_game = models.ForeignKey(
        "catalog.BoardGame",
        on_delete=models.CASCADE,
        related_name="copies",  # MUST match Count("copies") in catalog/views.py
    )

    # Physical condition
    condition = models.CharField(
        max_length=16,
        choices=Condition.choices,
        blank=True,
        default="",
    )
    language = models.CharField(max_length=64, blank=True, default="")
    edition = models.CharField(max_length=120, blank=True, default="")
    sleeved = models.CharField(
        max_length=16,
        choices=Sleeved.choices,
        default=Sleeved.UNKNOWN,
    )

    # Component details
    includes_expansions = models.TextField(blank=True, default="")
    missing_components = models.TextField(blank=True, default="")
    upgraded_components = models.TextField(blank=True, default="")
    component_notes = models.TextField(blank=True, default="")

    # Owner info
    owner_notes = models.TextField(blank=True, default="")
    trade_value_hint = models.CharField(max_length=120, blank=True, default="")
    shipping_constraints = models.TextField(blank=True, default="")
    pickup_available = models.BooleanField(default=False)

    # Media (URL list only; no binary upload in v1)
    photo_urls = models.JSONField(default=list)

    # Import provenance
    is_pending = models.BooleanField(default=False)
    import_source = models.CharField(max_length=40, blank=True, default="")

    # Lifecycle
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    # Timestamps
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def save(self, *args, **kwargs):
        """Auto-generate listing_code on first save if not already set."""
        if not self.listing_code:
            for _ in range(MAX_CODE_RETRIES):
                code = _generate_listing_code()
                if not Copy.objects.filter(listing_code=code).exists():
                    self.listing_code = code
                    break
            else:
                # Extremely unlikely; surface as DB error rather than silently failing
                raise IntegrityError(
                    "Could not generate a unique listing_code after "
                    f"{MAX_CODE_RETRIES} attempts."
                )
        super().save(*args, **kwargs)

    def recompute_pending(self):
        self.is_pending = not (self.language and self.condition)

    def __str__(self):
        return f"{self.listing_code} — {self.board_game_id} ({self.owner})"
