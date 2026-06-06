"""
accounts/serializers.py

Serializers for Profile, UserBlock, Wishlist, TradeRating.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Profile, TradeRating, UserBlock, Wishlist

User = get_user_model()


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
            "created",
            "updated",
        ]
        read_only_fields = ["username", "email", "created", "updated"]

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
