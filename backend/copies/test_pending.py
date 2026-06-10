from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame, BoardGameVersion
from copies.models import Copy

User = get_user_model()


class PendingCopyTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.bg = BoardGame.objects.create(bgg_id=224517, name="Brass")
        self.version = BoardGameVersion.objects.create(
            board_game=self.bg, bgg_version_id=1, name="English Ed.", language="English"
        )
        self.client.force_authenticate(self.u)
        self.copy = Copy.objects.create(owner=self.u, board_game=self.bg, is_pending=True)

    def test_patch_language_only_stays_pending(self):
        # Patching version derives language but condition is still missing → still pending
        r = self.client.patch(
            f"/api/copies/{self.copy.id}/", {"version": self.version.pk}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.copy.refresh_from_db()
        self.assertTrue(self.copy.is_pending)  # condition still missing

    def test_patch_both_clears_pending(self):
        # First patch: set version → derives language="English"
        self.client.patch(
            f"/api/copies/{self.copy.id}/", {"version": self.version.pk}, format="json"
        )
        # Second patch: set condition — now both language and condition present
        r = self.client.patch(f"/api/copies/{self.copy.id}/", {"condition": "GOOD"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.copy.refresh_from_db()
        self.assertFalse(self.copy.is_pending)
