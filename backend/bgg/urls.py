from django.urls import path

from .views import ImportJobDetailView, ImportJobListCreateView

urlpatterns = [
    path("bgg/imports/", ImportJobListCreateView.as_view(), name="bgg-import-list-create"),
    path("bgg/imports/<int:pk>/", ImportJobDetailView.as_view(), name="bgg-import-detail"),
]
