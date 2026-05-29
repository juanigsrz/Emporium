from rest_framework.routers import DefaultRouter
from .views import GameViewSet

router = DefaultRouter()
router.register('games', GameViewSet, basename='game')

urlpatterns = router.urls
