from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Shipment, ShipmentStatus
from .serializers import ShipmentSerializer


class ShipmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ShipmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Shipment.objects.filter(
            assignment__entry__listing__owner=user
        ) | Shipment.objects.filter(assignment__recipient=user)

    @action(detail=True, methods=['post'], url_path='mark-shipped')
    def mark_shipped(self, request, pk=None):
        shipment = self.get_object()
        if shipment.assignment.entry.listing.owner != request.user:
            return Response({'detail': 'Only the sender can mark as shipped.'},
                            status=status.HTTP_403_FORBIDDEN)
        if shipment.status != ShipmentStatus.PENDING:
            return Response({'detail': 'Already shipped or received.'},
                            status=status.HTTP_400_BAD_REQUEST)
        shipment.status = ShipmentStatus.SHIPPED
        shipment.shipped_at = timezone.now()
        shipment.tracking = request.data.get('tracking', '')
        shipment.save()
        return Response(ShipmentSerializer(shipment).data)

    @action(detail=True, methods=['post'], url_path='mark-received')
    def mark_received(self, request, pk=None):
        shipment = self.get_object()
        if shipment.assignment.recipient != request.user:
            return Response({'detail': 'Only the recipient can mark as received.'},
                            status=status.HTTP_403_FORBIDDEN)
        if shipment.status != ShipmentStatus.SHIPPED:
            return Response({'detail': 'Item has not been shipped yet.'},
                            status=status.HTTP_400_BAD_REQUEST)
        shipment.status = ShipmentStatus.RECEIVED
        shipment.received_at = timezone.now()
        shipment.save()
        return Response(ShipmentSerializer(shipment).data)
