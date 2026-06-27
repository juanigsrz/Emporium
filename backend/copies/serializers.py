"""
copies/serializers.py

CopySerializer — full representation of a Copy instance.

Design choices:
- listing_code is read_only (always server-generated).
- owner is read_only (set from request.user in the view).
- board_game_name is a SerializerMethodField for display convenience; the
  writable FK is accepted as board_game (the bgg_id integer).
- version is optional; when supplied, language is derived from it.
  When omitted, the Unknown fallback version is assigned and language="Unknown".
- language is read_only; it is always derived server-side from the version.
- On create the view passes owner=request.user; serializer must accept it
  via the field being excluded from required client input.
"""

from rest_framework import serializers

from catalog.models import BoardGame, BoardGameVersion
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
    board_game_name      = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()

    # version is optional on write; language is derived from it (read-only)
    version = serializers.PrimaryKeyRelatedField(
        queryset=BoardGameVersion.objects.all(), required=False, allow_null=True
    )
    version_name = serializers.SerializerMethodField()
    in_active_event = serializers.BooleanField(source="is_in_active_event", read_only=True)

    class Meta:
        model = Copy
        fields = [
            "id",
            "listing_code",
            "owner",
            "owner_username",
            "board_game",
            "board_game_name",
            "board_game_thumbnail",
            "version",
            "version_name",
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
            "is_pending",
            "in_active_event",
            "import_source",
            "created",
            "updated",
        ]
        read_only_fields = ["id", "listing_code", "owner", "board_game_thumbnail", "language", "is_pending", "in_active_event", "import_source", "created", "updated"]

    def get_owner_username(self, obj):
        return obj.owner.username

    def get_board_game_name(self, obj):
        return obj.board_game.name

    def get_board_game_thumbnail(self, obj):
        return (obj.board_game.metadata or {}).get("thumbnail", "")

    def get_version_name(self, obj):
        return obj.version.name if obj.version_id else ""

    def validate(self, attrs):
        version = attrs.get("version")
        board_game = attrs.get("board_game") or getattr(self.instance, "board_game", None)
        if version and board_game and version.board_game_id != board_game.bgg_id:
            raise serializers.ValidationError(
                {"version": "Selected version does not belong to the selected game."}
            )
        return attrs

    def _resolve_version_and_language(self, board_game, version):
        if version is not None:
            return version, (version.language or "Unknown")
        return BoardGameVersion.get_or_create_unknown(board_game), "Unknown"

    def create(self, validated_data):
        version, language = self._resolve_version_and_language(
            validated_data.get("board_game"), validated_data.get("version")
        )
        validated_data["version"] = version
        validated_data["language"] = language
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "version" in validated_data:
            version, language = self._resolve_version_and_language(
                instance.board_game, validated_data["version"]
            )
            validated_data["version"] = version
            validated_data["language"] = language
        instance = super().update(instance, validated_data)
        if instance.is_pending:
            instance.recompute_pending()
            instance.save(update_fields=["is_pending", "updated"])
        return instance
