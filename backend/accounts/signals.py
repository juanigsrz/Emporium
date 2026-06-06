"""
accounts/signals.py

Auto-create a Profile row whenever a new User is created.
"""

from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile

User = get_user_model()


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Create a Profile for every new User."""
    if created:
        Profile.objects.get_or_create(user=instance)
