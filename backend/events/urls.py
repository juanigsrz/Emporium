"""
events/urls.py

Routes:
    GET/POST                          /api/events/
    GET/PATCH/DELETE                  /api/events/{slug}/
    POST                              /api/events/{slug}/transition/
    GET                               /api/events/{slug}/participants/
    POST                              /api/events/{slug}/join/
    DELETE                            /api/events/{slug}/leave/
    GET/POST                          /api/events/{slug}/listings/
    DELETE                            /api/events/{slug}/listings/{listing_id}/
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .combo_views import ComboDetailView, ComboListCreateView
from .views import TradeEventViewSet

router = DefaultRouter()
router.register(r"events", TradeEventViewSet, basename="event")

urlpatterns = [
    path("events/<slug:slug>/combos/", ComboListCreateView.as_view(), name="combo-list"),
    path("events/<slug:slug>/combos/<int:pk>/", ComboDetailView.as_view(), name="combo-detail"),
    path("", include(router.urls)),
]
