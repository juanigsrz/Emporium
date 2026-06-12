"""
matching/serializers.py

Serializers for F6 Matching endpoints.

Field-naming convention (FE relies on it):
  FK ids:        match_run (int), event_listing (int), giver (int), receiver (int), wish (int)
  Display companions:
    giver_username, receiver_username   — for giver/receiver FKs
    listing_code                        — for event_listing FK
    board_game_name                     — for the game in the listing

MatchRun list:
    id, event, status, algorithm, started_at, finished_at, summary, created, updated

MatchRun detail:
    id, event, status, algorithm, started_at, finished_at, summary, log, created, updated

MatchRun result:
    (raw result JSON — returned directly, not via serializer)

TradeAssignment (mine):
    id, match_run, cycle_id,
    event_listing, listing_code, board_game_name,
    giver, giver_username,
    receiver, receiver_username,
    wish, created
"""

from rest_framework import serializers

from .models import MatchRun, TradeAssignment, Shipment


# ---------------------------------------------------------------------------
# MatchRun
# ---------------------------------------------------------------------------

class MatchRunListSerializer(serializers.ModelSerializer):
    """Compact representation for list views (no log)."""

    class Meta:
        model = MatchRun
        fields = [
            "id",
            "event",
            "status",
            "algorithm",
            "started_at",
            "finished_at",
            "summary",
            "created",
            "updated",
        ]
        read_only_fields = fields


class MatchRunDetailSerializer(serializers.ModelSerializer):
    """Full representation including log (for detail/polling)."""

    class Meta:
        model = MatchRun
        fields = [
            "id",
            "event",
            "status",
            "algorithm",
            "started_at",
            "finished_at",
            "summary",
            "log",
            "created",
            "updated",
        ]
        read_only_fields = fields


# ---------------------------------------------------------------------------
# TradeAssignment (mine view)
# ---------------------------------------------------------------------------

class TradeAssignmentSerializer(serializers.ModelSerializer):
    """
    Serializer for a single TradeAssignment, with display companions so the
    UI can render "you give <listing_code> to <receiver_username> / you receive
    <listing_code> from <giver_username>".
    """

    # Display companions for giver/receiver FKs
    giver_username    = serializers.CharField(source="giver.username",    read_only=True)
    receiver_username = serializers.CharField(source="receiver.username", read_only=True)

    # Display companions for event_listing FK
    listing_code    = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
    board_game_name = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = TradeAssignment
        fields = [
            "id",
            "match_run",
            "cycle_id",
            "event_listing",
            "listing_code",
            "board_game_name",
            "board_game_thumbnail",
            "giver",
            "giver_username",
            "receiver",
            "receiver_username",
            "wish",
            "cash_amount",
            "item_value",
            "created",
        ]
        read_only_fields = fields

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")


# ---------------------------------------------------------------------------
# Shipment
# ---------------------------------------------------------------------------

class ShipmentSerializer(serializers.ModelSerializer):
    listing_code         = serializers.CharField(source="assignment.event_listing.copy.listing_code", read_only=True)
    board_game_name      = serializers.CharField(source="assignment.event_listing.copy.board_game.name", read_only=True)
    board_game_thumbnail = serializers.SerializerMethodField()
    giver_username       = serializers.CharField(source="assignment.giver.username", read_only=True)
    receiver_username    = serializers.CharField(source="assignment.receiver.username", read_only=True)
    my_role              = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = ["id", "status", "shipping_info", "listing_code", "board_game_name",
                  "board_game_thumbnail", "giver_username", "receiver_username", "my_role",
                  "sent_at", "received_at"]
        read_only_fields = ["id", "listing_code", "board_game_name", "board_game_thumbnail",
                            "giver_username", "receiver_username", "my_role", "sent_at", "received_at"]

    def get_board_game_thumbnail(self, obj):
        return (obj.assignment.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")

    def get_my_role(self, obj):
        uid = self.context["request"].user.id
        if obj.assignment.giver_id == uid: return "sender"
        if obj.assignment.receiver_id == uid: return "receiver"
        return None
