from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class GeocodeSearchViewTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(self.u)

    def test_returns_suggestions(self):
        fake = [{"display_name": "Paris, France", "lat": 48.85, "lon": 2.35}]
        with patch("accounts.views.geocode_search", return_value=fake) as g:
            r = self.client.get("/api/geocode/search/", {"q": "Paris"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, fake)
        g.assert_called_once()

    def test_blank_query_returns_empty(self):
        r = self.client.get("/api/geocode/search/", {"q": ""})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, [])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        r = self.client.get("/api/geocode/search/", {"q": "Paris"})
        self.assertIn(r.status_code, (401, 403))


class GeocodeSearchFnTest(APITestCase):
    def test_maps_nominatim_results(self):
        from accounts.geo import geocode_search
        fake_resp = [{"display_name": "Paris, France", "lat": "48.85", "lon": "2.35"}]
        with patch("accounts.geo.requests.get") as mock_get:
            mock_get.return_value.json.return_value = fake_resp
            out = geocode_search("Paris")
        self.assertEqual(out, [{"display_name": "Paris, France", "lat": 48.85, "lon": 2.35}])

    def test_short_query_skips_request(self):
        from accounts.geo import geocode_search
        with patch("accounts.geo.requests.get") as mock_get:
            out = geocode_search("Pa")
        self.assertEqual(out, [])
        mock_get.assert_not_called()

    def test_network_error_returns_empty(self):
        from accounts.geo import geocode_search
        with patch("accounts.geo.requests.get", side_effect=Exception("nominatim down")):
            out = geocode_search("Paris")
        self.assertEqual(out, [])

    def test_failure_is_logged(self):
        # A swallowed failure (e.g. Nominatim 403 on a blocked UA) must be logged,
        # not invisible — that silence is what made "always empty" undiagnosable.
        from accounts.geo import geocode_search
        with patch("accounts.geo.requests.get", side_effect=Exception("403")):
            with self.assertLogs("accounts.geo", level="WARNING") as cm:
                geocode_search("Paris")
        self.assertTrue(any("geocode_search" in m for m in cm.output))

    def test_user_agent_is_nominatim_compliant(self):
        # The OSM placeholder UA ("example.org") is blocked with 403; guard against
        # regressing the Nominatim UA back to the (BGG-shared) placeholder.
        from django.conf import settings
        self.assertNotIn("example.org", settings.NOMINATIM_USER_AGENT)
