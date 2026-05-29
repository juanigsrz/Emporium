from rest_framework import serializers
from .models import MatchResult, Assignment
from events.serializers import EventEntrySerializer


class AssignmentSerializer(serializers.ModelSerializer):
    entry_detail = EventEntrySerializer(source='entry', read_only=True)
    recipient = serializers.IntegerField(source='recipient.id', read_only=True)
    recipient_username = serializers.CharField(source='recipient.username', read_only=True)
    sender_username = serializers.CharField(source='entry.listing.owner.username', read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id', 'match_result', 'entry', 'entry_detail',
            'recipient', 'recipient_username', 'sender_username',
        ]


class MatchResultSerializer(serializers.ModelSerializer):
    assignments = AssignmentSerializer(many=True, read_only=True)
    event = serializers.CharField(source='event.slug', read_only=True)

    class Meta:
        model = MatchResult
        fields = [
            'id', 'event', 'status', 'items_traded', 'users_trading',
            'started_at', 'finished_at', 'input_text', 'output_json',
            'assignments',
        ]


class EventResultSerializer(serializers.Serializer):
    result = MatchResultSerializer(read_only=True)
    my_assignments = AssignmentSerializer(many=True, read_only=True)
