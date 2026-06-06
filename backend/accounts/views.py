"""
accounts/views.py

Endpoints:
  GET/PATCH  /api/profiles/me/           — own profile
  GET        /api/profiles/{username}/   — public profile (any authenticated user)
  GET/POST   /api/blocks/                — list/create blocks (mine)
  DELETE     /api/blocks/{id}/           — delete own block
  GET/POST   /api/wishlists/             — list/create wishlist entries (mine)
  DELETE     /api/wishlists/{id}/        — delete own wishlist entry
  GET/POST   /api/ratings/               — list/create ratings; filter ?event_id=&ratee=
"""

from django.contrib.auth import get_user_model
from django.http import Http404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, permissions

from .models import Profile, TradeRating, UserBlock, Wishlist
from .serializers import (
    ProfileSerializer,
    TradeRatingSerializer,
    UserBlockSerializer,
    WishlistSerializer,
)

User = get_user_model()


# ---------------------------------------------------------------------------
# Profile endpoints
# ---------------------------------------------------------------------------

class ProfileMeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/profiles/me/ — own profile."""

    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        profile, _ = Profile.objects.get_or_create(user=self.request.user)
        return profile


class ProfileDetailView(generics.RetrieveAPIView):
    """GET /api/profiles/{username}/ — public profile."""

    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_object(self):
        username = self.kwargs["username"]
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise Http404
        profile, _ = Profile.objects.get_or_create(user=user)
        return profile


# ---------------------------------------------------------------------------
# Block endpoints
# ---------------------------------------------------------------------------

class BlockListCreateView(generics.ListCreateAPIView):
    """GET /api/blocks/ — list own blocks. POST — create a block."""

    serializer_class = UserBlockSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return UserBlock.objects.filter(blocker=self.request.user).select_related(
            "blocker", "blocked"
        )

    def perform_create(self, serializer):
        serializer.save(blocker=self.request.user)


class BlockDestroyView(generics.DestroyAPIView):
    """DELETE /api/blocks/{id}/ — delete own block."""

    serializer_class = UserBlockSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return UserBlock.objects.filter(blocker=self.request.user)


# ---------------------------------------------------------------------------
# Wishlist endpoints
# ---------------------------------------------------------------------------

class WishlistListCreateView(generics.ListCreateAPIView):
    """GET /api/wishlists/ — list own wishlist. POST — add entry.
    Filter: ?board_game_bgg_id=<int>
    """

    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["board_game_bgg_id"]

    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class WishlistDestroyView(generics.DestroyAPIView):
    """DELETE /api/wishlists/{id}/ — delete own wishlist entry."""

    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)


# ---------------------------------------------------------------------------
# Rating endpoints
# ---------------------------------------------------------------------------

class RatingListCreateView(generics.ListCreateAPIView):
    """GET /api/ratings/ — list ratings. POST — create rating.
    Filter: ?event_id=<int>&ratee=<username>
    """

    serializer_class = TradeRatingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = TradeRating.objects.select_related("rater", "ratee")
        event_id = self.request.query_params.get("event_id")
        ratee = self.request.query_params.get("ratee")
        if event_id is not None:
            qs = qs.filter(event_id=event_id)
        if ratee is not None:
            qs = qs.filter(ratee__username=ratee)
        return qs

    def perform_create(self, serializer):
        serializer.save(rater=self.request.user)
