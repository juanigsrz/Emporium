# Canonical Game Enrichment + Versioned Copies — Implementation Plan (Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lazily enrich `catalog.BoardGame` from the BGG XML API on first request, store editions as `catalog.BoardGameVersion`, and require a `Copy` to reference a version (which sets its language).

**Architecture:** A best-effort, synchronous-with-throttle enrichment service in the `bgg` app fetches `thing?stats=1&versions=1` once per game, writes scalar fields into `BoardGame.metadata` and upserts `BoardGameVersion` rows. The catalog detail + a new versions endpoint trigger it. `Copy` gains a required `version` FK; language is derived from the version.

**Tech Stack:** Django 5, DRF, `requests`, stdlib `xml.etree.ElementTree`, LocMemCache.

**Scope:** Backend only. The frontend copy-create version picker is a separate follow-up plan. This plan does not touch the standalone `enrich_bgg.py` scraper.

**Spec:** `docs/superpowers/specs/2026-06-10-canonical-game-enrichment-design.md`

**How to run tests:** from `backend/` with the venv active (`source venv/bin/activate`), run `python manage.py test <dotted.path>`.

---

## File Structure

- Create `backend/bgg/thing_parse.py` — pure-stdlib XML → dicts parser.
- Create `backend/bgg/thing_api.py` — `fetch_thing_xml(bgg_id)` HTTP client (requests + bearer).
- Create `backend/bgg/enrich.py` — `ensure_game_enriched(bgg_id)` orchestration (lock, throttle, persist).
- Modify `backend/catalog/models.py` — add `BoardGameVersion`.
- Modify `backend/copies/models.py` — add `Copy.version` FK + language derivation.
- Modify `backend/catalog/serializers.py` — `BoardGameVersionSerializer` + new detail fields.
- Modify `backend/catalog/views.py` — detail triggers enrichment; new `BoardGameVersionsView`.
- Modify `backend/catalog/urls.py` — `games/<id>/versions/` route.
- Modify `backend/copies/serializers.py` — `version` required, `language` read-only, cross-validate.
- Modify `backend/bgtrade/settings.py` — `BGG_LAZY_FETCH_DELAY`.
- Create `backend/bgg/tests/fixtures/thing_13.xml` — copied API response fixture.
- Create `backend/bgg/tests/test_thing_parse.py`, `backend/bgg/tests/test_enrich.py`.
- Create `backend/catalog/tests_versions.py` — versions endpoint + enrichment trigger.
- Modify `backend/copies/tests.py` — existing create tests now supply `version`.

---

## Task 1: `BoardGameVersion` model

**Files:**
- Modify: `backend/catalog/models.py`
- Test: `backend/catalog/tests_versions.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/catalog/tests_versions.py`:

```python
from django.test import TestCase

from catalog.models import BoardGame, BoardGameVersion


class BoardGameVersionModelTest(TestCase):
    def test_create_version_linked_to_game(self):
        game = BoardGame.objects.create(bgg_id=13, name="Catan")
        v = BoardGameVersion.objects.create(
            bgg_id=416798,
            board_game=game,
            name="Afrikaans edition",
            language="Afrikaans",
            publisher="Catan Studio",
            year_published=0,
            width=11.7,
            length=11.7,
            depth=2.8,
            weight=0.0,
        )
        self.assertEqual(v.pk, 416798)
        self.assertEqual(game.versions.count(), 1)
        self.assertEqual(game.versions.first().name, "Afrikaans edition")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test catalog.tests_versions -v 2`
Expected: FAIL — `ImportError: cannot import name 'BoardGameVersion'`.

- [ ] **Step 3: Add the model**

Append to `backend/catalog/models.py`:

```python
class BoardGameVersion(models.Model):
    """A specific edition/version of a BoardGame, sourced from the BGG API."""

    bgg_id = models.IntegerField(primary_key=True)  # BGG version id
    board_game = models.ForeignKey(
        BoardGame, on_delete=models.CASCADE, related_name="versions"
    )
    name = models.CharField(max_length=300, blank=True, default="")
    thumbnail_url = models.URLField(max_length=500, blank=True, default="")
    language = models.CharField(max_length=300, blank=True, default="")  # pipe-joined if multiple
    publisher = models.CharField(max_length=500, blank=True, default="")  # pipe-joined value(s)
    year_published = models.IntegerField(null=True, blank=True)
    width = models.FloatField(null=True, blank=True)
    length = models.FloatField(null=True, blank=True)
    depth = models.FloatField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)  # physical weight, NOT complexity

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["bgg_id"]

    def __str__(self):
        return f"{self.name} (v#{self.bgg_id})"
```

