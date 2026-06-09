from django.test import TestCase

from accounts.geo import haversine_km


class HaversineTest(TestCase):
    def test_known_distance_buenos_aires_to_montevideo(self):
        d = haversine_km(-34.6037, -58.3816, -34.9011, -56.1645)
        self.assertAlmostEqual(d, 205, delta=15)

    def test_zero(self):
        self.assertEqual(haversine_km(10, 20, 10, 20), 0.0)
