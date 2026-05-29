from django.contrib import admin
from .models import Game, GameAlternateName

@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ['bgg_id', 'name', 'year_published', 'avg_rating', 'last_synced_at']
    search_fields = ['name', 'bgg_id']
    ordering = ['name']

@admin.register(GameAlternateName)
class GameAlternateNameAdmin(admin.ModelAdmin):
    list_display = ['name', 'game']
    search_fields = ['name']
