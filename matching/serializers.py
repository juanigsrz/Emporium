from rest_framework import serializers
from .models import MatchResult, Assignment


class AssignmentSerializer(serializers.ModelSerializer):
    token = serializers.CharField(source='entry.item_token', read_only=True)
    item_name = serializers.CharField(source='entry.listing.game.name', read_only=True)
    sender_username = serializers.CharField(source='entry.listing.owner.username', read_only=True)
    recipient_username = serializers.CharField(source='recipient.username', read_only=True)

    class Meta:
        model = Assignment
        fields = ['id', 'token', 'item_name', 'sender_username', 'recipient_username']


class MatchResultSerializer(serializers.ModelSerializer):
    assignments = AssignmentSerializer(many=True, read_only=True)
    my_assignments = serializers.SerializerMethodField()

    class Meta:
        model = MatchResult
        fields = [
            'id', 'event', 'status', 'items_traded', 'users_trading',
            'started_at', 'finished_at', 'input_text', 'assignments', 'my_assignments',
        ]

    def get_my_assignments(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return []
        user = request.user
        mine = obj.assignments.filter(
            entry__listing__owner=user
        ) | obj.assignments.filter(recipient=user)
        return AssignmentSerializer(mine.distinct(), many=True).data
