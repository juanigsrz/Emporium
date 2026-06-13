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
    MatchRunUploadView,
    PaymentDetailView,
    PaymentsView,
    ShipmentDetailView,
    ShippingOverviewSummaryView,
    ShippingOverviewView,
    ShippingView,
)

urlpatterns = [
    path(
        "events/<slug:slug>/matches/",
        MatchRunListCreateView.as_view(),
        name="match-list",
    ),
    path(
        "events/<slug:slug>/matches/upload/",
        MatchRunUploadView.as_view(),
        name="match-upload",
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
    path(
        "events/<slug:slug>/shipping/",
        ShippingView.as_view(),
        name="shipping-list",
    ),
    path(
        "events/<slug:slug>/shipping/overview/",
        ShippingOverviewView.as_view(),
        name="shipping-overview",
    ),
    path(
        "events/<slug:slug>/shipping/overview/summary/",
        ShippingOverviewSummaryView.as_view(),
        name="shipping-overview-summary",
    ),
    path(
        "events/<slug:slug>/shipping/<int:pk>/",
        ShipmentDetailView.as_view(),
        name="shipping-detail",
    ),
    path(
        "events/<slug:slug>/payments/",
        PaymentsView.as_view(),
        name="payments-list",
    ),
    path(
        "events/<slug:slug>/payments/<int:pk>/",
        PaymentDetailView.as_view(),
        name="payments-detail",
    ),
]
