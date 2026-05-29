from rest_framework import serializers
from .models import Shipment


class ShipmentSerializer(serializers.ModelSerializer):
    token = serializers.CharField(source='assignment.entry.item_token', read_only=True)
    item_name = serializers.CharField(source='assignment.entry.listing.game.name', read_only=True)
    sender_username = serializers.CharField(
        source='assignment.entry.listing.owner.username', read_only=True)
    recipient_username = serializers.CharField(
        source='assignment.recipient.username', read_only=True)

    class Meta:
        model = Shipment
        fields = [
            'id', 'token', 'item_name', 'sender_username', 'recipient_username',
            'status', 'tracking', 'shipped_at', 'received_at', 'disputed', 'notes',
        ]
        read_only_fields = ['status', 'shipped_at', 'received_at']
