"""
catalog/models.py

F2 Canonical Games model — keyed by BGG id.
"""

from django.db import models


class BoardGame(models.Model):
    """
    Canonical board game record, sourced from BGG data (CSV import).

    bgg_id is the primary key (BGG integer id).
    category_ranks holds per-category BGG rankings as a JSON dict.
    metadata holds deferred fields (designers, publishers, mechanics, etc.)
    that will be populated in a future BGG API sync pass.
    """

    bgg_id = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=300, db_index=True)
    year_published = models.IntegerField(null=True, blank=True)
    rank = models.IntegerField(null=True, blank=True, db_index=True)
    bayes_average = models.FloatField(null=True, blank=True)
    average = models.FloatField(null=True, blank=True)
    users_rated = models.IntegerField(default=0)
    is_expansion = models.BooleanField(default=False)
    category_ranks = models.JSONField(default=dict)
    image_url = models.URLField(blank=True, default="")
    # Deferred future-sync fields (designers, publishers, mechanics, categories, etc.)
    metadata = models.JSONField(default=dict)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["rank", "-users_rated"]
        indexes = [
            models.Index(fields=["rank"]),
            models.Index(fields=["-users_rated"]),
            models.Index(fields=["name"]),
        ]

    def __str__(self):
        return f"{self.name} (BGG #{self.bgg_id})"
