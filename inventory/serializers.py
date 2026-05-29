from rest_framework import serializers
from .models import Listing, Photo
from catalog.serializers import GameListSerializer
from catalog.models import Game


class PhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ['id', 'image', 'caption', 'order']


class ListingSerializer(serializers.ModelSerializer):
    game = GameListSerializer(read_only=True)
    game_bgg_id = serializers.IntegerField(write_only=True)
    owner = serializers.IntegerField(source='owner.id', read_only=True)
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            'id', 'game', 'game_bgg_id', 'owner', 'owner_username',
            'condition', 'language', 'bgg_version_id', 'edition_note',
            'completeness', 'notes', 'estimated_value', 'is_active',
            'created_at', 'photos',
        ]
        read_only_fields = ['owner', 'created_at']

    def validate_game_bgg_id(self, value):
        from catalog.bgg import get_or_sync_game
        game = Game.objects.filter(bgg_id=value).first()
        if not game:
            game = get_or_sync_game(value)
        if not game:
            raise serializers.ValidationError(f'Game with BGG ID {value} not found.')
        return value

    def create(self, validated_data):
        bgg_id = validated_data.pop('game_bgg_id')
        game = Game.objects.get(bgg_id=bgg_id)
        validated_data['game'] = game
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        bgg_id = validated_data.pop('game_bgg_id', None)
        if bgg_id is not None:
            game = Game.objects.get(bgg_id=bgg_id)
            validated_data['game'] = game
        return super().update(instance, validated_data)
