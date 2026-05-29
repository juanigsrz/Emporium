from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TradeEventViewSet, EventEntryViewSet

router = DefaultRouter()
router.register('events', TradeEventViewSet, basename='event')

urlpatterns = router.urls + [
    path('events/<slug:event_slug>/entries/',
         EventEntryViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='event-entries'),
    path('events/<slug:event_slug>/entries/<int:pk>/',
         EventEntryViewSet.as_view({'get': 'retrieve', 'delete': 'destroy'}),
         name='event-entry-detail'),
]
