from django.contrib import admin
from .models import MatchResult, Assignment

@admin.register(MatchResult)
class MatchResultAdmin(admin.ModelAdmin):
    list_display = ['id', 'event', 'status', 'items_traded', 'users_trading', 'started_at']
    list_filter = ['status']

@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ['id', 'entry', 'recipient', 'match_result']
