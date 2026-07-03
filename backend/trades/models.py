"""
trades/models.py

F5 X-to-Y Trades models.

Models:
    OfferGroup      — named set of a user's own event listings + max_give (X).
    OfferGroupItem  — a single listing inside an OfferGroup.
    WantGroup       — named set of target games/listings + min_receive (Y).
    WantGroupItem   — a tiered, ranked target inside a WantGroup.
    TradeWish       — links one OfferGroup to one WantGroup (the trade intention).
    UserGamePrice   — a user's canonical per-game price in an event (defaults ask + bid).
    WantBid         — a per-target bid override (board game or specific listing).

Design: all models are event-scoped. Owner is always set to request.user at
create time; writes are owner-only. The unified X-to-Y model is the core
innovation (see DESIGN.md §4).
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


# ---------------------------------------------------------------------------
# OfferGroup
# ---------------------------------------------------------------------------

class OfferGroup(models.Model):
    """A named set of the wishing user's own copies in an event."""

    event = models.ForeignKey(
        "events.TradeEvent",
        on_delete=models.CASCADE,
        related_name="offer_groups",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="offer_groups",
    )
    name     = models.CharField(max_length=120)
    max_give = models.PositiveIntegerField(default=1)   # X
    rules    = models.JSONField(default=dict)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"OfferGroup({self.name!r}, event={self.event.slug}, user={self.user.username})"


# ---------------------------------------------------------------------------
# OfferGroupItem
# ---------------------------------------------------------------------------

class OfferGroupItem(models.Model):
    """A single EventListing belonging to an OfferGroup."""

    offer_group = models.ForeignKey(
        OfferGroup,
        on_delete=models.CASCADE,
        related_name="items",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="offer_memberships",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="offer_memberships",
        null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="offeritem_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["offer_group", "event_listing"],
                condition=Q(event_listing__isnull=False),
                name="uniq_offeritem_group_listing",
            ),
            models.UniqueConstraint(
                fields=["offer_group", "combo"],
                condition=Q(combo__isnull=False),
                name="uniq_offeritem_group_combo",
            ),
        ]

    def __str__(self):
        target = self.event_listing_id or f"combo={self.combo_id}"
        return f"OfferGroupItem(group={self.offer_group_id}, {target})"

    def clean(self):
        """Validate the target (listing or combo) belongs to the group's user."""
        if self.event_listing_id and \
                self.event_listing.copy.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The event listing does not belong to the offer group's user."
            )
        if self.combo_id and self.combo.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The combo does not belong to the offer group's user."
            )


# ---------------------------------------------------------------------------
# WantGroup
# ---------------------------------------------------------------------------

class WantGroup(models.Model):
    """A named set of targets the user wants, with a minimum receive bound (Y)."""

    event = models.ForeignKey(
        "events.TradeEvent",
        on_delete=models.CASCADE,
        related_name="want_groups",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="want_groups",
    )
    name         = models.CharField(max_length=120)
    min_receive  = models.PositiveIntegerField(default=1)  # Y
    # Set by the normal game-browse want builder: the solver must not award the
    # user more than one copy of the same canonical game. The advanced X-to-Y
    # builder leaves this off.
    duplicate_protection = models.BooleanField(default=False)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"WantGroup({self.name!r}, event={self.event.slug}, user={self.user.username})"


# ---------------------------------------------------------------------------
# WantGroupItem
# ---------------------------------------------------------------------------

class WantGroupItem(models.Model):
    """A specific-listing target inside a WantGroup."""

    want_group    = models.ForeignKey(
        WantGroup,
        on_delete=models.CASCADE,
        related_name="items",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="want_memberships",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="want_memberships",
        null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        # No (want_group, target) uniqueness: duplicate want targets were always
        # tolerated here (pre-combo too) and the solver export dedupes via a set
        # in external_solver._expand, so duplicates are harmless.
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="wantitem_exactly_one_target",
            ),
        ]

    def __str__(self):
        return (
            f"WantGroupItem(group={self.want_group_id}, "
            f"listing={self.event_listing_id})"
        )


# ---------------------------------------------------------------------------
# TradeWish
# ---------------------------------------------------------------------------

