from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings

from bgg.client import BggClient, CollectionRow

FIX = Path(__file__).parent / "fixtures"


def _html(name):
    return (FIX / name).read_text(encoding="utf-8")


class FakeResp:
    def __init__(self, text, status=200):
        self.text = text
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@override_settings(BGG_REQUEST_DELAY=0)
class BggClientParseTest(TestCase):
    def test_parses_wishlist_rows(self):
        with patch("bgg.client.requests.get", return_value=FakeResp(_html("wishlist.html"))):
            rows = BggClient().fetch_collection("juaniisuar", "WISHLIST")
        self.assertEqual([r.bgg_id for r in rows], [224517, 167791])
        self.assertEqual(rows[0].name, "Brass: Birmingham")
        self.assertEqual(rows[0].wishlist_comment, "Need the deluxe")

    def test_parses_rating(self):
        with patch("bgg.client.requests.get", return_value=FakeResp(_html("rated.html"))):
            rows = BggClient().fetch_collection("juaniisuar", "RATED")
        self.assertEqual(rows[0].my_rating, __import__("decimal").Decimal("8"))

    def test_expansions_use_expansion_href(self):
        with patch("bgg.client.requests.get", return_value=FakeResp(_html("owned_expansions.html"))):
            rows = BggClient().fetch_collection("juaniisuar", "OWNED_EXPANSIONS")
        self.assertTrue(all(r.bgg_id for r in rows))

    def test_follows_pagination(self):
        pages = [FakeResp(_html("collection_page1.html")), FakeResp(_html("collection_page2.html"))]
        with patch("bgg.client.requests.get", side_effect=pages):
            rows = BggClient().fetch_collection("juaniisuar", "OWNED")
        self.assertGreaterEqual(len(rows), 2)

    def test_geeklist(self):
        with patch("bgg.client.requests.get", return_value=FakeResp(_html("geeklist.html"))):
            rows = BggClient().fetch_geeklist("123456")
        self.assertIn(342942, [r.bgg_id for r in rows])

    def test_missing_cells_are_none(self):
        with patch("bgg.client.requests.get", return_value=FakeResp(_html("owned.html"))):
            rows = BggClient().fetch_collection("juaniisuar", "OWNED")
        self.assertIsNone(rows[0].my_rating)
        self.assertIsNone(rows[0].language)