- [ ] **Step 4: Make + apply the migration**

Run: `python manage.py makemigrations catalog`
Expected: creates `catalog/migrations/0002_boardgameversion.py`.
Run: `python manage.py migrate catalog`
Expected: applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test catalog.tests_versions -v 2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/catalog/models.py backend/catalog/migrations/ backend/catalog/tests_versions.py
git commit -m "feat(catalog): add BoardGameVersion model"
```

---

## Task 2: `Copy.version` FK + language derivation

**Files:**
- Modify: `backend/copies/models.py`
- Test: `backend/copies/tests.py` (add one test)

- [ ] **Step 1: Write the failing test**

Add to `backend/copies/tests.py` (a new test class at the end of the file):

```python
from catalog.models import BoardGameVersion  # add near the other imports


class CopyVersionModelTest(APITestCase):
    def test_save_derives_language_from_version(self):
        game = BoardGame.objects.create(bgg_id=13, name="Catan")
        version = BoardGameVersion.objects.create(
            bgg_id=416798, board_game=game, name="German edition", language="German"
        )
        user = User.objects.create_user(username="u1", password="pw")
        copy = Copy.objects.create(owner=user, board_game=game, version=version)
        self.assertEqual(copy.language, "German")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test copies.tests.CopyVersionModelTest -v 2`
Expected: FAIL — `TypeError`/`FieldError` (no `version` field).

- [ ] **Step 3: Add the field + derivation**

In `backend/copies/models.py`, add the FK in the "Relations" block (after `board_game`):

```python
    version = models.ForeignKey(
        "catalog.BoardGameVersion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="copies",
    )
```

In `Copy.save`, derive language before generating the listing code:

```python
    def save(self, *args, **kwargs):
        """Auto-generate listing_code and derive language from the chosen version."""
        if self.version_id:
            self.language = self.version.language
        if not self.listing_code:
            for _ in range(MAX_CODE_RETRIES):
                code = _generate_listing_code()
                if not Copy.objects.filter(listing_code=code).exists():
                    self.listing_code = code
                    break
            else:
                raise IntegrityError(
                    "Could not generate a unique listing_code after "
                    f"{MAX_CODE_RETRIES} attempts."
                )
        super().save(*args, **kwargs)
```

- [ ] **Step 4: Make + apply the migration**

Run: `python manage.py makemigrations copies`
Expected: creates `copies/migrations/000X_copy_version.py` (nullable FK).
Run: `python manage.py migrate copies`
Expected: applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test copies.tests.CopyVersionModelTest -v 2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/copies/models.py backend/copies/migrations/ backend/copies/tests.py
git commit -m "feat(copies): add Copy.version FK, derive language from version"
```

---

## Task 3: `thing_parse.py` parser

**Files:**
- Create: `backend/bgg/tests/fixtures/thing_13.xml`
- Create: `backend/bgg/thing_parse.py`
- Create: `backend/bgg/tests/test_thing_parse.py`

- [ ] **Step 1: Copy the fixture**

Run from repo root:
`cp bgg_results.xml backend/bgg/tests/fixtures/thing_13.xml`
Expected: file exists (a real `thing?id=13&stats=1&versions=1` response with 144 versions).

- [ ] **Step 2: Write the failing test**

Create `backend/bgg/tests/test_thing_parse.py`:

