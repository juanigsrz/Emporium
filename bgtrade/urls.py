from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.authtoken.views import obtain_auth_token

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api-auth/', include('rest_framework.urls')),
    path('api/', include('accounts.urls')),
    path('api/', include('catalog.urls')),
    path('api/', include('inventory.urls')),
    path('api/', include('events.urls')),
    path('api/', include('wishlists.urls')),
    path('api/', include('shipping.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
