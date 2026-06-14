"""Contract tests for POST /api/auth/google/ (dj-rest-auth GoogleLogin).

We use the access_token flow: the frontend sends a Google OAuth access token,
allauth fetches the user info, and a user is created/logged in. The userinfo
HTTP call is mocked so the test is hermetic.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()

FAKE_USERINFO = {
    "sub": "109876543210987654321",
    "email": "googler@example.com",
    "email_verified": True,
    "name": "Goog Ler",
    "given_name": "Goog",
    "family_name": "Ler",
    "picture": "",
}


@override_settings(
    SOCIALACCOUNT_PROVIDERS={
        "google": {"APP": {"client_id": "test-client-id", "secret": "test-secret", "key": ""}}
    }
)
class GoogleLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = "/api/auth/google/"

    @mock.patch(
        "allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter._fetch_user_info",
        return_value=FAKE_USERINFO,
    )
    def test_access_token_login_creates_user_and_returns_key(self, _mock_info):
        r = self.client.post(self.url, {"access_token": "fake-access-token"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn("key", r.data)
        self.assertTrue(User.objects.filter(email="googler@example.com").exists())

    @mock.patch(
        "allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter._fetch_user_info",
        return_value=FAKE_USERINFO,
    )
    def test_access_token_login_is_idempotent(self, _mock_info):
        self.client.post(self.url, {"access_token": "t1"}, format="json")
        self.client.post(self.url, {"access_token": "t2"}, format="json")
        self.assertEqual(User.objects.filter(email="googler@example.com").count(), 1)

    def test_missing_token_rejected(self):
        r = self.client.post(self.url, {}, format="json")
        self.assertEqual(r.status_code, 400)
