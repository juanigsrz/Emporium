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

from .models import MatchRun, TradeAssignment, Shipment, SettlementPayment


# ---------------------------------------------------------------------------
# Shared item-display helpers (a moved item is a single listing OR a combo)
# ---------------------------------------------------------------------------

def _target_game_name(assignment):
    """Display name of the moved item: the listing's game, or the combo's
    member game names joined. None only if neither target is set."""
    if assignment.event_listing_id:
        return assignment.event_listing.copy.board_game.name
    if assignment.combo_id:
        return ", ".join(
            ci.event_listing.copy.board_game.name
            for ci in assignment.combo.items.all()
        )
    return None


def _target_thumbnail(assignment):
    """Thumbnail for the moved item: the listing's game thumbnail, or the first
    combo member's. Empty string when unavailable."""
    if assignment.event_listing_id:
        return (assignment.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
    if assignment.combo_id:
        members = list(assignment.combo.items.all())
        if members:
            return (members[0].event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
    return ""


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

    A row targets EITHER a single event_listing OR a combo (a bundle of the
    owner's listings); combo rows carry a null event_listing, so the
    listing-derived companions fall back to combo fields (combo_code, members,
    joined member game names).
    """

    # Display companions for giver/receiver FKs
    giver_username    = serializers.CharField(source="giver.username",    read_only=True)
    receiver_username = serializers.CharField(source="receiver.username", read_only=True)

    # Display companions for the moved item (event_listing OR combo)
    copy_id              = serializers.SerializerMethodField()
    listing_code         = serializers.SerializerMethodField()
    combo_code           = serializers.SerializerMethodField()
    combo_name           = serializers.SerializerMethodField()
    members              = serializers.SerializerMethodField()
    board_game_name      = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = TradeAssignment
        fields = [
            "id",
            "match_run",
            "cycle_id",
            "event_listing",
            "combo",
            "copy_id",
            "listing_code",
            "combo_code",
            "combo_name",
            "members",
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

    def get_copy_id(self, obj):
        return obj.event_listing.copy.id if obj.event_listing_id else None

    def get_listing_code(self, obj):
        return obj.event_listing.copy.listing_code if obj.event_listing_id else None

    def get_combo_code(self, obj):
        return obj.combo.combo_code if obj.combo_id else None

    def get_combo_name(self, obj):
        return obj.combo.name if obj.combo_id else None

    def get_members(self, obj):
        if not obj.combo_id:
            return None
        return [ci.event_listing.copy.listing_code for ci in obj.combo.items.all()]

    def get_board_game_name(self, obj):
        return _target_game_name(obj)

    def get_board_game_thumbnail(self, obj):
        return _target_thumbnail(obj)


# ---------------------------------------------------------------------------
# Shipment
# ---------------------------------------------------------------------------

class ShipmentSerializer(serializers.ModelSerializer):
    listing_code         = serializers.SerializerMethodField()
    combo_code           = serializers.SerializerMethodField()
    combo_name           = serializers.SerializerMethodField()
    members              = serializers.SerializerMethodField()
    board_game_name      = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()
    giver_username       = serializers.CharField(source="assignment.giver.username", read_only=True)
    receiver_username    = serializers.CharField(source="assignment.receiver.username", read_only=True)
    my_role              = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = ["id", "status", "shipping_info", "listing_code", "combo_code",
                  "combo_name", "members", "board_game_name",
                  "board_game_thumbnail", "giver_username", "receiver_username", "my_role",
                  "sent_at", "received_at"]
        read_only_fields = ["id", "listing_code", "combo_code", "combo_name", "members",
                            "board_game_name", "board_game_thumbnail",
                            "giver_username", "receiver_username", "my_role", "sent_at", "received_at"]

    def get_listing_code(self, obj):
        a = obj.assignment
        return a.event_listing.copy.listing_code if a.event_listing_id else None

    def get_combo_code(self, obj):
        a = obj.assignment
        return a.combo.combo_code if a.combo_id else None

    def get_combo_name(self, obj):
        a = obj.assignment
        return a.combo.name if a.combo_id else None

    def get_members(self, obj):
        a = obj.assignment
        if not a.combo_id:
            return None
        return [ci.event_listing.copy.listing_code for ci in a.combo.items.all()]

    def get_board_game_name(self, obj):
        return _target_game_name(obj.assignment)

    def get_board_game_thumbnail(self, obj):
        return _target_thumbnail(obj.assignment)

    def get_my_role(self, obj):
        uid = self.context["request"].user.id
        if obj.assignment.giver_id == uid: return "sender"
        if obj.assignment.receiver_id == uid: return "receiver"
        return None


# ---------------------------------------------------------------------------
# SettlementPayment
# ---------------------------------------------------------------------------

class SettlementPaymentSerializer(serializers.ModelSerializer):
    from_username = serializers.CharField(source="from_user.username", read_only=True)
    to_username   = serializers.CharField(source="to_user.username", read_only=True)
    my_role       = serializers.SerializerMethodField()

    class Meta:
        model = SettlementPayment
        fields = ["id", "status", "amount", "note", "from_username",
                  "to_username", "my_role", "paid_at", "confirmed_at"]
        read_only_fields = fields

    def get_my_role(self, obj):
        uid = self.context["request"].user.id
        if obj.from_user_id == uid:
            return "payer"
        if obj.to_user_id == uid:
            return "payee"
        return None
