from django.contrib import admin
from .models import TradeEvent, EventEntry

@admin.register(TradeEvent)
class TradeEventAdmin(admin.ModelAdmin):
    list_display = ['slug', 'name', 'organizer', 'status', 'created_at']
    list_filter = ['status']
    search_fields = ['name', 'slug']
    prepopulated_fields = {'slug': ('name',)}

@admin.register(EventEntry)
class EventEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'event', 'listing', 'item_token', 'status']
    list_filter = ['status']
