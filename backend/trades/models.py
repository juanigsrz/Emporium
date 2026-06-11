"""
trades/models.py

F5 X-to-Y Trades models.

Models:
    OfferGroup      — named set of a user's own event listings + max_give (X).
    OfferGroupItem  — a single listing inside an OfferGroup.
    WantGroup       — named set of target games/listings + min_receive (Y).
    WantGroupItem   — a tiered, ranked target inside a WantGroup.
    TradeWish       — links one OfferGroup to one WantGroup (the trade intention).

Design: all models are event-scoped. Owner is always set to request.user at
create time; writes are owner-only. The unified X-to-Y model is the core
innovation (see DESIGN.md §4).
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


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
    )
    # Sell side of money trading: the LEAST money the owner will accept to give
    # this listing for money (Q). Null = not for sale for money. A money trade is
    # feasible only when a buyer's WantGroupItem.money_amount (P) >= this Q.
    # Placeholder for the MIP solver (not yet consumed by the matcher).
    money_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    class Meta:
        unique_together = [("offer_group", "event_listing")]
        ordering = ["id"]

    def __str__(self):
        return (
            f"OfferGroupItem(group={self.offer_group_id}, "
            f"listing={self.event_listing_id})"
        )

    def clean(self):
        """Validate that the listing's copy is owned by the offer group's user."""
        if self.event_listing.copy.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The event listing does not belong to the offer group's user."
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
    """A tiered, ranked target inside a WantGroup."""

    class TargetType(models.TextChoices):
        BOARD_GAME = "BOARD_GAME", "Board Game (any copy)"
        LISTING    = "LISTING",    "Specific Listing"

    want_group    = models.ForeignKey(
        WantGroup,
        on_delete=models.CASCADE,
        related_name="items",
    )
    target_type   = models.CharField(
        max_length=20,
        choices=TargetType.choices,
    )
    board_game    = models.ForeignKey(
        "catalog.BoardGame",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="want_group_items",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="want_memberships",
    )
    # Optional money bid: the most the user will pay to receive this game/copy.
    # Only meaningful when the event has money_enabled. Placeholder for the MIP
    # solver (not yet consumed by the matcher).
    money_amount  = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return (
            f"WantGroupItem(group={self.want_group_id}, "
            f"type={self.target_type})"
        )

    def clean(self):
        """Validate exactly one of board_game / event_listing is set, matching target_type."""
        if self.target_type == self.TargetType.BOARD_GAME:
            if not self.board_game_id:
                raise ValidationError(
                    "board_game is required when target_type is BOARD_GAME."
                )
            if self.event_listing_id:
                raise ValidationError(
                    "event_listing must be null when target_type is BOARD_GAME."
                )
        elif self.target_type == self.TargetType.LISTING:
            if not self.event_listing_id:
                raise ValidationError(
                    "event_listing is required when target_type is LISTING."
                )
            if self.board_game_id:
                raise ValidationError(
                    "board_game must be null when target_type is LISTING."
                )
        else:
            raise ValidationError(f"Unknown target_type: {self.target_type}")


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
    """A user's bid override for one target (a game or a specific listing)."""

    class TargetType(models.TextChoices):
        BOARD_GAME = "BOARD_GAME", "Board Game (any copy)"
        LISTING    = "LISTING",    "Specific Listing"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="want_bids"
    )
    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="want_bids"
    )
    target_type = models.CharField(max_length=20, choices=TargetType.choices)
    board_game = models.ForeignKey(
        "catalog.BoardGame", on_delete=models.CASCADE,
        null=True, blank=True, related_name="want_bids",
    )
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        null=True, blank=True, related_name="want_bids",
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event", "board_game"],
                condition=models.Q(board_game__isnull=False),
                name="uniq_wantbid_user_event_game",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                condition=models.Q(event_listing__isnull=False),
                name="uniq_wantbid_user_event_listing",
            ),
        ]
        ordering = ["id"]

    def clean(self):
        if self.target_type == self.TargetType.BOARD_GAME:
            if not self.board_game_id:
                raise ValidationError("board_game is required when target_type is BOARD_GAME.")
            if self.event_listing_id:
                raise ValidationError("event_listing must be null when target_type is BOARD_GAME.")
        elif self.target_type == self.TargetType.LISTING:
            if not self.event_listing_id:
                raise ValidationError("event_listing is required when target_type is LISTING.")
            if self.board_game_id:
                raise ValidationError("board_game must be null when target_type is LISTING.")
        else:
            raise ValidationError(f"Unknown target_type: {self.target_type}")

    def __str__(self):
        return f"WantBid({self.user.username}, {self.target_type}, {self.amount})"