```python
from pathlib import Path

from django.test import TestCase

from bgg.thing_parse import parse_things

FIX = Path(__file__).parent / "fixtures" / "thing_13.xml"


class ThingParseTest(TestCase):
    def setUp(self):
        self.xml = FIX.read_text(encoding="utf-8")

    def test_parses_game_fields(self):
        games, _ = parse_things(self.xml)
        self.assertIn("13", games)
        g = games["13"]
        self.assertEqual(g["minplayers"], "3")
        self.assertEqual(g["maxplayers"], "4")
        self.assertEqual(g["averageweight"], "2.2817")
        self.assertEqual(g["languagedependence"], 2)
        self.assertTrue(g["thumbnail"].startswith("https://"))

    def test_parses_versions_with_multilanguage(self):
        _, versions = parse_things(self.xml)
        self.assertTrue(len(versions) > 100)
        multi = [v for v in versions if "|" in v["language"]]
        self.assertTrue(multi, "expected at least one multi-language version")
        v = multi[0]
        self.assertEqual(v["boardgame_id"], "13")
        self.assertIn("|", v["language"])
        self.assertTrue(v["publisher"])
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python manage.py test bgg.tests.test_thing_parse -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'bgg.thing_parse'`.

- [ ] **Step 4: Write the parser**

Create `backend/bgg/thing_parse.py`:

```python
"""Pure-stdlib parser for BGG xmlapi2 `thing?stats=1&versions=1` responses."""

import xml.etree.ElementTree as ET


def _val(el):
    return el.get("value", "") if el is not None else ""


def _langdep(item):
    """Return (level, label) of the most-voted language_dependence result.

    Ties break to the lowest level. ("", "") if the poll has no votes."""
    for poll in item.findall("poll"):
        if poll.get("name") != "language_dependence":
            continue
        best = None  # (level, votes, label)
        for res in poll.iter("result"):
            try:
                level = int(res.get("level", ""))
                votes = int(res.get("numvotes", "0"))
            except ValueError:
                continue
            if best is None or votes > best[1] or (votes == best[1] and level < best[0]):
                best = (level, votes, res.get("value", ""))
        if best and best[1] > 0:
            return best[0], best[2]
        return "", ""
    return "", ""


def _parse_version(v, parent_id):
    name = ""
    for n in v.findall("name"):
        if n.get("type") == "primary":
            name = n.get("value", "")
            break
    else:
        first = v.find("name")
        if first is not None:
            name = first.get("value", "")
    langs = [l.get("value", "") for l in v.findall("link") if l.get("type") == "language"]
    pubs = [l.get("value", "") for l in v.findall("link") if l.get("type") == "boardgamepublisher"]
    return {
        "boardgame_id": parent_id,
        "id": v.get("id"),
        "name": name,
        "thumbnail": (v.findtext("thumbnail") or "").strip(),
        "language": "|".join(langs),
        "publisher": "|".join(pubs),
        "yearpublished": _val(v.find("yearpublished")),
        "width": _val(v.find("width")),
        "length": _val(v.find("length")),
        "depth": _val(v.find("depth")),
        "weight": _val(v.find("weight")),
    }


def parse_things(xml):
    """Parse a thing response into ({game_id: fields}, [version_rows])."""
    root = ET.fromstring(xml)
    games = {}
    versions = []
    for item in root.findall("item"):
        if item.get("type") not in ("boardgame", "boardgameexpansion"):
            continue
        gid = item.get("id")
        level, label = _langdep(item)
        games[gid] = {
            "thumbnail": (item.findtext("thumbnail") or "").strip(),
            "minplayers": _val(item.find("minplayers")),
            "maxplayers": _val(item.find("maxplayers")),
            "averageweight": _val(item.find("statistics/ratings/averageweight")),
            "languagedependence": level,
            "languagedependence_label": label,
        }
        vers_el = item.find("versions")
        if vers_el is not None:
            for v in vers_el.findall("item"):
                if v.get("type") == "boardgameversion":
                    versions.append(_parse_version(v, gid))
    return games, versions
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test bgg.tests.test_thing_parse -v 2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/bgg/thing_parse.py backend/bgg/tests/test_thing_parse.py backend/bgg/tests/fixtures/thing_13.xml
git commit -m "feat(bgg): add thing_parse for BGG thing API responses"
```

---

## Task 4: `thing_api.py` HTTP client

**Files:**
- Create: `backend/bgg/thing_api.py`
- Create: test in `backend/bgg/tests/test_enrich.py` (client part; same file reused in Task 6)

- [ ] **Step 1: Write the failing test**

Create `backend/bgg/tests/test_enrich.py`:

