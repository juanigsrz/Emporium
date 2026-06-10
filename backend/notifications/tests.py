from django.contrib.auth import get_user_model
from django.test import TestCase
from notifications.models import Notification


class NotificationModelTests(TestCase):
    def test_create_defaults(self):
        u = get_user_model().objects.create_user("nina", password="x")
        n = Notification.objects.create(user=u, message="hi")
        self.assertFalse(n.read)
        self.assertEqual(n.kind, "EVENT_STATUS")
