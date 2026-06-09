from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from bgg.models import ImportJob

User = get_user_model()


class ImportApiTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", password="x")
        self.alice.profile.bgg_username = "juaniisuar"
        self.alice.profile.save()
        self.client.force_authenticate(self.alice)

    def test_post_requires_bgg_username_for_collection_kinds(self):
        self.alice.profile.bgg_username = ""
        self.alice.profile.save()
        r = self.client.post("/api/bgg/imports/", {"kind": "WISHLIST"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_post_creates_job_and_runs_eagerly(self):
        # Patch the client so this stays offline even after the WISHLIST importer
        # is registered (Task B1); the dispatcher runs eagerly inside the POST.
        with patch("bgg.client.BggClient.fetch_collection", return_value=[]):
            r = self.client.post("/api/bgg/imports/", {"kind": "WISHLIST"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertIn(r.data["status"], ("DONE", "FAILED"))  # eager → terminal already
        job = ImportJob.objects.get(id=r.data["id"])
        self.assertEqual(job.user, self.alice)

    def test_geeklist_requires_source_ref(self):
        r = self.client.post("/api/bgg/imports/", {"kind": "GEEKLIST"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_get_is_mine_only(self):
        bob = User.objects.create_user("bob", password="x")
        job = ImportJob.objects.create(user=bob, kind="WISHLIST")
        r = self.client.get(f"/api/bgg/imports/{job.id}/")
        self.assertEqual(r.status_code, 404)