```python
from unittest.mock import patch

from django.test import TestCase, override_settings

from bgg import thing_api


class FakeResp:
    def __init__(self, text="<items/>", status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@override_settings(BGG_API_KEY="test-token", BGG_BASE_URL="https://bgg.test")
class FetchThingTest(TestCase):
    def test_sends_bearer_and_returns_text(self):
        with patch("bgg.thing_api.requests.get", return_value=FakeResp("<items>ok</items>")) as g:
            out = thing_api.fetch_thing_xml(13)
        self.assertEqual(out, "<items>ok</items>")
        _, kwargs = g.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(kwargs["params"]["id"], "13")
        self.assertEqual(kwargs["params"]["stats"], "1")
        self.assertEqual(kwargs["params"]["versions"], "1")

    def test_retries_once_on_429(self):
        responses = [FakeResp(status_code=429), FakeResp("<items>ok</items>")]
        with patch("bgg.thing_api.requests.get", side_effect=responses) as g, \
                patch("bgg.thing_api.time.sleep"):
            out = thing_api.fetch_thing_xml(13)
        self.assertEqual(out, "<items>ok</items>")
        self.assertEqual(g.call_count, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test bgg.tests.test_enrich.FetchThingTest -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'bgg.thing_api'`.

- [ ] **Step 3: Write the client**

Create `backend/bgg/thing_api.py`:

```python
"""Single-id BGG xmlapi2 `thing` fetch with bearer auth and one retry."""

import time

import requests
from django.conf import settings


def fetch_thing_xml(bgg_id, timeout=30):
    """Fetch thing?id=<id>&stats=1&versions=1 XML. Raises on HTTP error."""
    url = f"{settings.BGG_BASE_URL}/xmlapi2/thing"
    params = {"id": str(bgg_id), "stats": "1", "versions": "1"}
    headers = {"Authorization": f"Bearer {settings.BGG_API_KEY}"}
    for attempt in range(2):
        resp = requests.get(url, params=params, headers=headers, timeout=timeout)
        if resp.status_code in (429, 503) and attempt == 0:
            time.sleep(2)
            continue
        resp.raise_for_status()
        return resp.text
    resp.raise_for_status()
    return resp.text
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test bgg.tests.test_enrich.FetchThingTest -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/bgg/thing_api.py backend/bgg/tests/test_enrich.py
git commit -m "feat(bgg): add thing_api.fetch_thing_xml client"
```

---

## Task 5: `BGG_LAZY_FETCH_DELAY` setting

**Files:**
- Modify: `backend/bgtrade/settings.py:262-265`

- [ ] **Step 1: Add the setting**

In `backend/bgtrade/settings.py`, immediately after the `BGG_API_KEY = ...` block, add:

```python
# Minimum seconds between lazy (on-demand) BGG thing fetches, to avoid bursting
# the API when many users open un-synced games at once.
BGG_LAZY_FETCH_DELAY = float(os.environ.get("BGG_LAZY_FETCH_DELAY", "1.5"))
```

- [ ] **Step 2: Verify it loads**

Run: `python manage.py shell -c "from django.conf import settings; print(settings.BGG_LAZY_FETCH_DELAY)"`
Expected: prints `1.5`.

- [ ] **Step 3: Commit**

```bash
git add backend/bgtrade/settings.py
git commit -m "feat(settings): add BGG_LAZY_FETCH_DELAY"
```

---

## Task 6: `enrich.py` — `ensure_game_enriched`

**Files:**
- Create: `backend/bgg/enrich.py`
- Modify: `backend/bgg/tests/test_enrich.py` (add `EnsureEnrichedTest`)

- [ ] **Step 1: Write the failing test**

Append to `backend/bgg/tests/test_enrich.py`:

