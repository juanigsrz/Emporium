from django.conf import settings
from django.db import models


class Notification(models.Model):
    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    event   = models.ForeignKey("events.TradeEvent", on_delete=models.CASCADE, null=True, blank=True, related_name="notifications")
    kind    = models.CharField(max_length=32, default="EVENT_STATUS")
    message = models.CharField(max_length=255)
    read    = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"Notification(user={self.user_id}, read={self.read}, {self.message!r})"
