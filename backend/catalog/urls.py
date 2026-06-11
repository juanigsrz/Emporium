"""
catalog/urls.py

URL patterns for the catalog app.

    GET /api/games/                  — list / search
    GET /api/games/{bgg_id}/         — detail
    GET /api/games/{bgg_id}/copies/  — copies stub (forward-compat, returns empty list)
"""

from django.urls import path

from .views import BoardGameCopiesView, BoardGameDetailView, BoardGameListView, BoardGameVersionsView

urlpatterns = [
    path("games/", BoardGameListView.as_view(), name="game-list"),
    path("games/<int:bgg_id>/", BoardGameDetailView.as_view(), name="game-detail"),
    path("games/<int:bgg_id>/copies/", BoardGameCopiesView.as_view(), name="game-copies"),
    path("games/<int:bgg_id>/versions/", BoardGameVersionsView.as_view(), name="game-versions"),
]
