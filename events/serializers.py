from rest_framework import serializers
from .models import TradeEvent, EventEntry, EntryStatus
from inventory.serializers import ListingSerializer


class TradeEventSerializer(serializers.ModelSerializer):
    organizer_username = serializers.CharField(source='organizer.username', read_only=True)

    class Meta:
        model = TradeEvent
        fields = [
            'id', 'name', 'slug', 'description', 'organizer', 'organizer_username',
            'status', 'region_rule', 'allow_bundles', 'submissions_close_at',
            'wantlist_close_at', 'max_listings_per_user', 'created_at',
        ]
        read_only_fields = ['organizer', 'status', 'created_at']

    def create(self, validated_data):
        validated_data['organizer'] = self.context['request'].user
        return super().create(validated_data)


class EventEntrySerializer(serializers.ModelSerializer):
    listing_detail = ListingSerializer(source='listing', read_only=True)
    owner_username = serializers.CharField(source='listing.owner.username', read_only=True)

    class Meta:
        model = EventEntry
        fields = ['id', 'event', 'listing', 'listing_detail', 'owner_username',
                  'item_token', 'status', 'created_at']
        read_only_fields = ['event', 'item_token', 'status', 'created_at']
