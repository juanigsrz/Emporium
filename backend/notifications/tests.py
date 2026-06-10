from django.contrib.auth import get_user_model
from django.test import TestCase
from notifications.models import Notification


class NotificationModelTests(TestCase):
    def test_create_defaults(self):
        u = get_user_model().objects.create_user("nina", password="x")
        n = Notification.objects.create(user=u, message="hi")
        self.assertFalse(n.read)
        self.assertEqual(n.kind, "EVENT_STATUS")


from rest_framework.test import APITestCase
from events.models import TradeEvent, EventParticipation


class TransitionNotifyTests(APITestCase):
    def setUp(self):
        U = get_user_model()
        self.org = U.objects.create_user("org", password="x")
        self.p1 = U.objects.create_user("p1", password="x")
        self.p2 = U.objects.create_user("p2", password="x")
        self.event = TradeEvent.objects.create(name="E", organizer=self.org, status=TradeEvent.Status.SUBMISSIONS_OPEN)
        EventParticipation.objects.create(event=self.event, user=self.p1)
        EventParticipation.objects.create(event=self.event, user=self.p2)

    def test_transition_notifies_each_participant(self):
        self.client.force_authenticate(self.org)
        r = self.client.post(f"/api/events/{self.event.slug}/transition/", {"to": "WANTLIST_OPEN"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(Notification.objects.filter(user=self.p1, event=self.event).count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.p2, event=self.event).count(), 1)
        self.assertIn("Want-list Open", Notification.objects.get(user=self.p1).message)
