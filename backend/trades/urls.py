"""
trades/urls.py

Event-scoped trade routes, mounted under /api/events/{slug}/ in events/urls.py.

Pattern: all routes receive `slug` from the parent URL conf.

    GET/POST      offer-groups/
    GET/PATCH/DELETE offer-groups/{pk}/
    GET/POST      want-groups/
    GET/PATCH/DELETE want-groups/{pk}/
    GET/POST      wishes/
    GET/PATCH/DELETE wishes/{pk}/
"""

from django.urls import path

from .views import (
    GamePriceView,
    ImportTradesView,
    OfferGroupDetailView,
    OfferGroupListCreateView,
    TradeCapDetailView,
    TradeCapListCreateView,
    TradeWishDetailView,
    TradeWishListCreateView,
    WantBidView,
    WantGroupDetailView,
    WantGroupListCreateView,
)

urlpatterns = [
    # Offer Groups
    path(
        "events/<slug:slug>/offer-groups/",
        OfferGroupListCreateView.as_view(),
        name="offer-group-list",
    ),
    path(
        "events/<slug:slug>/offer-groups/<int:pk>/",
        OfferGroupDetailView.as_view(),
        name="offer-group-detail",
    ),
    # Want Groups
    path(
        "events/<slug:slug>/want-groups/",
        WantGroupListCreateView.as_view(),
        name="want-group-list",
    ),
    path(
        "events/<slug:slug>/want-groups/<int:pk>/",
        WantGroupDetailView.as_view(),
        name="want-group-detail",
    ),
    # Wishes
    path(
        "events/<slug:slug>/wishes/",
        TradeWishListCreateView.as_view(),
        name="wish-list",
    ),
    path(
        "events/<slug:slug>/wishes/<int:pk>/",
        TradeWishDetailView.as_view(),
        name="wish-detail",
    ),
    # Game Prices
    path(
        "events/<slug:slug>/game-prices/",
        GamePriceView.as_view(),
        name="game-price",
    ),
    # Want Bids
    path(
        "events/<slug:slug>/want-bids/",
        WantBidView.as_view(),
        name="want-bid",
    ),
    # Trade Caps
    path(
        "events/<slug:slug>/caps/",
        TradeCapListCreateView.as_view(),
        name="trade-cap-list",
    ),
    path(
        "events/<slug:slug>/caps/<int:pk>/",
        TradeCapDetailView.as_view(),
        name="trade-cap-detail",
    ),
    # Cross-event import
    path(
        "events/<slug:slug>/import-trades/",
        ImportTradesView.as_view(),
        name="import-trades",
    ),
]
