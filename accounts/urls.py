from django.urls import path
from . import views

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.user_login),
    path('auth/logout/', views.user_logout),
    path('me/', views.me),
    path('me/bgg/link/', views.bgg_link),
    path('me/bgg/verify/', views.bgg_verify),
    path('me/bgg/import/', views.bgg_import),
]
