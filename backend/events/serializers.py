"""
events/serializers.py

Serializers for F4 Trade Events:
    TradeEventSerializer      — full event repr; includes computed fields:
                                 allowed_transitions, participants_count,
                                 is_organizer, is_participant.
    EventParticipationSerializer — participation repr.
    EventListingSerializer    — listing repr.
    TransitionSerializer      — for the POST /transition/ action body.
"""

from rest_framework import serializers

from .models import EventListing, EventParticipation, TradeEvent


class TradeEventSerializer(serializers.ModelSerializer):
    # Read-only derived
    organizer = serializers.PrimaryKeyRelatedField(read_only=True)
    organizer_username = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    participants_count  = serializers.SerializerMethodField()
    is_organizer        = serializers.SerializerMethodField()
    is_participant      = serializers.SerializerMethodField()
    inputs_locked       = serializers.BooleanField(read_only=True)

    class Meta:
        model = TradeEvent
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "organizer",
            "organizer_username",
            "status",
            "money_enabled",
            "max_money_per_user",
            "require_location",
            "center_latitude",
            "center_longitude",
            "max_distance_km",
            "submissions_open_at",
            "submissions_close_at",
            "wantlist_close_at",
            "shipping_rules",
            "regional_restrictions",
            "trade_policies",
            "algorithm_settings",
            "allowed_transitions",
            "participants_count",
            "is_organizer",
            "is_participant",
            "inputs_locked",
            "created",
            "updated",
        ]
        read_only_fields = [
            "id",
            "slug",
            "organizer",
            "organizer_username",
            "status",
            "allowed_transitions",
            "participants_count",
            "is_organizer",
            "is_participant",
            "inputs_locked",
            "created",
            "updated",
        ]

    def validate_max_money_per_user(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("max_money_per_user cannot be negative.")
        return value

    def get_organizer_username(self, obj):
        return obj.organizer.username

    def get_allowed_transitions(self, obj):
        return obj.allowed_transitions_list

    def get_participants_count(self, obj):
        return obj.participations.count()

    def _request_user(self):
        """Return the request user if available (context may be absent in tests)."""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            return request.user
        return None

    def get_is_organizer(self, obj):
        user = self._request_user()
        if user is None:
            return False
        return obj.organizer_id == user.pk

    def get_is_participant(self, obj):
        user = self._request_user()
        if user is None:
            return False
        return obj.participations.filter(user=user).exists()


class EventParticipationSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(read_only=True)
    username = serializers.SerializerMethodField()

    class Meta:
        model = EventParticipation
        fields = [
            "id",
            "event",
            "user",
            "username",
            "region",
            "shipping_pref",
            "max_spend",
            "created",
        ]
        read_only_fields = ["id", "event", "user", "username", "created"]

    def get_username(self, obj):
        return obj.user.username


class EventListingSerializer(serializers.ModelSerializer):
    # Expose the copy id for write; show extra info for reads
    copy_id          = serializers.IntegerField(source="copy.id", read_only=True)
    listing_code     = serializers.CharField(source="copy.listing_code", read_only=True)
    board_game_id    = serializers.IntegerField(source="copy.board_game_id", read_only=True)
    board_game_name  = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()
    copy_owner_id    = serializers.IntegerField(source="copy.owner_id", read_only=True)
    copy_owner_username = serializers.SerializerMethodField()
    # Lightweight distinguishers so copy chips can be told apart at a glance
    # (e.g. a different language or condition). Full detail is on /copies/{id}/.
    copy_condition   = serializers.CharField(source="copy.condition", read_only=True)
    copy_language    = serializers.CharField(source="copy.language", read_only=True)
    owner_too_far    = serializers.SerializerMethodField()

    # Writable: accept copy pk on create
    copy = serializers.PrimaryKeyRelatedField(
        queryset=__import__("copies.models", fromlist=["Copy"]).Copy.objects.all(),
        write_only=True,
    )
    sell_price      = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    resolved_ask    = serializers.SerializerMethodField()
    ask_is_override = serializers.SerializerMethodField()

    def get_resolved_ask(self, obj):
        from trades.pricing import resolve_ask
        v = resolve_ask(obj)
        return f"{v:.2f}" if v is not None else None

    def get_ask_is_override(self, obj):
        return obj.sell_price is not None

    def validate_sell_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("sell_price cannot be negative.")
        return value

    class Meta:
        model = EventListing
        fields = [
            "id",
            "event",
            "copy",
            "copy_id",
            "listing_code",
            "board_game_id",
            "board_game_name",
            "board_game_thumbnail",
            "copy_owner_id",
            "copy_owner_username",
            "copy_condition",
            "copy_language",
            "owner_too_far",
            "active",
            "sell_price",
            "resolved_ask",
            "ask_is_override",
            "created",
        ]
        read_only_fields = [
            "id",
            "event",
            "copy_id",
            "listing_code",
            "board_game_id",
            "board_game_name",
            "board_game_thumbnail",
            "copy_owner_id",
            "copy_owner_username",
            "copy_condition",
            "copy_language",
            "owner_too_far",
            "resolved_ask",
            "ask_is_override",
            "created",
        ]

    def get_board_game_name(self, obj):
        return obj.copy.board_game.name

    def get_board_game_thumbnail(self, obj):
        return (obj.copy.board_game.metadata or {}).get("thumbnail", "")

    def get_copy_owner_username(self, obj):
        return obj.copy.owner.username

    def get_owner_too_far(self, obj):
        req = self.context.get("request")
        me = getattr(getattr(req, "user", None), "profile", None)
        if not me or me.max_trade_distance_km is None or me.latitude is None or me.longitude is None:
            return False
        from accounts.geo import haversine_km
        op = getattr(obj.copy.owner, "profile", None)
        if not op or op.latitude is None or op.longitude is None:
            return False
        return haversine_km(me.latitude, me.longitude, op.latitude, op.longitude) > me.max_trade_distance_km


class EventGameSerializer(serializers.Serializer):
    """A canonical game that has active copies listed in this event.

    Read-only. `copies_count` is the number of active EventListings of this game
    *within the event* (annotated on the queryset). Powers the event-scoped
    catalog used by the want-list builder.
    """

    bgg_id         = serializers.IntegerField()
    name           = serializers.CharField()
    year_published = serializers.IntegerField(allow_null=True)
    rank           = serializers.IntegerField(allow_null=True)
    average        = serializers.FloatField(allow_null=True)
    image_url      = serializers.CharField(allow_blank=True)
    thumbnail      = serializers.SerializerMethodField()
    copies_count   = serializers.IntegerField()

    def get_thumbnail(self, obj):
        return (obj.metadata or {}).get("thumbnail", "")


class TransitionSerializer(serializers.Serializer):
    to = serializers.CharField()

    def validate_to(self, value):
        # Must be a known status
        valid_statuses = [s.value for s in TradeEvent.Status]
        if value not in valid_statuses:
            raise serializers.ValidationError(
                f"'{value}' is not a valid status. "
                f"Choices: {valid_statuses}"
            )
        return value
