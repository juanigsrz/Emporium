from django.db import models
from django.contrib.auth.models import User
from events.models import TradeEvent, EventEntry
from catalog.models import Game


class TradeStatement(models.Model):
    event = models.ForeignKey(TradeEvent, on_delete=models.CASCADE, related_name='statements')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trade_statements')
    give_at_most = models.PositiveIntegerField(default=1)
    get_at_least = models.PositiveIntegerField(default=1)
    offer_entries = models.ManyToManyField(EventEntry, related_name='offered_in_statements')
    want_games = models.ManyToManyField(Game, related_name='wanted_in_statements')
    want_filters = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Statement #{self.pk} by {self.owner.username} in {self.event.slug}'