```python
from pathlib import Path

from django.core.cache import cache

from catalog.models import BoardGame, BoardGameVersion

FIX = Path(__file__).parent / "fixtures" / "thing_13.xml"


@override_settings(BGG_API_KEY="test-token", BGG_LAZY_FETCH_DELAY=0)
class EnsureEnrichedTest(TestCase):
    def setUp(self):
        cache.clear()
        self.xml = FIX.read_text(encoding="utf-8")
        BoardGame.objects.create(bgg_id=13, name="Catan")

    def test_happy_path_writes_metadata_and_versions(self):
        from bgg import enrich
        with patch("bgg.enrich.fetch_thing_xml", return_value=self.xml) as f:
            game = enrich.ensure_game_enriched(13)
            game2 = enrich.ensure_game_enriched(13)  # second call is a no-op
        self.assertEqual(f.call_count, 1)
        self.assertIn("synced_at", game.metadata)
        self.assertEqual(game.metadata["min_players"], 3)
        self.assertEqual(game.metadata["max_players"], 4)
        self.assertEqual(game.metadata["language_dependence"], 2)
        self.assertTrue(BoardGameVersion.objects.filter(board_game_id=13).count() > 100)

    def test_api_failure_is_best_effort(self):
        from bgg import enrich
        with patch("bgg.enrich.fetch_thing_xml", side_effect=RuntimeError("boom")):
            game = enrich.ensure_game_enriched(13)
        self.assertNotIn("synced_at", game.metadata)
        self.assertEqual(BoardGameVersion.objects.filter(board_game_id=13).count(), 0)

    def test_lock_held_skips_fetch(self):
        from bgg import enrich
        cache.add("bgg:enrich:lock:13", 1, timeout=30)
        with patch("bgg.enrich.fetch_thing_xml") as f:
            game = enrich.ensure_game_enriched(13)
        f.assert_not_called()
        self.assertNotIn("synced_at", game.metadata)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test bgg.tests.test_enrich.EnsureEnrichedTest -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'bgg.enrich'`.

- [ ] **Step 3: Write the service**

Create `backend/bgg/enrich.py`:

```python
"""Lazy, best-effort enrichment of catalog.BoardGame from the BGG thing API."""

import logging
import time
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache
from django.db import transaction

from catalog.models import BoardGame, BoardGameVersion
from .thing_api import fetch_thing_xml
from .thing_parse import parse_things

logger = logging.getLogger(__name__)

LOCK_TIMEOUT = 30
LAST_CALL_KEY = "bgg:last_call"


def _int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _throttle():
    """Sleep so consecutive BGG calls are >= BGG_LAZY_FETCH_DELAY apart."""
    delay = settings.BGG_LAZY_FETCH_DELAY
    if delay <= 0:
        return
    last = cache.get(LAST_CALL_KEY)
    now = time.monotonic()
    if last is not None:
        wait = delay - (now - last)
        if wait > 0:
            time.sleep(wait)
    cache.set(LAST_CALL_KEY, time.monotonic(), timeout=None)


def ensure_game_enriched(bgg_id):
    """Return the BoardGame, fetching + persisting BGG details on first call.

    Idempotent (metadata['synced_at'] guards re-fetch) and best-effort (BGG
    failures are logged, never raised). A per-game cache lock prevents
    concurrent duplicate fetches."""
    game, _ = BoardGame.objects.get_or_create(bgg_id=bgg_id, defaults={"name": ""})
    if game.metadata.get("synced_at"):
        return game

    lock_key = f"bgg:enrich:lock:{bgg_id}"
    if not cache.add(lock_key, 1, timeout=LOCK_TIMEOUT):
        return game  # another request is already fetching this game

    try:
        _throttle()
        games, versions = parse_things(fetch_thing_xml(bgg_id))
        data = games.get(str(bgg_id))
        with transaction.atomic():
            if data:
                game.metadata.update({
                    "thumbnail": data["thumbnail"],
                    "min_players": _int(data["minplayers"]),
                    "max_players": _int(data["maxplayers"]),
                    "average_weight": _float(data["averageweight"]),
                    "language_dependence": data["languagedependence"] or None,
                    "language_dependence_label": data["languagedependence_label"],
                })
            game.metadata["synced_at"] = datetime.now(timezone.utc).isoformat()
            game.save(update_fields=["metadata", "updated"])
            for v in versions:
                BoardGameVersion.objects.update_or_create(
                    bgg_id=int(v["id"]),
                    defaults={
                        "board_game": game,
                        "name": v["name"],
                        "thumbnail_url": v["thumbnail"],
                        "language": v["language"],
                        "publisher": v["publisher"],
                        "year_published": _int(v["yearpublished"]),
                        "width": _float(v["width"]),
                        "length": _float(v["length"]),
                        "depth": _float(v["depth"]),
                        "weight": _float(v["weight"]),
                    },
                )
    except Exception as exc:  # best-effort: never break the request
        logger.warning("BGG enrich failed for %s: %s", bgg_id, exc)
    finally:
        cache.delete(lock_key)
    return game
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test bgg.tests.test_enrich.EnsureEnrichedTest -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/bgg/enrich.py backend/bgg/tests/test_enrich.py
git commit -m "feat(bgg): add ensure_game_enriched lazy enrichment service"
```

