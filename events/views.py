from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import TradeEvent, EventEntry, EventStatus, EntryStatus
from .serializers import TradeEventSerializer, EventEntrySerializer
from bgtrade.permissions import IsOrganizer


class TradeEventViewSet(viewsets.ModelViewSet):
    queryset = TradeEvent.objects.select_related('organizer').all()
    serializer_class = TradeEventSerializer
    lookup_field = 'slug'

    def get_permissions(self):
        if self.action in ('create',):
            return [permissions.IsAuthenticated(), IsOrganizer()]
        if self.action in ('update', 'partial_update', 'transition', 'run_match'):
            return [permissions.IsAuthenticated(), IsOrganizer()]
        return [permissions.IsAuthenticatedOrReadOnly()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if self.action in ('update', 'partial_update', 'transition', 'run_match'):
            if obj.organizer != request.user:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied()

    @action(detail=True, methods=['post'], url_path='transition')
    def transition(self, request, slug=None):
        event = self.get_object()
        to_status = request.data.get('to')
        if not to_status:
            return Response({'detail': '`to` field required.'}, status=status.HTTP_400_BAD_REQUEST)
        event.transition_to(to_status)
        return Response(TradeEventSerializer(event).data)

    @action(detail=True, methods=['post'], url_path='run-match')
    def run_match(self, request, slug=None):
        event = self.get_object()
        if event.status != EventStatus.MATCHING:
            return Response({'detail': 'Event must be in MATCHING state.'},
                            status=status.HTTP_400_BAD_REQUEST)
        from matching.adapter import run_match
        result = run_match(event)
        from matching.serializers import MatchResultSerializer
        return Response(MatchResultSerializer(result).data)

    @action(detail=True, methods=['get'], url_path='result')
    def result(self, request, slug=None):
        event = self.get_object()
        from matching.models import MatchResult, Assignment
        from matching.serializers import MatchResultSerializer, AssignmentSerializer
        match_result = MatchResult.objects.filter(event=event).order_by('-started_at').first()
        if not match_result:
            return Response({'result': None, 'my_assignments': []})
        my = Assignment.objects.filter(
            match_result=match_result
        ).filter(
            entry__listing__owner=request.user
        ) | Assignment.objects.filter(
            match_result=match_result, recipient=request.user
        )
        return Response({
            'result': MatchResultSerializer(match_result).data,
            'my_assignments': AssignmentSerializer(my.distinct(), many=True).data,
        })

    @action(detail=True, methods=['get'], url_path='shipping')
    def shipping(self, request, slug=None):
        event = self.get_object()
        from shipping.models import Shipment
        from shipping.serializers import ShipmentSerializer
        shipments = Shipment.objects.filter(
            assignment__match_result__event=event
        ).select_related(
            'assignment__entry__listing__owner',
            'assignment__entry__listing__game',
            'assignment__recipient',
        ).filter(
            assignment__entry__listing__owner=request.user
        ) | Shipment.objects.filter(
            assignment__match_result__event=event,
            assignment__recipient=request.user,
        ).select_related(
            'assignment__entry__listing__owner',
            'assignment__entry__listing__game',
            'assignment__recipient',
        )
        return Response(ShipmentSerializer(
            shipments.distinct(), many=True, context={'request': request}
        ).data)


class EventEntryViewSet(viewsets.ModelViewSet):
    serializer_class = EventEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        slug = self.kwargs['event_slug']
        return EventEntry.objects.filter(
            event__slug=slug
        ).select_related('listing__owner', 'listing__game', 'event')

    def get_event(self):
        slug = self.kwargs['event_slug']
        return TradeEvent.objects.get(slug=slug)

    def perform_create(self, serializer):
        event = self.get_event()
        if event.status != EventStatus.OPEN_SUBMISSIONS:
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Event is not open for submissions.')
        listing = serializer.validated_data['listing']
        if listing.owner != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You do not own this listing.')
        if event.max_listings_per_user:
            count = EventEntry.objects.filter(
                event=event,
                listing__owner=self.request.user,
                status=EntryStatus.ENTERED,
            ).count()
            if count >= event.max_listings_per_user:
                from rest_framework.exceptions import ValidationError
                raise ValidationError('Maximum listings per user reached.')
        serializer.save(event=event)

    def destroy(self, request, *args, **kwargs):
        entry = self.get_object()
        event = entry.event
        if event.status not in (EventStatus.OPEN_SUBMISSIONS,):
            return Response({'detail': 'Cannot withdraw after submissions close.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if entry.listing.owner != request.user:
            return Response({'detail': 'Not your listing.'}, status=status.HTTP_403_FORBIDDEN)
        entry.status = EntryStatus.WITHDRAWN
        entry.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
