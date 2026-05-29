from rest_framework.routers import DefaultRouter
from .views import ListingViewSet

router = DefaultRouter()
router.register('listings', ListingViewSet, basename='listing')

urlpatterns = router.urls
