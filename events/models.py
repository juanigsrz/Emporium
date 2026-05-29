import string
import random
from django.db import models
from django.contrib.auth.models import User
from inventory.models import Listing


class EventStatus(models.TextChoices):
    DRAFT            = 'DRAFT',            'Draft'
    OPEN_SUBMISSIONS = 'OPEN_SUBMISSIONS', 'Open for submissions'
    OPEN_WANTLIST    = 'OPEN_WANTLIST',    'Open for want list'
    MATCHING         = 'MATCHING',         'Matching computation'
    MATCH_REVIEW     = 'MATCH_REVIEW',     'Match review'
    FINALIZED        = 'FINALIZED',        'Finalization'
    SHIPPING         = 'SHIPPING',         'Shipping / completion'
    ARCHIVED         = 'ARCHIVED',         'Archive'


VALID_TRANSITIONS = {
    EventStatus.DRAFT:            [EventStatus.OPEN_SUBMISSIONS],
    EventStatus.OPEN_SUBMISSIONS: [EventStatus.OPEN_WANTLIST],
    EventStatus.OPEN_WANTLIST:    [EventStatus.MATCHING],
    EventStatus.MATCHING:         [EventStatus.MATCH_REVIEW],
    EventStatus.MATCH_REVIEW:     [EventStatus.FINALIZED, EventStatus.MATCHING],
    EventStatus.FINALIZED:        [EventStatus.SHIPPING],
    EventStatus.SHIPPING:         [EventStatus.ARCHIVED],
    EventStatus.ARCHIVED:         [],
}


class TradeEvent(models.Model):
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True, max_length=100)
    description = models.TextField(blank=True)
    organizer = models.ForeignKey(User, on_delete=models.PROTECT, related_name='organized_events')
    status = models.CharField(
        max_length=20, choices=EventStatus.choices, default=EventStatus.DRAFT
    )
    region_rule = models.CharField(max_length=50, blank=True)
    allow_bundles = models.BooleanField(default=True)
    submissions_close_at = models.DateTimeField(null=True, blank=True)
    wantlist_close_at = models.DateTimeField(null=True, blank=True)
    max_listings_per_user = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    def transition_to(self, new_status):
        allowed = VALID_TRANSITIONS.get(self.status, [])
        if new_status not in allowed:
            from rest_framework.exceptions import ValidationError
            raise ValidationError(
                f'Cannot transition from {self.status} to {new_status}. '
                f'Allowed: {allowed}'
            )
        old_status = self.status
        self.status = new_status
        self.save()
        self._run_side_effects(old_status, new_status)

    def _run_side_effects(self, old_status, new_status):
        if old_status == EventStatus.OPEN_SUBMISSIONS and new_status == EventStatus.OPEN_WANTLIST:
            self._assign_item_tokens()
        elif old_status == EventStatus.OPEN_WANTLIST and new_status == EventStatus.MATCHING:
            self._build_match_input()
        elif old_status == EventStatus.MATCHING and new_status == EventStatus.MATCH_REVIEW:
            self._parse_match_output()
        elif old_status == EventStatus.FINALIZED and new_status == EventStatus.SHIPPING:
            self._create_shipments()
        elif old_status == EventStatus.SHIPPING and new_status == EventStatus.ARCHIVED:
            pass  # snapshot / read-only flag is implicit via status

    def _assign_item_tokens(self):
        entries = self.entries.filter(status=EntryStatus.ENTERED).order_by('id')
        alphabet = string.ascii_uppercase
        for i, entry in enumerate(entries):
            if i < 26:
                token = alphabet[i]
            else:
                token = f'{alphabet[(i // 26) - 1]}{alphabet[i % 26]}'
            entry.item_token = token
            entry.save(update_fields=['item_token'])

    def _build_match_input(self):
        from matching.adapter import build_input
        from matching.models import MatchResult
        input_json, input_text = build_input(self)
        MatchResult.objects.create(
            event=self,
            input_json=input_json,
            input_text=input_text,
            output_json={},
            status='PENDING',
        )

    def _parse_match_output(self):
        from matching.models import MatchResult
        result = MatchResult.objects.filter(event=self).order_by('-started_at').first()
        if result and result.status == 'DONE':
            from matching.adapter import parse_output
            parse_output(result)

    def _create_shipments(self):
        from matching.models import Assignment
        from shipping.models import Shipment
        for assignment in Assignment.objects.filter(match_result__event=self):
            Shipment.objects.get_or_create(assignment=assignment)


class EntryStatus(models.TextChoices):
    ENTERED   = 'ENTERED',   'Entered'
    WITHDRAWN = 'WITHDRAWN', 'Withdrawn'


class EventEntry(models.Model):
    event = models.ForeignKey(TradeEvent, on_delete=models.CASCADE, related_name='entries')
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name='event_entries')
    item_token = models.CharField(max_length=10, blank=True, null=True)
    status = models.CharField(
        max_length=20, choices=EntryStatus.choices, default=EntryStatus.ENTERED
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('event', 'listing')]

    def __str__(self):
        return f'{self.event.slug}/{self.item_token or self.pk}'
