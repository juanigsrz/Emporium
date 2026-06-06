"""
matching/urls.py

Event-scoped matching routes, mounted under /api/ in bgtrade/urls.py.

    GET/POST      events/{slug}/matches/
    GET           events/{slug}/matches/{run_id}/
    GET           events/{slug}/matches/{run_id}/result/
    GET           events/{slug}/matches/{run_id}/mine/
"""

from django.urls import path

from .views import (
    MatchRunDetailView,
    MatchRunListCreateView,
    MatchRunMineView,
    MatchRunResultView,
)

urlpatterns = [
    path(
        "events/<slug:slug>/matches/",
        MatchRunListCreateView.as_view(),
        name="match-list",
    ),
    path(
        "events/<slug:slug>/matches/<int:run_id>/",
        MatchRunDetailView.as_view(),
        name="match-detail",
    ),
    path(
        "events/<slug:slug>/matches/<int:run_id>/result/",
        MatchRunResultView.as_view(),
        name="match-result",
    ),
    path(
        "events/<slug:slug>/matches/<int:run_id>/mine/",
        MatchRunMineView.as_view(),
        name="match-mine",
    ),
]
