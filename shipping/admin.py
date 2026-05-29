from django.contrib import admin
from .models import Shipment

@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ['id', 'assignment', 'status', 'tracking', 'shipped_at', 'received_at', 'disputed']
    list_filter = ['status', 'disputed']