class TradeWish(models.Model):
    """
    Links one OfferGroup to one WantGroup (one trade intention).

    Effective bounds:
        X = offer_group.max_give
        Y = want_group.min_receive
    """

    event       = models.ForeignKey(
        "events.TradeEvent",
        on_delete=models.CASCADE,
        related_name="wishes",
    )
    user        = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wishes",
    )
    offer_group = models.ForeignKey(
        OfferGroup,
        on_delete=models.CASCADE,
        related_name="wishes",
    )
    want_group  = models.ForeignKey(
        WantGroup,
        on_delete=models.CASCADE,
        related_name="wishes",
    )
    active = models.BooleanField(default=True)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return (
            f"TradeWish(offer={self.offer_group_id}, "
            f"want={self.want_group_id}, active={self.active})"
        )


# ---------------------------------------------------------------------------
# UserGamePrice — canonical per-game price (defaults both sell ask and buy bid)
# ---------------------------------------------------------------------------

class UserGamePrice(models.Model):
    """A user's standing price for a game in an event.

    Serves as the default ask for every copy of the game they own and the
    default bid for any want targeting the game, unless a per-copy
    (EventListing.sell_price) or per-want (WantBid) override is set.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_prices"
    )
    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="game_prices"
    )
    board_game = models.ForeignKey(
        "catalog.BoardGame", on_delete=models.CASCADE, related_name="game_prices"
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "event", "board_game")]
        ordering = ["id"]

    def __str__(self):
        return f"UserGamePrice({self.user.username}, {self.board_game_id}, {self.price})"


# ---------------------------------------------------------------------------
# WantBid — per-target bid override (mirrors WantGroupItem target shape)
# ---------------------------------------------------------------------------

class WantBid(models.Model):
    """A user's bid override for one specific listing."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="want_bids"
    )
    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="want_bids"
    )
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        related_name="want_bids",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo", on_delete=models.CASCADE,
        related_name="want_bids",
        null=True, blank=True,
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="wantbid_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                condition=Q(event_listing__isnull=False),
                name="uniq_wantbid_user_event_listing",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "combo"],
                condition=Q(combo__isnull=False),
                name="uniq_wantbid_user_event_combo",
            ),
        ]
        ordering = ["id"]

    def clean(self):
        """Validate the target belongs to the same event as this bid."""
        if self.event_listing_id and self.event_listing.event_id != self.event_id:
            raise ValidationError("event_listing must belong to the same event as this bid.")
        if self.combo_id and self.combo.event_id != self.event_id:
            raise ValidationError("combo must belong to the same event as this bid.")

    def __str__(self):
        target = self.event_listing_id or f"combo={self.combo_id}"
        return f"WantBid({self.user.username}, {target}, {self.amount})"


# ---------------------------------------------------------------------------
# TradeCap — user-defined solver cap (takecap / givecap)
# ---------------------------------------------------------------------------

class TradeCap(models.Model):
    """A user-defined cap: receive (TAKE) or give (GIVE) any N items of a listed
    set of items (event listings and/or combos). Emitted to the solver as a
    `takecap`/`givecap` directive."""

    class Kind(models.TextChoices):
        TAKE = "TAKE", "Take (receive any N items)"
        GIVE = "GIVE", "Give (send any N items)"

    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="trade_caps"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trade_caps"
    )
    kind = models.CharField(max_length=4, choices=Kind.choices)
    n = models.PositiveIntegerField()

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]
        constraints = [
            models.CheckConstraint(check=Q(n__gte=1), name="tradecap_n_gte_1"),
        ]

    def __str__(self):
        return f"TradeCap({self.kind} {self.n}, user={self.user_id}, event={self.event_id})"


class TradeCapItem(models.Model):
    """One item in a TradeCap — exactly one of {event_listing, combo}."""

    cap = models.ForeignKey(
        TradeCap, on_delete=models.CASCADE, related_name="items"
    )
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        related_name="cap_memberships", null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo", on_delete=models.CASCADE,
        related_name="cap_memberships", null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="capitem_exactly_one_target",
            ),
        ]

    def __str__(self):
        target = self.event_listing_id or f"combo={self.combo_id}"
        return f"TradeCapItem(cap={self.cap_id}, {target})"
