"""
copies/urls.py

Routes:
    GET/POST  /api/copies/
    GET/PATCH/DELETE  /api/copies/{id}/
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CopyViewSet

router = DefaultRouter()
router.register(r"copies", CopyViewSet, basename="copy")

urlpatterns = [
    path("", include(router.urls)),
]
