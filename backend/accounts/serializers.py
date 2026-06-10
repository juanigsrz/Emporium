"""
accounts/serializers.py

Serializers for Profile, UserBlock, Wishlist, TradeRating.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .geo import geocode
from catalog.models import BoardGame
from .models import GameRating, Profile, TradeRating, UserBlock, Wishlist

User = get_user_model()


# ---------------------------------------------------------------------------
# GameRating
# ---------------------------------------------------------------------------

class GameRatingSerializer(serializers.ModelSerializer):
    board_game = serializers.PrimaryKeyRelatedField(queryset=BoardGame.objects.all())
    board_game_name = serializers.CharField(source="board_game.name", read_only=True)

    class Meta:
        model = GameRating
        fields = ["id", "board_game", "board_game_name", "value", "created", "updated"]
        read_only_fields = ["id", "board_game_name", "created", "updated"]

    def validate_value(self, v):
        if v < 1 or v > 10:
            raise serializers.ValidationError("Rating must be between 1 and 10.")
        return v


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

class ProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)

    # Ratings summary — computed on demand
    ratings_count = serializers.SerializerMethodField()
    average_score = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = [
            "username",
            "email",
            "display_name",
            "bgg_username",
            "bio",
            "location",
            "region",
            "avatar_url",
            "ratings_count",
            "average_score",
            "latitude",
            "longitude",
            "max_trade_distance_km",
            "created",
            "updated",
        ]
        read_only_fields = ["username", "email", "created", "updated"]

    def update(self, instance, validated_data):
        lat = validated_data.pop("latitude", None)
        lon = validated_data.pop("longitude", None)
        new_location = validated_data.get("location", instance.location)
        location_changed = "location" in validated_data and new_location != instance.location
        instance = super().update(instance, validated_data)
        if lat is not None and lon is not None:
            # Explicit coords provided — use them directly, skip geocode
            instance.latitude, instance.longitude = lat, lon
            instance.save(update_fields=["latitude", "longitude", "updated"])
        elif location_changed:
            if new_location.strip():
                try:
                    coords = geocode(new_location)
                except Exception:  # noqa: BLE001 — propagate as ValidationError below
                    coords = None
                if coords is None:
                    raise serializers.ValidationError(
                        {"location": "Couldn't resolve this location to coordinates. Pick a suggestion from the dropdown or refine the text."}
                    )
                instance.latitude, instance.longitude = coords
            else:
                instance.latitude = instance.longitude = None
            instance.save(update_fields=["latitude", "longitude", "updated"])
        return instance

    def get_ratings_count(self, obj):
        return obj.user.ratings_received.count()

    def get_average_score(self, obj):
        qs = obj.user.ratings_received.values_list("score", flat=True)
        if not qs:
            return None
        return round(sum(qs) / len(qs), 2)


# ---------------------------------------------------------------------------
# UserBlock
# ---------------------------------------------------------------------------

class UserBlockSerializer(serializers.ModelSerializer):
    blocker = serializers.SlugRelatedField(slug_field="username", read_only=True)
    blocked = serializers.SlugRelatedField(
        slug_field="username",
        queryset=User.objects.all(),
    )

    class Meta:
        model = UserBlock
        fields = ["id", "blocker", "blocked", "created"]
        read_only_fields = ["id", "blocker", "created"]

    def validate(self, attrs):
        request = self.context["request"]
        if attrs.get("blocked") == request.user:
            raise serializers.ValidationError("You cannot block yourself.")
        return attrs


# ---------------------------------------------------------------------------
# Wishlist
# ---------------------------------------------------------------------------

class WishlistSerializer(serializers.ModelSerializer):
    user = serializers.SlugRelatedField(slug_field="username", read_only=True)

    class Meta:
        model = Wishlist
        fields = ["id", "user", "board_game_bgg_id", "note", "created", "updated"]
        read_only_fields = ["id", "user", "created", "updated"]

    def validate(self, attrs):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            bgg_id = attrs.get("board_game_bgg_id")
            if bgg_id is not None and Wishlist.objects.filter(
                user=request.user, board_game_bgg_id=bgg_id
            ).exists():
                raise serializers.ValidationError(
                    {"board_game_bgg_id": "You already have this game in your wishlist."}
                )
        return attrs


# ---------------------------------------------------------------------------
# TradeRating
# ---------------------------------------------------------------------------

class TradeRatingSerializer(serializers.ModelSerializer):
    rater = serializers.SlugRelatedField(slug_field="username", read_only=True)
    ratee = serializers.SlugRelatedField(
        slug_field="username",
        queryset=User.objects.all(),
    )

    class Meta:
        model = TradeRating
        fields = [
            "id",
            "event_id",
            "rater",
            "ratee",
            "score",
            "comment",
            "created",
            "updated",
        ]
        read_only_fields = ["id", "rater", "created", "updated"]

    def validate(self, attrs):
        request = self.context["request"]
        if attrs.get("ratee") == request.user:
            raise serializers.ValidationError("You cannot rate yourself.")
        return attrs
