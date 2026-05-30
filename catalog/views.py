from rest_framework import viewsets, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticatedOrReadOnly, AllowAny
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from .models import Game
from .serializers import GameSerializer, GameListSerializer
from . import bgg as bgg_service


class GameViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Game.objects.all()
    lookup_field = 'bgg_id'
    permission_classes = [IsAuthenticatedOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter, DjangoFilterBackend]
    search_fields = ['name', 'alternate_names__name']
    ordering_fields = ['name', 'year_published', 'avg_rating', 'weight']
    ordering = ['name']

    def get_serializer_class(self):
        if self.action == 'list':
            return GameListSerializer
        return GameSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('available'):
            from inventory.models import Listing
            game_ids = Listing.objects.filter(is_active=True).values_list('game_id', flat=True)
            qs = qs.filter(bgg_id__in=game_ids)
        return qs

    @action(detail=True, methods=['get'], url_path='listings')
    def listings(self, request, bgg_id=None):
        game = self.get_object()
        from inventory.models import Listing
        from inventory.serializers import ListingSerializer
        qs = Listing.objects.filter(game=game, is_active=True).select_related('owner', 'game')
        serializer = ListingSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='search-bgg')
    def search_bgg(self, request):
        q = request.query_params.get('q', '')
        if not q:
            return Response({'results': []})
        results = bgg_service.search_games(q)
        # Persist stubs so catalog search finds them next time (no extra BGG call).
        bgg_service.bulk_create_stubs(results)
        return Response({'results': results})

    @action(detail=False, methods=['post'], url_path='import-popular')
    def import_popular(self, request):
        """Seed catalog with BGG's current hotness list — one API call, ~50 games."""
        if not (request.user.is_staff or request.user.is_superuser):
            from rest_framework import status as drf_status
            return Response({'detail': 'Staff only.'}, status=drf_status.HTTP_403_FORBIDDEN)
        hot = bgg_service.fetch_hot_games()
        bgg_service.bulk_create_stubs(hot)
        return Response({'seeded': len(hot)})

    @action(detail=True, methods=['post'], url_path='sync')
    def sync(self, request, bgg_id=None):
        game = bgg_service.get_or_sync_game(int(bgg_id), force=True)
        if game is None:
            from rest_framework import status
            return Response({'detail': 'BGG game not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(GameSerializer(game).data)
