from django.contrib import admin

from .models import BoardGame


@admin.register(BoardGame)
class BoardGameAdmin(admin.ModelAdmin):
    list_display = ["bgg_id", "name", "year_published", "rank", "average", "users_rated", "is_expansion"]
    list_filter = ["is_expansion"]
    search_fields = ["name"]
    ordering = ["rank"]