---

## Task 7: Serializers — version + detail enrichment fields

**Files:**
- Modify: `backend/catalog/serializers.py`
- Test: `backend/catalog/tests_versions.py` (add `DetailSerializerTest`)

- [ ] **Step 1: Write the failing test**

Add to `backend/catalog/tests_versions.py`:

```python
from catalog.serializers import BoardGameDetailSerializer


class DetailEnrichmentFieldsTest(TestCase):
    def test_serializer_exposes_metadata_enrichment(self):
        game = BoardGame.objects.create(
            bgg_id=13,
            name="Catan",
            metadata={
                "thumbnail": "https://x/thumb.png",
                "min_players": 3,
                "max_players": 4,
                "average_weight": 2.28,
                "language_dependence": 2,
                "language_dependence_label": "Some necessary text",
                "synced_at": "2026-06-10T00:00:00+00:00",
            },
        )
        data = BoardGameDetailSerializer(game).data
        self.assertEqual(data["thumbnail"], "https://x/thumb.png")
        self.assertEqual(data["average_weight"], 2.28)
        self.assertEqual(data["language_dependence"], 2)
        self.assertEqual(data["language_dependence_label"], "Some necessary text")
        self.assertEqual(data["min_players"], 3)
```

This tests the serializer directly (no view, no enrichment), so it stands alone
and does not depend on Task 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test catalog.tests_versions.DetailEnrichmentFieldsTest -v 2`
Expected: FAIL — `KeyError: 'thumbnail'` (field not on the serializer).

- [ ] **Step 3: Add the serializer fields**

In `backend/catalog/serializers.py`, inside `BoardGameDetailSerializer`, add four
method fields next to the existing deferred ones:

```python
    thumbnail = serializers.SerializerMethodField()
    average_weight = serializers.SerializerMethodField()
    language_dependence = serializers.SerializerMethodField()
    language_dependence_label = serializers.SerializerMethodField()
```

Add them to `Meta.fields` (after `"image_url"`):

```python
            "thumbnail",
            "average_weight",
            "language_dependence",
            "language_dependence_label",
```

Add the getters (next to the other `get_*` methods):

```python
    def get_thumbnail(self, obj):
        return self._meta(obj, "thumbnail", "")

    def get_average_weight(self, obj):
        return self._meta(obj, "average_weight", None)

    def get_language_dependence(self, obj):
        return self._meta(obj, "language_dependence", None)

    def get_language_dependence_label(self, obj):
        return self._meta(obj, "language_dependence_label", "")
```

Add the version serializer at the end of `backend/catalog/serializers.py`:

```python
from .models import BoardGameVersion  # add at top with the other imports


class BoardGameVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardGameVersion
        fields = [
            "bgg_id",
            "name",
            "thumbnail_url",
            "language",
            "publisher",
            "year_published",
            "width",
            "length",
            "depth",
            "weight",
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test catalog.tests_versions.DetailEnrichmentFieldsTest -v 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/serializers.py backend/catalog/tests_versions.py
git commit -m "feat(catalog): expose enrichment fields + BoardGameVersionSerializer"
```

---

## Task 8: Views + URL — detail triggers enrichment, new versions endpoint

**Files:**
- Modify: `backend/catalog/views.py`
- Modify: `backend/catalog/urls.py`
- Test: `backend/catalog/tests_versions.py` (add `VersionsEndpointTest`)

- [ ] **Step 1: Write the failing test**

Add to `backend/catalog/tests_versions.py`:

```python
from unittest.mock import patch
from pathlib import Path

from django.core.cache import cache
from django.test import override_settings

THING_FIX = Path(__file__).resolve().parent.parent / "bgg" / "tests" / "fixtures" / "thing_13.xml"


@override_settings(BGG_API_KEY="test-token", BGG_LAZY_FETCH_DELAY=0)
class VersionsEndpointTest(APITestCase):
    def setUp(self):
        cache.clear()
        BoardGame.objects.create(bgg_id=13, name="Catan")

    def test_versions_endpoint_triggers_enrichment(self):
        xml = THING_FIX.read_text(encoding="utf-8")
        with patch("bgg.enrich.fetch_thing_xml", return_value=xml):
            resp = self.client.get("/api/games/13/versions/")
        self.assertEqual(resp.status_code, 200)
        results = resp.data["results"] if "results" in resp.data else resp.data
        self.assertTrue(len(results) > 0)
        self.assertIn("language", results[0])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test catalog.tests_versions.VersionsEndpointTest -v 2`
Expected: FAIL — 404 (no `versions/` route).

- [ ] **Step 3: Wire enrichment into the detail view**

In `backend/catalog/views.py`, in `BoardGameDetailView.retrieve`, call enrichment
right after the cache-miss check (before `super().retrieve`):

```python
    def retrieve(self, request, *args, **kwargs):
        key = _cache_key(request, prefix="game_detail")
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)

        from bgg.enrich import ensure_game_enriched  # local import avoids app-load cycle
        ensure_game_enriched(self.kwargs["bgg_id"])

        response = super().retrieve(request, *args, **kwargs)
        cache.set(key, response.data, CACHE_TIMEOUT)
        return response
```

- [ ] **Step 4: Add the versions view**

Append to `backend/catalog/views.py`:

```python
class BoardGameVersionsView(generics.ListAPIView):
    """
    GET /api/games/{bgg_id}/versions/

    Lazily enriches the game (fetching versions from BGG on first call), then
    returns its known editions/versions.
    """

    permission_classes = [permissions.AllowAny]
    pagination_class = GamePagination

    def get_serializer_class(self):
        from .serializers import BoardGameVersionSerializer
        return BoardGameVersionSerializer

    def get_queryset(self):
        from bgg.enrich import ensure_game_enriched
        from .models import BoardGameVersion

        bgg_id = self.kwargs["bgg_id"]
        ensure_game_enriched(bgg_id)
        return BoardGameVersion.objects.filter(board_game_id=bgg_id)
