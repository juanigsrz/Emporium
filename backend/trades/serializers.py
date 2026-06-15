"""
trades/serializers.py

Serializers for F5 X-to-Y Trades.

Field-naming convention (matches the rest of the codebase):
  - FK id fields: `offer_group` (int), `want_group` (int), `event_listing` (int),
    `board_game` (int/bgg_id)
  - Human display companions: `offer_group_name`, `want_group_name`,
    `listing_code`, `board_game_name`, `board_game_id`

OfferGroup output fields:
    id, event, user, user_username, name, max_give, rules,
    items: [{id, event_listing, listing_code, board_game_name, board_game_id}],
    created, updated

WantGroup output fields:
    id, event, user, user_username, name, min_receive,
    items: [{id, event_listing, listing_code, board_game_name,
             board_game_id, board_game_thumbnail}],
    created, updated

TradeWish output fields:
    id, event, user, user_username,
    offer_group (id), offer_group_name, max_give,
    want_group (id), want_group_name, min_receive,
    active, created, updated
"""

from django.db import transaction
from rest_framework import serializers

from events.models import EventListing
from catalog.models import BoardGame
from .models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, UserGamePrice, WantBid


# ---------------------------------------------------------------------------
# UserGamePrice
# ---------------------------------------------------------------------------

class UserGamePriceSerializer(serializers.ModelSerializer):
    board_game = serializers.PrimaryKeyRelatedField(
        queryset=BoardGame.objects.all(), pk_field=serializers.IntegerField()
    )
    board_game_name = serializers.CharField(source="board_game.name", read_only=True)

    class Meta:
        model = UserGamePrice
        fields = ["id", "board_game", "board_game_name", "price", "updated"]
        read_only_fields = ["id", "board_game_name", "updated"]

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("price must be greater than 0.")
        return value


# ---------------------------------------------------------------------------
# WantBid
# ---------------------------------------------------------------------------

class WantBidSerializer(serializers.ModelSerializer):
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.all(), pk_field=serializers.IntegerField(),
    )

    class Meta:
        model = WantBid
        fields = ["id", "event_listing", "amount", "updated"]
        read_only_fields = ["id", "updated"]

    def validate(self, data):
        if data.get("amount") is not None and data["amount"] < 0:
            raise serializers.ValidationError({"amount": "amount cannot be negative."})
        return data


# ---------------------------------------------------------------------------
# OfferGroupItem
# ---------------------------------------------------------------------------

