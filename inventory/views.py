from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Listing, Photo
from .serializers import ListingSerializer, PhotoSerializer
from bgtrade.permissions import IsOwnerOrReadOnly


class ListingViewSet(viewsets.ModelViewSet):
    serializer_class = ListingSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]

    def get_queryset(self):
        qs = Listing.objects.select_related('owner', 'game').prefetch_related('photos').all()
        if self.request.query_params.get('mine') in ('true', '1'):
            qs = qs.filter(owner=self.request.user)
        return qs

    @action(detail=True, methods=['post'], url_path='photos')
    def upload_photo(self, request, pk=None):
        listing = self.get_object()
        serializer = PhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(listing=listing)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
