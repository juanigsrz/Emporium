from django.db import models
from django.contrib.auth.models import User
from events.models import TradeEvent, EventEntry


class MatchResultStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    RUNNING = 'RUNNING', 'Running'
    DONE    = 'DONE',    'Done'
    FAILED  = 'FAILED',  'Failed'


class MatchResult(models.Model):
    event = models.ForeignKey(TradeEvent, on_delete=models.CASCADE, related_name='match_results')
    input_json = models.JSONField(default=dict)
    input_text = models.TextField(blank=True)
    output_json = models.JSONField(default=dict)
    status = models.CharField(
        max_length=10, choices=MatchResultStatus.choices, default=MatchResultStatus.PENDING
    )
    items_traded = models.IntegerField(null=True, blank=True)
    users_trading = models.IntegerField(null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'MatchResult #{self.pk} ({self.event.slug})'


class Assignment(models.Model):
    match_result = models.ForeignKey(MatchResult, on_delete=models.CASCADE,
                                     related_name='assignments')
    entry = models.OneToOneField(EventEntry, on_delete=models.PROTECT,
                                 related_name='assignment')
    recipient = models.ForeignKey(User, on_delete=models.PROTECT,
                                  related_name='received_assignments')

    def __str__(self):
        return f'{self.entry.item_token} -> {self.recipient.username}'
