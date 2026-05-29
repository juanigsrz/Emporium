from django.db import models
from matching.models import Assignment


class ShipmentStatus(models.TextChoices):
    PENDING  = 'PENDING',  'Pending'
    SHIPPED  = 'SHIPPED',  'Shipped'
    RECEIVED = 'RECEIVED', 'Received'


class Shipment(models.Model):
    assignment = models.OneToOneField(Assignment, on_delete=models.CASCADE,
                                      related_name='shipment')
    status = models.CharField(
        max_length=10, choices=ShipmentStatus.choices, default=ShipmentStatus.PENDING
    )
    tracking = models.CharField(max_length=200, blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    disputed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f'Shipment #{self.pk} ({self.status})'
