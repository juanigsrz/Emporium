"""
URL configuration for bgtrade project.
"""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def health(request):
    return JsonResponse({"status": "ok"})


@api_view(["GET"])
@permission_classes([AllowAny])
def oauth_google_stub(request):
    """Stub for OAuth Google flow — full implementation deferred to a later feature."""
    return Response({"detail": "Google OAuth not yet configured."}, status=501)


urlpatterns = [
    # Admin
    path("admin/", admin.site.urls),

    # Health check (no auth required)
    path("api/health/", health, name="health"),

    # OpenAPI schema + Swagger UI
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),

    # Auth (dj-rest-auth + allauth registration)
    path("api/auth/", include("dj_rest_auth.urls")),
    path("api/auth/registration/", include("dj_rest_auth.registration.urls")),

    # OAuth Google stub
    path("api/auth/oauth/google/", oauth_google_stub, name="oauth-google-stub"),

    # Accounts: profiles, blocks, wishlists, ratings
    path("api/", include("accounts.urls")),

    # Catalog: games list, detail, copies sub-route
    path("api/", include("catalog.urls")),

    # Copies: CRUD for physical copy listings
    path("api/", include("copies.urls")),

    # Events: trade events lifecycle + participations + listings
    path("api/", include("events.urls")),

    # Trades: offer groups, want groups, wishes (event-scoped)
    path("api/", include("trades.urls")),

    # Matching: match runs, results, assignments (event-scoped)
    path("api/", include("matching.urls")),

    # BGG: import jobs (wishlist/ratings/owned/geeklist)
    path("api/", include("bgg.urls")),

    # Notifications: list, mark-read, mark-all-read
    path("api/", include("notifications.urls")),
]
