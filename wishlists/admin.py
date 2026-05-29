from django.contrib import admin
from .models import TradeStatement

@admin.register(TradeStatement)
class TradeStatementAdmin(admin.ModelAdmin):
    list_display = ['id', 'event', 'owner', 'give_at_most', 'get_at_least', 'created_at']
    filter_horizontal = ['offer_entries', 'want_games']
