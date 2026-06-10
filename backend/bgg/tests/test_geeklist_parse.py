import json
from unittest.mock import call, patch

from django.test import TestCase, override_settings

from bgg.client import BggClient

_SINGLE = json.dumps({
    "data": [
        {
            "type": "listitems",
            "id": "12892074",
            "listid": "379573",
            "item": {
                "type": "things",
                "id": "230802",
                "name": "Azul",
                "href": "/boardgame/230802/azul",
                "label": "Board Game",
            },
        }
    ],
    "pagination": {"pageid": 1, "perPage": 25, "total": 1},
})

_PAGE1 = json.dumps({
    "data": [
        {"type": "listitems", "id": "1", "listid": "1",
         "item": {"type": "things", "id": "111", "name": "GameA"}},
    ],
    "pagination": {"pageid": 1, "perPage": 1, "total": 2},
})

_PAGE2 = json.dumps({
    "data": [
        {"type": "listitems", "id": "2", "listid": "1",
         "item": {"type": "things", "id": "222", "name": "GameB"}},
    ],
    "pagination": {"pageid": 2, "perPage": 1, "total": 2},
})

_WITH_NOISE = json.dumps({
    "data": [
        # valid thing
        {"type": "listitems", "id": "1", "listid": "1",
         "item": {"type": "things", "id": "174430", "name": "Gloomhaven"}},
        # non-things type — should be skipped
        {"type": "listitems", "id": "2", "listid": "1",
         "item": {"type": "designers", "id": "99999", "name": "ShouldSkip"}},
        # missing id — should be skipped
        {"type": "listitems", "id": "3", "listid": "1",
         "item": {"type": "things", "name": "NoId"}},
        # non-int id — should be skipped
        {"type": "listitems", "id": "4", "listid": "1",
         "item": {"type": "things", "id": "badid", "name": "BadId"}},
    ],
    "pagination": {"pageid": 1, "perPage": 25, "total": 1},
})


@override_settings(BGG_REQUEST_DELAY=0, BGG_MAX_PAGES=10)
class GeeklistParseTests(TestCase):
    def test_single_page_returns_correct_row(self):
        with patch.object(BggClient, "_get", return_value=_SINGLE):
            rows = BggClient().fetch_geeklist("379573")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].bgg_id, 230802)
        self.assertEqual(rows[0].name, "Azul")

    def test_pagination_collects_all_items(self):
        with patch.object(BggClient, "_get", side_effect=[_PAGE1, _PAGE2]) as mock_get:
            rows = BggClient().fetch_geeklist("1")
        self.assertEqual({r.bgg_id for r in rows}, {111, 222})
        self.assertEqual(mock_get.call_count, 2)

    def test_skips_non_things_and_invalid_ids(self):
        with patch.object(BggClient, "_get", return_value=_WITH_NOISE):
            rows = BggClient().fetch_geeklist("1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].bgg_id, 174430)
        self.assertNotIn(99999, [r.bgg_id for r in rows])
