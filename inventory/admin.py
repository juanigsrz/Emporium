from django.contrib import admin
from .models import Listing, Photo

class PhotoInline(admin.TabularInline):
    model = Photo
    extra = 0

@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ['id', 'game', 'owner', 'condition', 'completeness', 'is_active', 'created_at']
    list_filter = ['condition', 'completeness', 'is_active']
    search_fields = ['game__name', 'owner__username']
    inlines = [PhotoInline]