```

- [ ] **Step 5: Add the URL**

In `backend/catalog/urls.py`, import and register the route:

```python
from .views import (
    BoardGameCopiesView,
    BoardGameDetailView,
    BoardGameListView,
    BoardGameVersionsView,
)
```

Add to `urlpatterns` (before the `copies/` line is fine; order does not matter):

```python
    path("games/<int:bgg_id>/versions/", BoardGameVersionsView.as_view(), name="game-versions"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test catalog.tests_versions -v 2`
Expected: PASS — including `DetailEnrichmentFieldsTest` and `VersionsEndpointTest`.

- [ ] **Step 7: Commit**

```bash
git add backend/catalog/views.py backend/catalog/urls.py backend/catalog/tests_versions.py
git commit -m "feat(catalog): lazy-enrich on detail + add versions endpoint"
```

---

## Task 9: Copy serializer — require version, derive/read-only language, validate

**Files:**
- Modify: `backend/copies/serializers.py`
- Modify: `backend/copies/tests.py` (existing create tests + new validation tests)

- [ ] **Step 1: Write the failing tests**

Add to `backend/copies/tests.py` (new class at end):

```python
class CopyVersionApiTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="owner", password="pw")
        self.client.force_authenticate(self.user)
        self.game = BoardGame.objects.create(bgg_id=13, name="Catan")
        self.other_game = BoardGame.objects.create(bgg_id=99, name="Other")
        self.version = BoardGameVersion.objects.create(
            bgg_id=416798, board_game=self.game, name="German edition", language="German"
        )

    def test_create_requires_version(self):
        resp = self.client.post("/api/copies/", {"board_game": 13, "condition": "GOOD"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("version", resp.data)

    def test_create_derives_language_and_ignores_supplied_language(self):
        resp = self.client.post(
            "/api/copies/",
            {"board_game": 13, "version": 416798, "condition": "GOOD", "language": "Klingon"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["language"], "German")

    def test_create_rejects_version_from_other_game(self):
        wrong = BoardGameVersion.objects.create(
            bgg_id=500, board_game=self.other_game, name="X", language="English"
        )
        resp = self.client.post(
            "/api/copies/",
            {"board_game": 13, "version": 500, "condition": "GOOD"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("version", resp.data)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test copies.tests.CopyVersionApiTest -v 2`
Expected: FAIL — `version` not accepted / not required; language not derived.

- [ ] **Step 3: Update the serializer**

In `backend/copies/serializers.py`:

Add the import:

```python
from catalog.models import BoardGame, BoardGameVersion
```

Add the `version` field (next to `board_game`):

```python
    version = serializers.PrimaryKeyRelatedField(
        queryset=BoardGameVersion.objects.all(),
    )
```

Add `"version"` to `Meta.fields` (after `"board_game_name"`), and add
`"language"` to `read_only_fields`:

```python
        read_only_fields = ["id", "listing_code", "owner", "language", "is_pending", "import_source", "created", "updated"]
```

Add a `validate` method to the serializer class:

```python
    def validate(self, attrs):
        board_game = attrs.get("board_game")
        version = attrs.get("version")
        if version and board_game and version.board_game_id != board_game.bgg_id:
            raise serializers.ValidationError(
                {"version": "Selected version does not belong to the selected game."}
            )
        return attrs
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `python manage.py test copies.tests.CopyVersionApiTest -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix existing copy-create tests for the required version**

Existing tests in `backend/copies/tests.py` that POST to `/api/copies/` now need a
`version`. For each such test/helper, ensure a `BoardGameVersion` exists for the
game and include `"version": <version_bgg_id>` in the POST body. Where a test
asserts a specific `language`, set that version's `language` to the expected
value and drop `language` from the POST body (it is now derived).

Concretely: find the helper(s) that build the create payload (search the file
for `"/api/copies/"` POSTs and any `_create_copy`/payload dict) and:
- in `setUp`/helper, add
  `BoardGameVersion.objects.create(bgg_id=<unique>, board_game=<game>, language=<expected>)`;
- add `"version": <that bgg_id>` to the payload;
- remove `"language": ...` from the payload.

Run the whole copies suite to find every breakage:
Run: `python manage.py test copies -v 2`
Expected: iterate until PASS. Each failure names the test; fix its payload as above.

- [ ] **Step 6: Commit**

```bash
git add backend/copies/serializers.py backend/copies/tests.py
git commit -m "feat(copies): require version on create, derive language, validate game match"
```

---

## Task 10: Full suite + schema check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `python manage.py test -v 1`
Expected: all tests pass (prior 182 + the new ones). Investigate and fix any
regression before proceeding — likely candidates are other apps' tests that
create `Copy` rows via the API without a `version`.

- [ ] **Step 2: Confirm no missing migrations**

Run: `python manage.py makemigrations --check --dry-run`
Expected: "No changes detected".

- [ ] **Step 3: Commit any test fixups**

```bash
git add -A
git commit -m "test: align cross-app copy creation with required version"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** metadata fields (Task 6/7), `BoardGameVersion` (Task 1), `Copy.version` + derived language (Task 2/9), lazy sync + lock + throttle (Task 6), best-effort failure (Task 6), detail trigger + versions endpoint (Task 8), `BGG_LAZY_FETCH_DELAY` (Task 5), no CSV/standalone-script touch (none referenced). Frontend is out of scope by design (separate plan).
- **Type consistency:** parser output keys (`minplayers`, `languagedependence`, version `id`/`boardgame_id`, …) are mapped to metadata keys (`min_players`, `language_dependence`, …) only inside `enrich.ensure_game_enriched`; serializers read the metadata keys. `BoardGameVersion.bgg_id` is the PK used everywhere (serializer, FK target, `update_or_create`).
- **Task independence:** Task 7's enrichment-field test exercises the serializer directly (no view), so every task commits green on its own. Task 8 adds the view wiring + versions-endpoint test separately.
