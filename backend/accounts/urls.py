"""
accounts/urls.py

URL patterns for the accounts app.
"""

from django.urls import path

from .views import (
    BlockDestroyView,
    BlockListCreateView,
    GameRatingDestroyView,
    GameRatingListCreateView,
    GeocodeSearchView,
    ProfileDetailView,
    ProfileMeView,
    RatingListCreateView,
    WishlistDestroyView,
    WishlistListCreateView,
)

urlpatterns = [
    # Profiles
    path("profiles/me/", ProfileMeView.as_view(), name="profile-me"),
    path("profiles/<str:username>/", ProfileDetailView.as_view(), name="profile-detail"),

    # Blocks
    path("blocks/", BlockListCreateView.as_view(), name="block-list-create"),
    path("blocks/<int:pk>/", BlockDestroyView.as_view(), name="block-destroy"),

    # Wishlists
    path("wishlists/", WishlistListCreateView.as_view(), name="wishlist-list-create"),
    path("wishlists/<int:pk>/", WishlistDestroyView.as_view(), name="wishlist-destroy"),

    # Ratings
    path("ratings/", RatingListCreateView.as_view(), name="rating-list-create"),

    # Game ratings (F2)
    path("game-ratings/", GameRatingListCreateView.as_view(), name="game-rating-list-create"),
    path("game-ratings/<int:pk>/", GameRatingDestroyView.as_view(), name="game-rating-destroy"),

    # Geocoding
    path("geocode/search/", GeocodeSearchView.as_view(), name="geocode-search"),
]
