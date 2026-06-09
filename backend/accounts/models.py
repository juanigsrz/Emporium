"""
accounts/models.py

F1 User Accounts models.

Placeholder FK notes
--------------------
Wishlist.board_game_bgg_id  — PositiveIntegerField (BGG id).
    TODO F2: replace with FK(catalog.BoardGame) once BoardGame exists.
    unique_together uses (user, board_game_bgg_id) to mirror the data model intent.

TradeRating.event_id — PositiveIntegerField (TradeEvent pk).
    TODO F4: replace with FK(events.TradeEvent) once TradeEvent exists.
    unique_together uses (event_id, rater, ratee) to mirror the data model intent.

These integer fields will be migrated to real FKs in F2 / F4 respectively.
"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Profile(models.Model):
    """One-to-one extension of auth.User with trade-platform profile data."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        primary_key=True,
    )
    display_name = models.CharField(max_length=80, blank=True)
    bgg_username = models.CharField(max_length=64, blank=True)
    bio = models.TextField(blank=True)
    location = models.CharField(max_length=120, blank=True)
    region = models.CharField(max_length=64, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    max_trade_distance_km = models.PositiveIntegerField(null=True, blank=True)
    avatar_url = models.URLField(blank=True)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile({self.user.username})"


class UserBlock(models.Model):
    """A blocked pair — the pair is never matched together."""

    blocker = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="blocks_made",
    )
    blocked = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="blocks_against",
    )

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("blocker", "blocked")]
        ordering = ["-created"]

    def __str__(self):
        return f"UserBlock({self.blocker} → {self.blocked})"


class Wishlist(models.Model):
    """
    General (event-independent) wishlist entry.

    board_game_bgg_id stores the BGG integer id of the desired game.
    TODO F2: convert board_game_bgg_id to FK(catalog.BoardGame, related='wishlist_entries').
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wishlist_entries",
    )
    # Placeholder: BGG integer id until catalog.BoardGame exists.
    board_game_bgg_id = models.PositiveIntegerField(
        help_text="BGG id — TODO F2: convert to FK(catalog.BoardGame)"
    )
    note = models.CharField(max_length=200, blank=True)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "board_game_bgg_id")]
        ordering = ["-created"]

    def __str__(self):
        return f"Wishlist({self.user}, bgg_id={self.board_game_bgg_id})"


class TradeRating(models.Model):
    """
    Rating left by one user for another after a trade event.

    event_id stores the TradeEvent pk as a plain integer.
    TODO F4: convert event_id to FK(events.TradeEvent, related='ratings').
    """

    # Placeholder: TradeEvent pk until events.TradeEvent exists.
    event_id = models.PositiveIntegerField(
        help_text="TradeEvent pk — TODO F4: convert to FK(events.TradeEvent)"
    )
    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ratings_given",
    )
    ratee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ratings_received",
    )
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField(blank=True)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("event_id", "rater", "ratee")]
        ordering = ["-created"]

    def __str__(self):
        return f"TradeRating({self.rater} → {self.ratee}, score={self.score})"
