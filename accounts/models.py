from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    bgg_username = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    bgg_verified = models.BooleanField(default=False)
    default_country = models.CharField(max_length=10, blank=True)
    default_region = models.CharField(max_length=20, blank=True)
    is_organizer = models.BooleanField(default=False)
    timezone = models.CharField(max_length=50, blank=True, default='UTC')

    def __str__(self):
        return f'{self.user.username} profile'


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
