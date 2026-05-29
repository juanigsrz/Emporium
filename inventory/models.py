from django.db import models
from django.contrib.auth.models import User
from catalog.models import Game


class Condition(models.TextChoices):
    NEW        = 'NEW',        'New / sealed'
    LIKE_NEW   = 'LIKE_NEW',   'Like new'
    VERY_GOOD  = 'VERY_GOOD',  'Very good'
    GOOD       = 'GOOD',       'Good'
    ACCEPTABLE = 'ACCEPTABLE', 'Acceptable'
    FOR_PARTS  = 'FOR_PARTS',  'For parts / incomplete'


class Completeness(models.TextChoices):
    COMPLETE      = 'COMPLETE',      'Complete'
    MISSING_MINOR = 'MISSING_MINOR', 'Missing minor components'
    MISSING_MAJOR = 'MISSING_MAJOR', 'Missing major components'


class Listing(models.Model):
    game = models.ForeignKey(Game, on_delete=models.PROTECT, related_name='listings')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='listings')
    condition = models.CharField(
        max_length=20, choices=Condition.choices, default=Condition.VERY_GOOD
    )
    language = models.CharField(max_length=10, blank=True, default='EN')
    bgg_version_id = models.IntegerField(null=True, blank=True)
    edition_note = models.CharField(max_length=200, blank=True)
    completeness = models.CharField(
        max_length=20, choices=Completeness.choices, default=Completeness.COMPLETE
    )
    notes = models.TextField(blank=True)
    estimated_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.game.name} ({self.owner.username}) #{self.pk}'


class Photo(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='photos')
    image = models.ImageField(upload_to='listing_photos/')
    caption = models.CharField(max_length=200, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order']
