"""
catalog/views.py

Endpoints:
    GET /api/games/                — list with search/filter/ordering/pagination
    GET /api/games/{bgg_id}/       — detail with copies_count + deferred fields
    GET /api/games/{bgg_id}/copies/ — real copies for this game (F3+)
                                      ?condition=&language= filters supported

Caching:
    Detail and list (with querystring key) are cached with LocMemCache.
    Cache key includes URL path + querystring so each distinct query is cached.
    Timeout: settings.GAME_CACHE_TIMEOUT (default 60s).

copies_count note:
    The annotation counts only ACTIVE copies (status="ACTIVE"). This is the
    most useful number for traders browsing the catalog — TRADED/WITHDRAWN
    copies are no longer available.
"""

import hashlib

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, F, Q, Value
from django.db.models.functions import Coalesce
from rest_framework import generics, permissions
from rest_framework.exceptions import NotFound
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import BoardGame
from .serializers import BoardGameDetailSerializer, BoardGameListSerializer, BoardGameVersionSerializer

CACHE_TIMEOUT = getattr(settings, "GAME_CACHE_TIMEOUT", 60)

_NULL_RANK_SENTINEL = Value(999_999_999)


class NullsLastRankOrderingFilter(OrderingFilter):
    """
    Custom OrderingFilter that replaces 'rank' / '-rank' ordering with a
    Coalesce expression so NULL-rank games always sort last.
    """

    def filter_queryset(self, request, queryset, view):
        orderings = self.get_ordering(request, queryset, view)
        if not orderings:
            return queryset

        new_orderings = []
        for field in orderings:
            if field == "rank":
                new_orderings.append(Coalesce("rank", _NULL_RANK_SENTINEL).asc())
            elif field == "-rank":
                new_orderings.append(Coalesce("rank", _NULL_RANK_SENTINEL).desc())
            else:
                new_orderings.append(field)
        return queryset.order_by(*new_orderings)


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class GamePagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(request, prefix="game"):
    """Build a stable cache key from the request path + query string."""
    raw = f"{prefix}:{request.path}:{request.GET.urlencode()}"
    return "catalog:" + hashlib.md5(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# List view
# ---------------------------------------------------------------------------

class BoardGameListView(generics.ListAPIView):
    """
    GET /api/games/

    Query params:
        ?search=<str>          — case-insensitive name search
        ?is_expansion=true|false
        ?ordering=rank|-users_rated|name|-average   (default: rank nulls last, -users_rated)
    """

    serializer_class = BoardGameListSerializer
    pagination_class = GamePagination
    permission_classes = [permissions.AllowAny]
    filter_backends = [SearchFilter, NullsLastRankOrderingFilter]
    search_fields = ["name"]
    ordering_fields = ["rank", "users_rated", "name", "average"]

    def get_queryset(self):
        qs = BoardGame.objects.all()

        # is_expansion filter
        is_expansion = self.request.query_params.get("is_expansion")
        if is_expansion is not None:
            val = is_expansion.lower() in ("1", "true", "yes")
            qs = qs.filter(is_expansion=val)

        # copies_count annotation — counts only ACTIVE copies so the number
        # reflects copies currently available for trading.
        try:
            qs = qs.annotate(
                copies_count=Count(
                    "copies",
                    filter=Q(copies__status="ACTIVE"),
                )
            )
        except Exception:
            qs = qs.annotate(copies_count=Value(0))

        # Default ordering: rank nulls last, then -users_rated.
        # OrderingFilter overrides this when ?ordering= is present.
        ordering_param = self.request.query_params.get("ordering")
        if not ordering_param:
            qs = qs.order_by(
                Coalesce("rank", Value(999_999_999)).asc(),
                "-users_rated",
            )

        return qs

    def list(self, request, *args, **kwargs):
        key = _cache_key(request, prefix="game_list")
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)

        response = super().list(request, *args, **kwargs)
        cache.set(key, response.data, CACHE_TIMEOUT)
        return response


# ---------------------------------------------------------------------------
# Detail view
# ---------------------------------------------------------------------------

class BoardGameDetailView(generics.RetrieveAPIView):
    """
    GET /api/games/{bgg_id}/

    Returns full game detail including deferred placeholder fields.
    copies_count is 0 until F3 Copy model is wired up.
    """

    serializer_class = BoardGameDetailSerializer
    permission_classes = [permissions.AllowAny]
    lookup_field = "bgg_id"

    def get_queryset(self):
        try:
            return BoardGame.objects.annotate(
                copies_count=Count(
                    "copies",
                    filter=Q(copies__status="ACTIVE"),
                )
            )
        except Exception:
            return BoardGame.objects.annotate(copies_count=Value(0))

    def retrieve(self, request, *args, **kwargs):
        key = _cache_key(request, prefix="game_detail")
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)

        response = super().retrieve(request, *args, **kwargs)
        cache.set(key, response.data, CACHE_TIMEOUT)
        return response


# ---------------------------------------------------------------------------
# Copies sub-route (F3 — real implementation)
# ---------------------------------------------------------------------------

class BoardGameCopiesView(generics.ListAPIView):
    """
    GET /api/games/{bgg_id}/copies/

    Returns paginated ACTIVE copies for the given game.

    Query params:
        ?condition=<CONDITION>   — e.g. NEW, LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR
        ?language=<str>          — case-insensitive contains match
        ?event=<id>              — (accepted, ignored until F4 EventListing is wired)
    """

    permission_classes = [permissions.AllowAny]
    pagination_class = GamePagination

    def get_serializer_class(self):
        # Import here to avoid circular imports at module load time
        from copies.serializers import CopySerializer
        return CopySerializer

    def get_queryset(self):
        bgg_id = self.kwargs["bgg_id"]

        # 404 if the game doesn't exist
        if not BoardGame.objects.filter(bgg_id=bgg_id).exists():
            raise NotFound(f"No game with bgg_id={bgg_id}.")

        # Import here to avoid circular imports at module load time
        from copies.models import Copy

        qs = Copy.objects.filter(
            board_game_id=bgg_id,
            status=Copy.Status.ACTIVE,
        ).select_related("owner", "board_game")

        # Optional filters
        condition = self.request.query_params.get("condition")
        if condition:
            qs = qs.filter(condition=condition)

        language = self.request.query_params.get("language")
        if language:
            qs = qs.filter(language__icontains=language)

        # ?event= accepted and ignored until F4
        return qs


# ---------------------------------------------------------------------------
# Versions sub-route
# ---------------------------------------------------------------------------

class BoardGameVersionsView(generics.ListAPIView):
    """GET /api/games/{bgg_id}/versions/ — real BGG versions of a game (excludes Unknown)."""

    serializer_class = BoardGameVersionSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_queryset(self):
        from .models import BoardGameVersion
        bgg_id = self.kwargs["bgg_id"]
        if not BoardGame.objects.filter(bgg_id=bgg_id).exists():
            raise NotFound(f"No game with bgg_id={bgg_id}.")
        return (
            BoardGameVersion.objects
            .filter(board_game_id=bgg_id, bgg_version_id__isnull=False)
            .order_by("bgg_version_id")
        )
