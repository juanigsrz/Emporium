"""
copies/serializers.py

CopySerializer — full representation of a Copy instance.

Design choices:
- listing_code is read_only (always server-generated).
- owner is read_only (set from request.user in the view).
- board_game_name is a SerializerMethodField for display convenience; the
  writable FK is accepted as board_game (the bgg_id integer).
- On create the view passes owner=request.user; serializer must accept it
  via the field being excluded from required client input.
"""

from rest_framework import serializers

from catalog.models import BoardGame
from .models import Copy


class CopySerializer(serializers.ModelSerializer):
    # Read-only derived fields
    listing_code = serializers.CharField(read_only=True)
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_username = serializers.SerializerMethodField()

    # board_game accepts bgg_id on write; expose name for display on read
    board_game = serializers.PrimaryKeyRelatedField(
        queryset=BoardGame.objects.all(),
    )
    board_game_name = serializers.SerializerMethodField()

    class Meta:
        model = Copy
        fields = [
            "id",
            "listing_code",
            "owner",
            "owner_username",
            "board_game",
            "board_game_name",
            "condition",
            "language",
            "edition",
            "sleeved",
            "includes_expansions",
            "missing_components",
            "upgraded_components",
            "component_notes",
            "owner_notes",
            "trade_value_hint",
            "shipping_constraints",
            "pickup_available",
            "photo_urls",
            "status",
            "created",
            "updated",
        ]
        read_only_fields = ["id", "listing_code", "owner", "created", "updated"]

    def get_owner_username(self, obj):
        return obj.owner.username

    def get_board_game_name(self, obj):
        return obj.board_game.name
