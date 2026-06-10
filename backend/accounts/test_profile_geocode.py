from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class ProfileGeocodeTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(self.u)

    def test_patch_location_geocodes(self):
        with patch("accounts.serializers.geocode", return_value=(-34.6, -58.4)) as g:
            r = self.client.patch("/api/profiles/me/", {"location": "Buenos Aires"}, format="json")
        self.assertEqual(r.status_code, 200)
        g.assert_called_once()
        self.assertAlmostEqual(r.data["latitude"], -34.6)
        self.assertAlmostEqual(r.data["longitude"], -58.4)

    def test_max_trade_distance_roundtrips(self):
        r = self.client.patch("/api/profiles/me/", {"max_trade_distance_km": 50}, format="json")
        self.assertEqual(r.data["max_trade_distance_km"], 50)

    def test_geocode_failure_surfaces_error(self):
        with patch("accounts.serializers.geocode", side_effect=Exception("nominatim down")):
            r = self.client.patch("/api/profiles/me/", {"location": "Nowhere"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("location", r.data)

    def test_clearing_location_clears_coords(self):
        with patch("accounts.serializers.geocode", return_value=(-34.6, -58.4)):
            self.client.patch("/api/profiles/me/", {"location": "Buenos Aires"}, format="json")
        r = self.client.patch("/api/profiles/me/", {"location": ""}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["latitude"])
        self.assertIsNone(r.data["longitude"])

    def test_explicit_coords_skip_geocode(self):
        with patch("accounts.serializers.geocode") as g:
            resp = self.client.patch(
                "/api/profiles/me/",
                {"location": "Rosario, Santa Fe, Argentina", "latitude": -32.95, "longitude": -60.64},
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        g.assert_not_called()
        self.u.profile.refresh_from_db()
        self.assertAlmostEqual(self.u.profile.latitude, -32.95)

    def test_unresolvable_location_surfaces_error(self):
        with patch("accounts.serializers.geocode", return_value=None):
            resp = self.client.patch("/api/profiles/me/", {"location": "zzzz nowhere"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("location", resp.data)
