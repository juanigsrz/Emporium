"""
catalog/serializers.py

Serializers for BoardGame list and detail views.

List shape (per API_CONTRACT.md):
    bgg_id, name, year_published, rank, average, users_rated,
    is_expansion, image_url, copies_count

Detail shape: all list fields + deferred placeholders:
    designers, publishers, mechanics, categories (all []),
    bayes_average, category_ranks, metadata,
    min_players, max_players, min_playtime, max_playtime (all null)
"""

from rest_framework import serializers

from .models import BoardGame


class BoardGameListSerializer(serializers.ModelSerializer):
    """Compact serializer for list / search results."""

    copies_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = BoardGame
        fields = [
            "bgg_id",
            "name",
            "year_published",
            "rank",
            "average",
            "users_rated",
            "is_expansion",
            "image_url",
            "copies_count",
        ]


class BoardGameDetailSerializer(serializers.ModelSerializer):
    """
    Full detail serializer including deferred / placeholder fields.

    Deferred fields (not yet populated from BGG API sync) are exposed
    as empty lists or null so the FE can render placeholders:
        designers, publishers, mechanics, categories → []
        min_players, max_players, min_playtime, max_playtime → null
    """

    copies_count = serializers.IntegerField(read_only=True, default=0)

    # Deferred — will come from metadata once BGG sync lands
    designers = serializers.SerializerMethodField()
    publishers = serializers.SerializerMethodField()
    mechanics = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()
    min_players = serializers.SerializerMethodField()
    max_players = serializers.SerializerMethodField()
    min_playtime = serializers.SerializerMethodField()
    max_playtime = serializers.SerializerMethodField()
    thumbnail = serializers.SerializerMethodField()
    average_weight = serializers.SerializerMethodField()
    language_dependence = serializers.SerializerMethodField()
    language_dependence_label = serializers.SerializerMethodField()

    class Meta:
        model = BoardGame
        fields = [
            "bgg_id",
            "name",
            "year_published",
            "rank",
            "bayes_average",
            "average",
            "users_rated",
            "is_expansion",
            "category_ranks",
            "image_url",
            "thumbnail",
            "average_weight",
            "language_dependence",
            "language_dependence_label",
            "copies_count",
            # Deferred placeholders
            "designers",
            "publishers",
            "mechanics",
            "categories",
            "min_players",
            "max_players",
            "min_playtime",
            "max_playtime",
            # Full metadata blob (future sync target)
            "metadata",
            "created",
            "updated",
        ]

    # --- deferred field getters (read from metadata if populated, else default) ---

    def _meta(self, obj, key, default):
        return obj.metadata.get(key, default) if obj.metadata else default

    def get_designers(self, obj):
        return self._meta(obj, "designers", [])

    def get_publishers(self, obj):
        return self._meta(obj, "publishers", [])

    def get_mechanics(self, obj):
        return self._meta(obj, "mechanics", [])

    def get_categories(self, obj):
        return self._meta(obj, "categories", [])

    def get_min_players(self, obj):
        return self._meta(obj, "min_players", None)

    def get_max_players(self, obj):
        return self._meta(obj, "max_players", None)

    def get_min_playtime(self, obj):
        return self._meta(obj, "min_playtime", None)

    def get_max_playtime(self, obj):
        return self._meta(obj, "max_playtime", None)

    def get_thumbnail(self, obj):
        return self._meta(obj, "thumbnail", "")

    def get_average_weight(self, obj):
        return self._meta(obj, "average_weight", None)

    def get_language_dependence(self, obj):
        return self._meta(obj, "language_dependence", None)

    def get_language_dependence_label(self, obj):
        return self._meta(obj, "language_dependence_label", "")
