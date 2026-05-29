from rest_framework import serializers
from .models import Listing, Photo
from catalog.serializers import GameListSerializer


class PhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ['id', 'image', 'caption', 'order']


class ListingSerializer(serializers.ModelSerializer):
    game_detail = GameListSerializer(source='game', read_only=True)
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            'id', 'game', 'game_detail', 'owner', 'owner_username',
            'condition', 'language', 'bgg_version_id', 'edition_note',
            'completeness', 'notes', 'estimated_value', 'is_active',
            'created_at', 'photos',
        ]
        read_only_fields = ['owner', 'created_at']

    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)
