from rest_framework import viewsets, permissions, status
from rest_framework.response import Response

from .models import TradeStatement
from .serializers import TradeStatementSerializer
from events.models import TradeEvent, EventStatus
from bgtrade.permissions import IsOwnerOrReadOnly


class TradeStatementViewSet(viewsets.ModelViewSet):
    serializer_class = TradeStatementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        slug = self.kwargs['event_slug']
        return TradeStatement.objects.filter(
            event__slug=slug
        ).select_related('owner', 'event').prefetch_related('offer_entries', 'want_games')

    def get_event(self):
        return TradeEvent.objects.get(slug=self.kwargs['event_slug'])

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['event'] = self.get_event()
        return ctx

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if obj.owner != request.user:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied()

    def perform_create(self, serializer):
        event = self.get_event()
        serializer.save(owner=self.request.user, event=event)