class OfferGroupItemSerializer(serializers.ModelSerializer):
    """Read-only nested item; shows listing identity fields."""

    listing_code    = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
    board_game_name = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_id   = serializers.IntegerField(
        source="event_listing.copy.board_game.bgg_id", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")

    class Meta:
        model = OfferGroupItem
        fields = [
            "id",
            "event_listing",   # id (int)
            "listing_code",
            "board_game_name",
            "board_game_id",
            "board_game_thumbnail",
        ]
        read_only_fields = fields


# ---------------------------------------------------------------------------
# OfferGroup
# ---------------------------------------------------------------------------

class OfferGroupSerializer(serializers.ModelSerializer):
    """
    Read: full group + nested items.
    Write (POST): name, max_give, item_listing_ids  (list of EventListing pks).
    Write (PATCH): name, max_give, item_listing_ids (any subset; missing → no change).
    """

    user          = serializers.PrimaryKeyRelatedField(read_only=True)
    user_username = serializers.SerializerMethodField()
    items         = OfferGroupItemSerializer(many=True, read_only=True)

    # Write-only: list of EventListing ids to add/replace items
    item_listing_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        default=list,
    )

    class Meta:
        model = OfferGroup
        fields = [
            "id",
            "event",
            "user",
            "user_username",
            "name",
            "max_give",
            "rules",
            "items",
            "item_listing_ids",
            "created",
            "updated",
        ]
        read_only_fields = [
            "id",
            "event",
            "user",
            "user_username",
            "items",
            "created",
            "updated",
        ]

    def get_user_username(self, obj):
        return obj.user.username

    def _resolve_listings(self, listing_ids, event, user):
        """
        Validate and return EventListing queryset for the given ids.
        Raises ValidationError if any listing is not found in this event
        or not owned by the user.
        """
        if not listing_ids:
            return []

        listings = EventListing.objects.select_related(
            "copy", "copy__owner", "copy__board_game"
        ).filter(id__in=listing_ids, event=event)

        found_ids = {el.id for el in listings}
        missing = set(listing_ids) - found_ids
        if missing:
            raise serializers.ValidationError(
                {"item_listing_ids": f"EventListing ids not found in this event: {sorted(missing)}"}
            )

        not_owned = [el.id for el in listings if el.copy.owner_id != user.id]
        if not_owned:
            raise serializers.ValidationError(
                {"item_listing_ids": f"Listings not owned by you: {not_owned}"}
            )

        return list(listings)

    @transaction.atomic
    def create(self, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", [])
        event = validated_data["event"]
        user  = validated_data["user"]

        listings = self._resolve_listings(listing_ids, event, user)
        group = OfferGroup.objects.create(**validated_data)

        for el in listings:
            OfferGroupItem.objects.create(offer_group=group, event_listing=el)

        return group

    @transaction.atomic
    def update(self, instance, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", None)
        event = instance.event
        user  = instance.user

        # Update scalar fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Replace item set only if item_listing_ids was provided
        if listing_ids is not None:
            listings = self._resolve_listings(listing_ids, event, user)
            instance.items.all().delete()
            for el in listings:
                OfferGroupItem.objects.create(offer_group=instance, event_listing=el)

        return instance


# ---------------------------------------------------------------------------
# WantGroupItem
# ---------------------------------------------------------------------------

class WantGroupItemSerializer(serializers.ModelSerializer):
    """
    Used both for nested read output and for the items list in WantGroup writes.

    Read:
        id, board_game_name, board_game_id (bgg_id), board_game_thumbnail,
        event_listing (id), listing_code

    Write (nested in WantGroup):
        event_listing (id)

    Wants are binary — no priority/tier/rank. Items keep insertion order.
    """

    # Display-only companions (derived from the listing's copy)
    board_game_name      = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_id        = serializers.IntegerField(
        source="event_listing.copy.board_game_id", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()
    listing_code         = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
    resolved_bid         = serializers.SerializerMethodField()
    bid_is_override      = serializers.SerializerMethodField()

    # Writable FK reference
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.select_related("copy", "copy__board_game").all(),
    )

    class Meta:
        model = WantGroupItem
        fields = [
            "id",
            "board_game_name",
            "board_game_id",        # canonical bgg_id (FE grouping)
            "board_game_thumbnail",
            "event_listing",        # EventListing pk int
            "listing_code",
            "resolved_bid",
            "bid_is_override",
        ]
        read_only_fields = ["id", "board_game_name", "board_game_id", "board_game_thumbnail",
                            "listing_code", "resolved_bid", "bid_is_override"]

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")

    # Per-item DB lookups; want-lists are per-user and small, so N+1 here is acceptable.
    def get_resolved_bid(self, obj):
        from trades.pricing import resolve_bid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return None
        v = resolve_bid(obj.want_group.user, event, obj)
        return f"{v:.2f}" if v is not None else None

    def get_bid_is_override(self, obj):
        from trades.models import WantBid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return False
        return WantBid.objects.filter(
            user=obj.want_group.user, event=event,
            event_listing_id=obj.event_listing_id,
        ).exists()


# ---------------------------------------------------------------------------
# WantGroup
# ---------------------------------------------------------------------------

class WantGroupSerializer(serializers.ModelSerializer):
    """
    Read: full group + nested items (insertion order — wants are binary).
    Write (POST): name, min_receive, items (list of item dicts).
    Write (PATCH): name, min_receive, items (REPLACES entire item list when provided).
    """

    user          = serializers.PrimaryKeyRelatedField(read_only=True)
    user_username = serializers.SerializerMethodField()
    items         = WantGroupItemSerializer(many=True, required=False, default=list)

    class Meta:
        model = WantGroup
        fields = [
            "id",
            "event",
            "user",
            "user_username",
            "name",
            "min_receive",
            "duplicate_protection",
            "items",
            "created",
            "updated",
        ]
        read_only_fields = [
            "id",
            "event",
            "user",
            "user_username",
            "created",
            "updated",
        ]

    def get_user_username(self, obj):
        return obj.user.username

    def _validate_and_build_items(self, items_data):
        """Run the per-item serializer validation and return validated dicts."""
        validated = []
        for idx, item_data in enumerate(items_data):
            s = WantGroupItemSerializer(data=item_data)
            if not s.is_valid():
                raise serializers.ValidationError(
                    {f"items[{idx}]": s.errors}
                )
            validated.append(s.validated_data)
        return validated

    def _create_items(self, group, validated_items):
        for item_data in validated_items:
            WantGroupItem.objects.create(want_group=group, **item_data)

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        group = WantGroup.objects.create(**validated_data)
        self._create_items(group, items_data)
        return group

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Replace item set only when 'items' key was present in PATCH body
        if items_data is not None:
            instance.items.all().delete()
            self._create_items(instance, items_data)

        return instance

    def to_internal_value(self, data):
        """
        Items are nested dicts — validate them here so errors surface nicely.
        We override to_internal_value to run WantGroupItemSerializer on the
        nested list before the parent's field-level validation.
        """
        ret = super().to_internal_value(data)
        # super() already ran WantGroupItemSerializer on each item via the
        # declared field (many=True); if items were provided they are in ret.
        return ret


# ---------------------------------------------------------------------------
# TradeWish
# ---------------------------------------------------------------------------

class TradeWishSerializer(serializers.ModelSerializer):
    """
    Read: wish with X/Y display from the linked groups.
    Write: offer_group (id), want_group (id), active.
    Validation: both groups must belong to this event AND this user.
    """

    user          = serializers.PrimaryKeyRelatedField(read_only=True)
    user_username = serializers.SerializerMethodField()

    # FK ids (writable)
    offer_group = serializers.PrimaryKeyRelatedField(
        queryset=OfferGroup.objects.all()
    )
    want_group  = serializers.PrimaryKeyRelatedField(
        queryset=WantGroup.objects.all()
    )

    # Display companions (read-only)
    offer_group_name = serializers.SerializerMethodField()
    want_group_name  = serializers.SerializerMethodField()
    max_give         = serializers.SerializerMethodField()   # X
    min_receive      = serializers.SerializerMethodField()   # Y

    class Meta:
        model = TradeWish
        fields = [
            "id",
            "event",
            "user",
            "user_username",
            "offer_group",
            "offer_group_name",
            "max_give",
            "want_group",
            "want_group_name",
            "min_receive",
            "active",
            "created",
            "updated",
        ]
        read_only_fields = [
            "id",
            "event",
            "user",
            "user_username",
            "offer_group_name",
            "want_group_name",
            "max_give",
            "min_receive",
            "created",
            "updated",
        ]

    def get_user_username(self, obj):
        return obj.user.username

    def get_offer_group_name(self, obj):
        return obj.offer_group.name

    def get_want_group_name(self, obj):
        return obj.want_group.name

    def get_max_give(self, obj):
        return obj.offer_group.max_give

    def get_min_receive(self, obj):
        return obj.want_group.min_receive

    def _get_event(self):
        """Get the event from the view's kwargs (passed in serializer context)."""
        request = self.context.get("request")
        event   = self.context.get("event")
        return event

    def validate(self, data):
        event = self._get_event()
        user  = self.context["request"].user

        offer_group = data.get("offer_group", getattr(self.instance, "offer_group", None))
        want_group  = data.get("want_group",  getattr(self.instance, "want_group",  None))

        if offer_group and offer_group.event_id != event.id:
            raise serializers.ValidationError(
                {"offer_group": "This offer group does not belong to the current event."}
            )
        if offer_group and offer_group.user_id != user.id:
            raise serializers.ValidationError(
                {"offer_group": "This offer group does not belong to you."}
            )
        if want_group and want_group.event_id != event.id:
            raise serializers.ValidationError(
                {"want_group": "This want group does not belong to the current event."}
            )
        if want_group and want_group.user_id != user.id:
            raise serializers.ValidationError(
                {"want_group": "This want group does not belong to you."}
            )

        return data
