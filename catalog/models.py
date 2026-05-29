from django.db import models
from django.utils import timezone


class Game(models.Model):
    bgg_id = models.IntegerField(unique=True, db_index=True)
    name = models.CharField(max_length=500, db_index=True)
    year_published = models.IntegerField(null=True, blank=True)
    thumbnail_url = models.URLField(blank=True)
    image_url = models.URLField(blank=True)
    min_players = models.IntegerField(null=True, blank=True)
    max_players = models.IntegerField(null=True, blank=True)
    playing_time = models.IntegerField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)
    avg_rating = models.FloatField(null=True, blank=True)
    description = models.TextField(blank=True)
    last_synced_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f'{self.name} ({self.bgg_id})'

    def needs_sync(self, ttl_days=7):
        age = timezone.now() - self.last_synced_at
        return age.days >= ttl_days


class GameAlternateName(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name='alternate_names')
    name = models.CharField(max_length=500, db_index=True)

    def __str__(self):
        return self.name
