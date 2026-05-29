from rest_framework import serializers
from .models import Shipment
from matching.serializers import AssignmentSerializer


class ShipmentSerializer(serializers.ModelSerializer):
    assignment_detail = AssignmentSerializer(source='assignment', read_only=True)
    role = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = [
            'id', 'assignment', 'assignment_detail', 'role',
            'status', 'tracking', 'shipped_at', 'received_at', 'disputed', 'notes',
        ]
        read_only_fields = ['status', 'shipped_at', 'received_at']

    def get_role(self, obj):
        request = self.context.get('request')
        if request and request.user == obj.assignment.entry.listing.owner:
            return 'SENDER'
        return 'RECIPIENT'
