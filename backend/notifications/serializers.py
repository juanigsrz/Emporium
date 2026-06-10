from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    event_slug = serializers.CharField(source="event.slug", read_only=True, default=None)

    class Meta:
        model = Notification
        fields = ["id", "kind", "message", "read", "event", "event_slug", "created"]
        read_only_fields = fields
