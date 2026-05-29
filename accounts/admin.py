from django.contrib import admin
from .models import UserProfile

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'bgg_username', 'bgg_verified', 'is_organizer', 'default_region']
    list_filter = ['bgg_verified', 'is_organizer']
    search_fields = ['user__username', 'bgg_username']
