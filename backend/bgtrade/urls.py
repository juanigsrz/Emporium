"""
URL configuration for bgtrade project.
"""

from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from dj_rest_auth.registration.views import SocialLoginView
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)


def health(request):
    return JsonResponse({"status": "ok"})


class GoogleLogin(SocialLoginView):
    """GIS ID-token sign-in: POST {id_token} → allauth verifies → dj-rest-auth token."""

    adapter_class = GoogleOAuth2Adapter


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

    # Google OAuth (GIS ID-token)
    path("api/auth/google/", GoogleLogin.as_view(), name="google-login"),

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
