from django.urls import path
from .views import TradeStatementViewSet

statement_list = TradeStatementViewSet.as_view({'get': 'list', 'post': 'create'})
statement_detail = TradeStatementViewSet.as_view(
    {'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'}
)

urlpatterns = [
    path('events/<slug:event_slug>/statements/', statement_list, name='statements'),
    path('events/<slug:event_slug>/statements/<int:pk>/', statement_detail, name='statement-detail'),
]
