from rest_framework import serializers
from .models import Game, GameAlternateName


class GameAlternateNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameAlternateName
        fields = ['name']


class GameSerializer(serializers.ModelSerializer):
    alternate_names = GameAlternateNameSerializer(many=True, read_only=True)

    class Meta:
        model = Game
        fields = [
            'bgg_id', 'name', 'year_published', 'thumbnail_url', 'image_url',
            'min_players', 'max_players', 'playing_time', 'weight', 'avg_rating',
            'description', 'last_synced_at', 'alternate_names',
        ]


class GameListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Game
        fields = ['bgg_id', 'name', 'year_published', 'thumbnail_url', 'min_players',
                  'max_players', 'playing_time', 'weight', 'avg_rating']
