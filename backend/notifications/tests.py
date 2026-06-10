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


class NotificationApiTests(APITestCase):
    def setUp(self):
        U = get_user_model()
        self.me = U.objects.create_user("me", password="x")
        self.other = U.objects.create_user("other", password="x")
        Notification.objects.create(user=self.me, message="a")
        Notification.objects.create(user=self.me, message="b", read=True)
        Notification.objects.create(user=self.other, message="c")
        self.client.force_authenticate(self.me)

    def test_list_only_mine(self):
        self.assertEqual(self.client.get("/api/notifications/").data["count"], 2)

    def test_unread_filter(self):
        self.assertEqual(self.client.get("/api/notifications/?unread=1").data["count"], 1)

    def test_mark_one_read(self):
        nid = Notification.objects.filter(user=self.me, read=False).first().id
        self.assertEqual(self.client.post(f"/api/notifications/{nid}/read/").status_code, 200)
        self.assertTrue(Notification.objects.get(id=nid).read)

    def test_cannot_read_others(self):
        nid = Notification.objects.get(user=self.other).id
        self.assertEqual(self.client.post(f"/api/notifications/{nid}/read/").status_code, 404)

    def test_read_all(self):
        self.assertEqual(self.client.post("/api/notifications/read-all/").status_code, 200)
        self.assertEqual(Notification.objects.filter(user=self.me, read=False).count(), 0)
