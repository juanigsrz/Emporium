# BGG-Powered QoL Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five BGG-powered QoL features (wishlist sync + builder filters, game ratings + grid auto-tick, duplication-protection toggle, location/distance restrictions, owned/geeklist copy import) on top of the existing Django + React math-trade app.

**Architecture:** A new `bgg` Django app owns all public-HTML scraping behind a `BggClient` + an async, pollable `ImportJob` (Celery, eager in dev/test). F1/F2/F5 are thin importers over that foundation. F3 is a one-toggle FE change. F4 adds lat/lng + haversine + Nominatim geocoding and reuses the solver's existing block path so far-away owners are excluded at match time. Catalog (`BoardGame`, PK=`bgg_id`) is the source of truth; scraped ids not in catalog are skipped and reported.

**Tech Stack:** Django 5.2 / DRF / Celery (eager), `beautifulsoup4` (new), `requests` (present); React 18 / Vite / TanStack Query / Tailwind.

---

## Conventions (read once)

- **BE tests:** `backend/venv/bin/python manage.py test <app> -v2` (run from `backend/`). Full suite: `backend/venv/bin/python manage.py test`. Baseline is 182 green — keep it green.
- **Migrations:** after model edits, `backend/venv/bin/python manage.py makemigrations <app>` then `migrate`. Commit the migration file with the model.
- **Celery is eager** (`CELERY_TASK_ALWAYS_EAGER=True`): `task.delay()` runs inline, so import jobs complete during the POST in tests/dev. Real prod needs a broker (out of scope).
- **No live network in tests.** All BGG/Nominatim HTTP is patched (`unittest.mock.patch`) to return checked-in fixtures.
- **FE has no unit-test runner** (only ESLint). FE tasks end with explicit manual-verification steps; the QA agent verifies against `docs/API_CONTRACT.md`.
- **Contract docs are binding:** update `docs/API_CONTRACT.md` + `docs/DATA_MODEL.md` in the same commit as the endpoint/model they describe.
- **Tags:** `[BE]` backend dev, `[FE]` frontend dev, `[QA]` QA checkpoint.

## Dependency order

```
Phase 0 (foundation) ──► F1, F2, F5   (need the bgg app)
Phase A: F3, F4        (independent — can start immediately, in parallel with Phase 0)
```

---

# Phase 0 — `bgg` foundation  [BE]

### Task 0.1: Add the `bgg` app + dependency + settings

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/bgg/__init__.py`, `backend/bgg/apps.py`
- Modify: `backend/bgtrade/settings.py` (INSTALLED_APPS + new settings block)

- [ ] **Step 1: Add the parser dependency**

In `backend/requirements.txt`, under `# Misc deps`, add:
```
beautifulsoup4==4.13.4
soupsieve==2.6
```

- [ ] **Step 2: Install it**

Run: `backend/venv/bin/pip install beautifulsoup4==4.13.4`
Expected: `Successfully installed beautifulsoup4-4.13.4 soupsieve-2.6` (or already satisfied).

- [ ] **Step 3: Create the app package**

`backend/bgg/__init__.py`: empty file.
`backend/bgg/apps.py`:
```python
from django.apps import AppConfig


class BggConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bgg"
```

- [ ] **Step 4: Register the app + settings**

In `settings.py` `INSTALLED_APPS`, add `"bgg",` next to the other local apps (`accounts`, `catalog`, …). Then add a settings block near the Celery block:
```python
# --- BGG scraping + geocoding ---
BGG_BASE_URL = os.environ.get("BGG_BASE_URL", "https://boardgamegeek.com")
BGG_USER_AGENT = os.environ.get(
    "BGG_USER_AGENT", "mathtrade-app/1.0 (+https://example.org; contact ops@example.org)"
)
BGG_REQUEST_DELAY = float(os.environ.get("BGG_REQUEST_DELAY", "1.0"))  # seconds between page fetches
BGG_MAX_PAGES = int(os.environ.get("BGG_MAX_PAGES", "30"))
NOMINATIM_BASE_URL = os.environ.get("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
NOMINATIM_USER_AGENT = BGG_USER_AGENT
```

- [ ] **Step 5: Verify Django loads**

Run: `backend/venv/bin/python manage.py check`
Expected: `System check identified no issues`.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/bgg/__init__.py backend/bgg/apps.py backend/bgtrade/settings.py
git commit -m "Add bgg app skeleton, beautifulsoup4 dep, and BGG/Nominatim settings"
```

---

### Task 0.2: `ImportJob` model

**Files:**
- Create: `backend/bgg/models.py`
- Test: `backend/bgg/tests/__init__.py`, `backend/bgg/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

`backend/bgg/tests/__init__.py`: empty. `backend/bgg/tests/test_models.py`:
```python
from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.models import ImportJob

User = get_user_model()


class ImportJobModelTest(TestCase):
    def test_defaults(self):
        u = User.objects.create_user("alice", password="x")
        job = ImportJob.objects.create(user=u, kind=ImportJob.Kind.WISHLIST)
        self.assertEqual(job.status, ImportJob.Status.PENDING)
        self.assertEqual(job.summary, {})
        self.assertEqual(job.result, {})
        self.assertEqual(job.options, {})
        self.assertEqual(job.user.bgg_imports.count(), 1)
```

- [ ] **Step 2: Run it — expect failure**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_models -v2`
Expected: ImportError / no module `bgg.models`.

- [ ] **Step 3: Implement the model**

`backend/bgg/models.py`:
```python
from django.conf import settings
from django.db import models


class ImportJob(models.Model):
    """An async BGG scrape+import job; pollable like matching.MatchRun."""

    class Kind(models.TextChoices):
        WISHLIST = "WISHLIST", "Wishlist sync"
        RATINGS = "RATINGS", "Ratings import"
        OWNED = "OWNED", "Owned collection import"
        GEEKLIST = "GEEKLIST", "Geeklist import"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bgg_imports"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    source_ref = models.CharField(max_length=120, blank=True, default="")
    options = models.JSONField(default=dict)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    summary = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    log = models.TextField(blank=True, default="")

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"ImportJob({self.kind}, {self.status}, user={self.user_id})"
```

- [ ] **Step 4: Migrate + run test**

```bash
backend/venv/bin/python manage.py makemigrations bgg
backend/venv/bin/python manage.py test bgg.tests.test_models -v2
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/bgg/models.py backend/bgg/migrations backend/bgg/tests
git commit -m "Add bgg.ImportJob model"
```

---

### Task 0.3: `BggClient` — fetch + parse public collection/geeklist HTML

**Files:**
- Create: `backend/bgg/client.py`
- Create fixtures: `backend/bgg/tests/fixtures/wishlist.html`, `owned.html`, `owned_expansions.html`, `rated.html`, `geeklist.html`, `collection_page1.html`, `collection_page2.html`
- Test: `backend/bgg/tests/test_client.py`

**Fixture authoring note:** Each collection fixture is a minimal HTML table whose rows match BGG's real structure enough for the parser: each game row contains an anchor `<a href="/boardgame/{id}/slug">Name</a>` (expansions use `/boardgameexpansion/{id}/...`), a thumbnail `<img>`, and—where relevant—cells with class hooks used below. Keep them tiny (2–3 rows) and hand-written. Example `wishlist.html`:
```html
<table class="collection_table">
  <tr id="row_">
    <td class="collection_thumbnail"><a href="/boardgame/224517/brass-birmingham"><img src="//cf.geekdo-images.com/x.jpg"></a></td>
    <td class="collection_objectname"><div><a href="/boardgame/224517/brass-birmingham" class="primary">Brass: Birmingham</a></div></td>
    <td class="collection_wishlistcomment">Need the deluxe</td>
  </tr>
  <tr id="row_">
    <td class="collection_thumbnail"><a href="/boardgame/167791/terraforming-mars"><img src="//cf.geekdo-images.com/y.jpg"></a></td>
    <td class="collection_objectname"><div><a href="/boardgame/167791/terraforming-mars" class="primary">Terraforming Mars</a></div></td>
    <td class="collection_wishlistcomment"></td>
  </tr>
</table>
```
For `rated.html`, add `<td class="collection_rating"><div>8</div></td>` per row (use values `8` and `6.5`). For `owned.html`/`owned_expansions.html`, omit rating/comment cells (so language is unknown → pending later). For `collection_page1.html` include a `<a href="...&page=2" title="next page">` link and `collection_page2.html` no next link, to exercise pagination. For `geeklist.html`, rows are `<div class="geekitem"><a href="/boardgame/342942/ark-nova">Ark Nova</a></div>` (2 items).

- [ ] **Step 1: Write the failing test**

`backend/bgg/tests/test_client.py`:
```python
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
```

- [ ] **Step 2: Run it — expect failure**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_client -v2`
Expected: ImportError `bgg.client`.

- [ ] **Step 3: Implement the client**

`backend/bgg/client.py`:
```python
"""Scrapes public BGG HTML (collection browser + geeklists). No xmlapi2 (auth-gated)."""

import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from django.conf import settings

_THING_HREF = re.compile(r"/(?:boardgame|boardgameexpansion)/(\d+)\b")

# subtype + flags per collection kind
_KIND_QUERY = {
    "WISHLIST": "subtype=boardgame&wishlist=1&columns=status|thumbnail|title|wishlistcomment|shop&ff=1",
    "OWNED": "subtype=boardgame&own=1&ff=1",
    "OWNED_EXPANSIONS": "subtype=boardgameexpansion&own=1&ff=1",
    "RATED": "subtype=boardgame&rated=1&columns=status|thumbnail|title|rating&ff=1",
}


@dataclass
class CollectionRow:
    bgg_id: int
    name: str
    thumbnail: str = ""
    my_rating: Decimal | None = None
    language: str | None = None
    wishlist_comment: str | None = None


class BggClient:
    def __init__(self, base_url=None, delay=None, user_agent=None):
        self.base_url = base_url or settings.BGG_BASE_URL
        self.delay = settings.BGG_REQUEST_DELAY if delay is None else delay
        self.user_agent = user_agent or settings.BGG_USER_AGENT

    # ---- public ----
    def fetch_collection(self, username: str, kind: str) -> list[CollectionRow]:
        query = _KIND_QUERY[kind]
        url = f"{self.base_url}/collection/user/{username}?{query}"
        return self._paginated(url)

    def fetch_geeklist(self, geeklist_id: str) -> list[CollectionRow]:
        url = f"{self.base_url}/geeklist/{geeklist_id}"
        html = self._get(url)
        return self._parse_rows(html)

    # ---- internals ----
    def _paginated(self, first_url: str) -> list[CollectionRow]:
        rows: list[CollectionRow] = []
        seen: set[int] = set()
        url = first_url
        for _ in range(settings.BGG_MAX_PAGES):
            html = self._get(url)
            page_rows = self._parse_rows(html)
            for r in page_rows:
                if r.bgg_id not in seen:
                    seen.add(r.bgg_id)
                    rows.append(r)
            nxt = self._next_page(html, url)
            if not nxt:
                break
            url = nxt
        return rows

    def _get(self, url: str) -> str:
        if self.delay:
            time.sleep(self.delay)
        resp = requests.get(url, headers={"User-Agent": self.user_agent}, timeout=30)
        resp.raise_for_status()
        return resp.text

    def _next_page(self, html: str, current_url: str) -> str | None:
        soup = BeautifulSoup(html, "html.parser")
        a = soup.find("a", attrs={"title": "next page"})
        if a and a.get("href"):
            return urljoin(current_url, a["href"])
        return None

    def _parse_rows(self, html: str) -> list[CollectionRow]:
        soup = BeautifulSoup(html, "html.parser")
        out: list[CollectionRow] = []
        seen: set[int] = set()
        # A "row" is any element that has a thing anchor; dedupe by bgg_id per page.
        for anchor in soup.find_all("a", href=_THING_HREF):
            m = _THING_HREF.search(anchor.get("href", ""))
            if not m:
                continue
            bgg_id = int(m.group(1))
            if bgg_id in seen:
                continue
            name = anchor.get_text(strip=True)
            if not name:  # thumbnail anchor wraps an <img>, no text — skip; the title anchor has the name
                continue
            seen.add(bgg_id)
            row = self._enrich(anchor, bgg_id, name)
            out.append(row)
        return out

    def _enrich(self, anchor, bgg_id, name) -> CollectionRow:
        # Walk up to the table row (or geekitem div) to read sibling cells.
        container = anchor
        for _ in range(6):
            if container is None:
                break
            if getattr(container, "name", None) in ("tr", "li") or (
                getattr(container, "get", None) and "geekitem" in (container.get("class") or [])
            ):
                break
            container = container.parent
        rating = self._cell_decimal(container, "collection_rating")
        comment = self._cell_text(container, "collection_wishlistcomment")
        return CollectionRow(
            bgg_id=bgg_id,
            name=name,
            my_rating=rating,
            wishlist_comment=comment,
            language=None,  # collection browser does not expose version language in these columns
        )

    @staticmethod
    def _cell_text(container, css_class):
        if container is None:
            return None
        cell = container.find(class_=css_class)
        if not cell:
            return None
        text = cell.get_text(strip=True)
        return text or None

    @classmethod
    def _cell_decimal(cls, container, css_class):
        text = cls._cell_text(container, css_class)
        if not text:
            return None
        try:
            return Decimal(text)
        except (InvalidOperation, ValueError):
            return None
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_client -v2`
Expected: 6 tests pass. If `_parse_rows` double-counts the thumbnail anchor, confirm the title anchor carries the name and the thumbnail anchor (image-only) is skipped by the empty-name guard.

- [ ] **Step 5: Commit**

```bash
git add backend/bgg/client.py backend/bgg/tests/test_client.py backend/bgg/tests/fixtures
git commit -m "Add BggClient HTML scraper with collection + geeklist parsing"
```

---

### Task 0.4: Import dispatcher (Celery task) + importer registry

**Files:**
- Create: `backend/bgg/importers.py` (registry only for now)
- Create: `backend/bgg/tasks.py`
- Test: `backend/bgg/tests/test_tasks.py`

- [ ] **Step 1: Write the failing test**

`backend/bgg/tests/test_tasks.py`:
```python
from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.models import ImportJob
from bgg.tasks import process_import_job

User = get_user_model()


class DispatcherTest(TestCase):
    def test_unknown_kind_marks_failed(self):
        u = User.objects.create_user("alice", password="x")
        job = ImportJob.objects.create(user=u, kind="WISHLIST")
        # No importer registered yet for WISHLIST in this isolated test → FAILED.
        from bgg import importers
        importers.IMPORTERS.pop("WISHLIST", None)
        process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, ImportJob.Status.FAILED)
        self.assertIn("No importer", job.log)
```

- [ ] **Step 2: Run it — expect failure**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_tasks -v2`
Expected: ImportError `bgg.tasks`.

- [ ] **Step 3: Implement importers registry + dispatcher**

`backend/bgg/importers.py`:
```python
"""Importer registry. Each feature registers `IMPORTERS[kind] = fn(job) -> dict`.

An importer returns {"summary": {...}, "result": {...}, "log": "..."}.
"""

IMPORTERS = {}


def register(kind):
    def deco(fn):
        IMPORTERS[kind] = fn
        return fn
    return deco
```

`backend/bgg/tasks.py`:
```python
import logging

from celery import shared_task

from .importers import IMPORTERS
from .models import ImportJob

logger = logging.getLogger(__name__)


@shared_task
def process_import_job(job_id: int) -> None:
    job = ImportJob.objects.get(id=job_id)
    job.status = ImportJob.Status.RUNNING
    job.save(update_fields=["status", "updated"])
    try:
        importer = IMPORTERS.get(job.kind)
        if importer is None:
            raise ValueError(f"No importer registered for kind {job.kind!r}")
        out = importer(job)
        job.summary = out.get("summary", {})
        job.result = out.get("result", {})
        job.log = out.get("log", "")
        job.status = ImportJob.Status.DONE
    except Exception as exc:  # noqa: BLE001 — record any failure on the job
        logger.exception("import job %s failed", job_id)
        job.status = ImportJob.Status.FAILED
        job.log = f"{type(exc).__name__}: {exc}"
    job.save()
```

- [ ] **Step 4: Run it — expect pass**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_tasks -v2`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add backend/bgg/importers.py backend/bgg/tasks.py backend/bgg/tests/test_tasks.py
git commit -m "Add bgg import dispatcher task + importer registry"
```

---

### Task 0.5: Import API — `POST/GET /api/bgg/imports/`

**Files:**
- Create: `backend/bgg/serializers.py`, `backend/bgg/views.py`, `backend/bgg/urls.py`
- Modify: `backend/bgtrade/urls.py` (include `bgg.urls`)
- Modify: `docs/API_CONTRACT.md`
- Test: `backend/bgg/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

`backend/bgg/tests/test_api.py`:
```python
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
```

Note: `accounts/signals.py` auto-creates a `Profile` on every `User` `post_save`, so `self.alice.profile` is always present — no explicit creation needed (same for every test in this plan that sets `user.profile.bgg_username`). The `patch` import is `from unittest.mock import patch`.

- [ ] **Step 2: Run it — expect failure**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_api -v2`
Expected: 404s (URL not wired).

- [ ] **Step 3: Implement serializer + views + urls**

`backend/bgg/serializers.py`:
```python
from rest_framework import serializers

from .models import ImportJob


class ImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportJob
        fields = ["id", "kind", "source_ref", "options", "status",
                  "summary", "result", "log", "created", "updated"]
        read_only_fields = ["id", "status", "summary", "result", "log", "created", "updated"]

    def validate(self, attrs):
        request = self.context["request"]
        kind = attrs.get("kind")
        if kind == ImportJob.Kind.GEEKLIST:
            if not attrs.get("source_ref"):
                raise serializers.ValidationError({"source_ref": "Geeklist id is required."})
        else:
            profile = getattr(request.user, "profile", None)
            if not (profile and profile.bgg_username):
                raise serializers.ValidationError(
                    {"bgg_username": "Set your BGG username on your profile first."}
                )
        return attrs
```

`backend/bgg/views.py`:
```python
from rest_framework import generics, permissions

from .models import ImportJob
from .serializers import ImportJobSerializer
from .tasks import process_import_job


class ImportJobListCreateView(generics.ListCreateAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ImportJob.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        job = serializer.save(user=self.request.user)
        process_import_job.delay(job.id)  # eager in dev/test


class ImportJobDetailView(generics.RetrieveAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ImportJob.objects.filter(user=self.request.user)
```

`backend/bgg/urls.py`:
```python
from django.urls import path

from .views import ImportJobDetailView, ImportJobListCreateView

urlpatterns = [
    path("bgg/imports/", ImportJobListCreateView.as_view(), name="bgg-import-list-create"),
    path("bgg/imports/<int:pk>/", ImportJobDetailView.as_view(), name="bgg-import-detail"),
]
```

In `backend/bgtrade/urls.py`, after the accounts include, add:
```python
    # BGG: import jobs (wishlist/ratings/owned/geeklist)
    path("api/", include("bgg.urls")),
```

- [ ] **Step 4: Run it — expect pass**

Run: `backend/venv/bin/python manage.py test bgg.tests.test_api -v2`
Expected: 4 tests pass (jobs end FAILED because no importer is registered yet — that's fine; the test only asserts terminal status + ownership).

- [ ] **Step 5: Document the contract**

In `docs/API_CONTRACT.md`, add a `## BGG imports` section:
```
| method | path | notes |
|---|---|---|
| POST | /api/bgg/imports/ | {kind: WISHLIST|RATINGS|OWNED|GEEKLIST, source_ref?, options?}. Needs profile.bgg_username (except GEEKLIST → source_ref=geeklist id). Returns {id,status,...}; runs async (eager in dev). |
| GET | /api/bgg/imports/{id}/ | poll (mine only): {id,kind,status,summary,result,log}. |
```

- [ ] **Step 6: Commit**

```bash
git add backend/bgg/serializers.py backend/bgg/views.py backend/bgg/urls.py backend/bgtrade/urls.py docs/API_CONTRACT.md
git commit -m "Add bgg import API endpoints + contract"
```

---

### Task 0.6 [QA]: Foundation checkpoint
- [ ] Full suite green: `backend/venv/bin/python manage.py test` (≥182 + new).
- [ ] Manually confirm `POST /api/bgg/imports/ {kind:"GEEKLIST"}` without `source_ref` → 400, and with it → 201.
- [ ] Confirm `bgg` appears in `INSTALLED_APPS` and `/api/docs/` renders the two new endpoints.

---

# Phase A — independent features (start immediately)

## F3 — Duplication-protection toggle (advanced builder)  [FE only]

### Task A1 [FE]: Per-WantGroup duplicate-protection toggle in `WantListBuilderPage`

Backend already accepts `duplicate_protection` on want-group create/PATCH (`backend/trades/serializers.py:340`; `frontend/src/api/trades.ts` already types it). The normal builder sets it `true`. Only the **advanced** page lacks a control.

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx` (the WantGroup card/form)

- [ ] **Step 1: Add the toggle to the want-group form/card.** In the WantGroups panel where a `WantGroup` is rendered/edited, add a checkbox bound to `group.duplicate_protection`, and include `duplicate_protection` in the PATCH payload on change:
```tsx
<label className="flex items-center gap-2 text-xs text-gray-600">
  <input
    type="checkbox"
    checked={group.duplicate_protection}
    onChange={(e) =>
      patchGroup.mutateAsync({
        slug,
        id: group.id,
        payload: { duplicate_protection: e.target.checked },
      })
    }
  />
  Duplication-protected (never award more than one copy of the same game)
</label>
```
Use the existing `usePatchWantGroup` hook already imported in this file. Match the surrounding card styling.

- [ ] **Step 2: Lint.** Run: `cd frontend && npm run lint` → no new errors.

- [ ] **Step 3: Manual verify.** Toggle on a want group in the advanced builder; reload; GET `/api/events/{slug}/want-groups/` shows the new value persisted.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "F3: add duplicate-protection toggle to advanced want builder"
```

### Task A2 [QA]: F3 checkpoint
- [ ] Toggle persists across reload; normal "My Wants" builder still forces `true` on create (unchanged); file `qa/BUG-F3-*.md` if not.

---

## F4 — Location + distance restrictions  [BE + FE]

### Task A3 [BE]: Profile + Event location fields + haversine helper

**Files:**
- Modify: `backend/accounts/models.py` (Profile fields)
- Create: `backend/accounts/geo.py` (haversine + geocode)
- Modify: `backend/events/models.py` (TradeEvent fields)
- Test: `backend/accounts/tests/test_geo.py` (or `accounts/tests.py` if single-file)

- [ ] **Step 1: Write the failing test** (`backend/accounts/test_geo.py`):
```python
from django.test import TestCase

from accounts.geo import haversine_km


class HaversineTest(TestCase):
    def test_known_distance_buenos_aires_to_montevideo(self):
        d = haversine_km(-34.6037, -58.3816, -34.9011, -56.1645)
        self.assertAlmostEqual(d, 205, delta=15)

    def test_zero(self):
        self.assertEqual(haversine_km(10, 20, 10, 20), 0.0)
```

- [ ] **Step 2: Run → fail** (`backend/venv/bin/python manage.py test accounts.test_geo -v2`): ImportError.

- [ ] **Step 3: Implement `accounts/geo.py`:**
```python
"""Distance + geocoding helpers. No GeoDjango — plain floats + haversine."""

import math

import requests
from django.conf import settings

_EARTH_KM = 6371.0088


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return round(2 * _EARTH_KM * math.asin(math.sqrt(a)), 2)


def geocode(address: str):
    """Return (lat, lng) or None. Calls public Nominatim; patched in tests."""
    if not address.strip():
        return None
    resp = requests.get(
        f"{settings.NOMINATIM_BASE_URL}/search",
        params={"q": address, "format": "json", "limit": 1},
        headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])
```

- [ ] **Step 4: Add model fields.** In `accounts/models.py` `Profile`, after `region`:
```python
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    max_trade_distance_km = models.PositiveIntegerField(null=True, blank=True)
```
In `events/models.py` `TradeEvent`, after `regional_restrictions`:
```python
    require_location = models.BooleanField(default=False)
    center_latitude = models.FloatField(null=True, blank=True)
    center_longitude = models.FloatField(null=True, blank=True)
    max_distance_km = models.PositiveIntegerField(null=True, blank=True)
```

- [ ] **Step 5: Migrate + run test.**
```bash
backend/venv/bin/python manage.py makemigrations accounts events
backend/venv/bin/python manage.py test accounts.test_geo -v2
```
Expected: 2 pass.

- [ ] **Step 6: Update `docs/DATA_MODEL.md`** — add the new Profile + TradeEvent fields.

- [ ] **Step 7: Commit**
```bash
git add backend/accounts/models.py backend/accounts/geo.py backend/accounts/test_geo.py backend/events/models.py backend/accounts/migrations backend/events/migrations docs/DATA_MODEL.md
git commit -m "F4: add location/distance fields + haversine/geocode helpers"
```

---

### Task A4 [BE]: Geocode Profile on save + expose fields

**Files:**
- Modify: `backend/accounts/serializers.py` (`ProfileSerializer`)
- Test: `backend/accounts/test_profile_geocode.py`

- [ ] **Step 1: Write the failing test:**
```python
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

    def test_geocode_failure_is_nonblocking(self):
        with patch("accounts.serializers.geocode", side_effect=Exception("nominatim down")):
            r = self.client.patch("/api/profiles/me/", {"location": "Nowhere"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["latitude"])
```

- [ ] **Step 2: Run → fail** (`latitude` not in response / geocode not called).

- [ ] **Step 3: Implement.** In `accounts/serializers.py`, import the helper and extend `ProfileSerializer`:
```python
from .geo import geocode
```
Add to `Meta.fields`: `"latitude", "longitude", "max_trade_distance_km"`. Add to `read_only_fields`: `"latitude", "longitude"`. Then override `update`:
```python
    def update(self, instance, validated_data):
        new_location = validated_data.get("location", instance.location)
        location_changed = "location" in validated_data and new_location != instance.location
        instance = super().update(instance, validated_data)
        if location_changed:
            if new_location.strip():
                try:
                    coords = geocode(new_location)
                except Exception:  # noqa: BLE001 — geocoding is best-effort
                    coords = None
                instance.latitude, instance.longitude = coords if coords else (None, None)
            else:
                instance.latitude = instance.longitude = None
            instance.save(update_fields=["latitude", "longitude", "updated"])
        return instance
```

- [ ] **Step 4: Run → pass** (`backend/venv/bin/python manage.py test accounts.test_profile_geocode -v2`).

- [ ] **Step 5: Update `docs/API_CONTRACT.md`** Profiles row: note `latitude`/`longitude` (read-only, geocoded from `location`) + `max_trade_distance_km` (writable).

- [ ] **Step 6: Commit**
```bash
git add backend/accounts/serializers.py backend/accounts/test_profile_geocode.py docs/API_CONTRACT.md
git commit -m "F4: geocode profile location on save + expose distance fields"
```

---

### Task A5 [BE]: Event join location/distance gate + expose event fields

**Files:**
- Modify: `backend/events/serializers.py` (TradeEvent serializer fields)
- Modify: `backend/events/views.py` (`join`)
- Test: `backend/events/test_join_gate.py`

- [ ] **Step 1: Write the failing test:**
```python
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from events.models import TradeEvent

User = get_user_model()


class JoinGateTest(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user("org", password="x")
        self.u = User.objects.create_user("alice", password="x")
        self.event = TradeEvent.objects.create(
            name="E", organizer=self.org, require_location=True,
            center_latitude=-34.6, center_longitude=-58.4, max_distance_km=100,
        )
        self.client.force_authenticate(self.u)

    def _join(self):
        return self.client.post(f"/api/events/{self.event.slug}/join/", {}, format="json")

    def test_requires_location(self):
        r = self._join()
        self.assertEqual(r.status_code, 400)

    def test_rejects_too_far(self):
        p = self.u.profile
        p.latitude, p.longitude = -38.0, -57.5  # ~ >300km away
        p.save()
        self.assertEqual(self._join().status_code, 400)

    def test_allows_within_radius(self):
        p = self.u.profile
        p.latitude, p.longitude = -34.65, -58.45
        p.save()
        self.assertEqual(self._join().status_code, 201)
```

- [ ] **Step 2: Run → fail** (join ignores location).

- [ ] **Step 3: Implement gate.** In `events/views.py` `join`, at the very top (before `get_or_create`):
```python
        event = self.get_object()
        self._enforce_location_gate(event, request.user)
```
and add the helper method to the viewset:
```python
    @staticmethod
    def _enforce_location_gate(event, user):
        from accounts.geo import haversine_km
        if not event.require_location:
            return
        profile = getattr(user, "profile", None)
        lat = getattr(profile, "latitude", None)
        lng = getattr(profile, "longitude", None)
        if lat is None or lng is None:
            raise ValidationError({"location": "Set your location on your profile to join this event."})
        if (event.center_latitude is not None and event.center_longitude is not None
                and event.max_distance_km is not None):
            dist = haversine_km(lat, lng, event.center_latitude, event.center_longitude)
            if dist > event.max_distance_km:
                raise ValidationError(
                    {"location": f"You are {dist:.0f} km from the event area (limit {event.max_distance_km} km)."}
                )
```
(`ValidationError` is already imported in `events/views.py`.)

- [ ] **Step 4: Expose event fields.** In `events/serializers.py`, add to the TradeEvent serializer `fields`: `"require_location", "center_latitude", "center_longitude", "max_distance_km"` (organizer-writable; keep them out of `read_only_fields`).

- [ ] **Step 5: Run → pass** (`backend/venv/bin/python manage.py test events.test_join_gate -v2`).

- [ ] **Step 6: Update `docs/API_CONTRACT.md`** — event shape + join behavior (location/distance 400s).

- [ ] **Step 7: Commit**
```bash
git add backend/events/views.py backend/events/serializers.py backend/events/test_join_gate.py docs/API_CONTRACT.md
git commit -m "F4: enforce location/distance gate on event join"
```

---

### Task A6 [BE]: Distance block in the solver export

**Files:**
- Modify: `backend/matching/external_solver.py`
- Test: `backend/matching/test_distance_block.py`

Context: `_build_onetoone`/`_build_xtoy` compute `blocked = _blocked_with(user_id, block_pairs)` then call `_expand(..., blocked)` which drops listings owned by anyone in `blocked`. We union in a per-wisher distance-blocked set.

- [ ] **Step 1: Write the failing test** — assert a wisher with a small `max_trade_distance_km` does not get a far owner's listing code in their wishlist line. Model it on `matching/test_external_solver.py` (reuse its setup style): two users with profiles far apart, wisher has `max_trade_distance_km=10`, assert the far listing code is absent from the built body.
```python
# backend/matching/test_distance_block.py — adapt setup from test_external_solver.py
# Key assertions after building the ONETOONE body for the wisher:
#   self.assertNotIn(far_listing_code, wisher_line)
#   self.assertIn(near_listing_code, wisher_line)
```
(Write it concretely against that file's fixtures: give the wisher a near and a far candidate, set coords on both owners + the wisher.)

- [ ] **Step 2: Run → fail** (far code still present).

- [ ] **Step 3: Implement.** In `external_solver.py` add:
```python
def _distance_blocked(user_id, coords):
    """Owner ids too far from this wisher (per the wisher's max_trade_distance_km)."""
    from accounts.geo import haversine_km
    me = coords.get(user_id)
    if not me or me[2] is None:  # (lat, lng, max_km); no self-limit → block nobody
        return set()
    lat, lng, max_km = me
    blocked = set()
    for other_id, (olat, olng, _omax) in coords.items():
        if other_id == user_id:
            continue
        if olat is None or olng is None or lat is None or lng is None:
            continue
        if haversine_km(lat, lng, olat, olng) > max_km:
            blocked.add(other_id)
    return blocked


def _load_coords():
    """user_id -> (lat, lng, max_trade_distance_km) for users with a Profile."""
    from accounts.models import Profile
    return {
        p.user_id: (p.latitude, p.longitude, p.max_trade_distance_km)
        for p in Profile.objects.all()
    }
```
Then in both `_build_onetoone` and `_build_xtoy`, build `coords = _load_coords()` once near where `blocked_cache` is created, and change the cached blocked set to union distance blocks:
```python
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
```
Pass `coords` into these builders (add a parameter) or compute at the top of each — match the existing call signatures in `build_*` (see `external_solver.py:114-120`).

- [ ] **Step 4: Run → pass.** Then full matching suite: `backend/venv/bin/python manage.py test matching -v2` (keep all green).

- [ ] **Step 5: Commit**
```bash
git add backend/matching/external_solver.py backend/matching/test_distance_block.py
git commit -m "F4: exclude too-far owners from solver export via existing block path"
```

---

### Task A7 [FE]: Profile location fields + event organizer gate fields + builder greying

**Files:**
- Modify: `frontend/src/api/profiles.ts` (Profile type + payload)
- Modify: `frontend/src/features/profile/ProfilePage.tsx` (location, max distance inputs)
- Modify: `frontend/src/api/events.ts` (TradeEvent type + create/patch payloads)
- Modify: event organizer form (in `EventDetailPage.tsx` or `EventsPage.tsx` — wherever events are created/edited)
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (grey too-far listings)

- [ ] **Step 1: Types.** In `profiles.ts`, add to `Profile`: `latitude: number | null; longitude: number | null; max_trade_distance_km: number | null`; add `max_trade_distance_km?` to the update payload. In `events.ts` `TradeEvent` + create/patch payload, add `require_location`, `center_latitude`, `center_longitude`, `max_distance_km`.

- [ ] **Step 2: Profile UI.** In `ProfilePage.tsx`, add a "Location" text input bound to `location` (existing) and a number input "Forbid trades farther than (km)" bound to `max_trade_distance_km`. Show read-only resolved coords (or "not geocoded yet" when null) as feedback.

- [ ] **Step 3: Organizer UI.** In the event create/edit form, add (organizer-only): a `require_location` checkbox, optional center lat/lng inputs, and `max_distance_km`. Submit them in the existing create/patch payload.

- [ ] **Step 4: Builder greying.** In `MyWantsPage.tsx`, fetch the current user's profile; if `max_trade_distance_km` is set and the listing owner's distance exceeds it, grey/disable that listing in the browse + grid. Distance needs owner coords — expose `copy_owner_distance_km` on `EventListing` (BE, optional enhancement) OR grey based on a `too_far` flag. **Simpler:** add a serializer field `owner_too_far` to `EventListingSerializer` computed against `request.user`'s profile (see sub-step below), and grey when `owner_too_far` is true.

  Sub-step (BE, in `events/serializers.py`): add
  ```python
  owner_too_far = serializers.SerializerMethodField()
  def get_owner_too_far(self, obj):
      req = self.context.get("request")
      me = getattr(getattr(req, "user", None), "profile", None)
      if not me or me.max_trade_distance_km is None or me.latitude is None:
          return False
      from accounts.geo import haversine_km
      op = getattr(obj.copy.owner, "profile", None)
      if not op or op.latitude is None:
          return False
      return haversine_km(me.latitude, me.longitude, op.latitude, op.longitude) > me.max_trade_distance_km
  ```
  Add `"owner_too_far"` to that serializer's `fields` + `read_only_fields`, document it in API_CONTRACT, and add a BE test. Then FE greys on it.

- [ ] **Step 5: Lint** (`cd frontend && npm run lint`) + **manual verify**: set a 10km limit, confirm far listings grey out and join is blocked when outside an event radius.

- [ ] **Step 6: Commit** (split BE serializer change + FE into two commits if cleaner):
```bash
git add backend/events/serializers.py frontend/src docs/API_CONTRACT.md
git commit -m "F4: profile/event location UI + owner_too_far greying"
```

### Task A8 [QA]: F4 checkpoint
- [ ] Geocode mocked path returns coords; join gate 400s without location and outside radius; far listings grey; solver excludes far owners (BE test green). File `qa/BUG-F4-*.md` for any mismatch with API_CONTRACT.

---

# Phase B — foundation-dependent features

## F1 — Wishlist sync + want-builder filters

### Task B1 [BE]: Wishlist importer

**Files:**
- Modify: `backend/bgg/importers.py` (add `import_wishlist`, register WISHLIST)
- Test: `backend/bgg/tests/test_import_wishlist.py`

- [ ] **Step 1: Write the failing test:**
```python
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Wishlist
from bgg.client import CollectionRow
from bgg.models import ImportJob
from bgg.tasks import process_import_job
from catalog.models import BoardGame

User = get_user_model()


class WishlistImportTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.u.profile.bgg_username = "juaniisuar"
        self.u.profile.save()
        BoardGame.objects.create(bgg_id=224517, name="Brass: Birmingham")
        # 167791 deliberately NOT in catalog → must be skipped

    def test_imports_in_catalog_skips_rest(self):
        rows = [
            CollectionRow(bgg_id=224517, name="Brass: Birmingham", wishlist_comment="deluxe"),
            CollectionRow(bgg_id=167791, name="Terraforming Mars"),
        ]
        job = ImportJob.objects.create(user=self.u, kind="WISHLIST")
        with patch("bgg.importers.BggClient.fetch_collection", return_value=rows):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "DONE")
        self.assertEqual(job.summary["matched"], 1)
        self.assertEqual(job.summary["skipped"], 1)
        self.assertTrue(Wishlist.objects.filter(user=self.u, board_game_bgg_id=224517).exists())
        w = Wishlist.objects.get(user=self.u, board_game_bgg_id=224517)
        self.assertEqual(w.note, "deluxe")
```

- [ ] **Step 2: Run → fail** (job FAILED: no importer).

- [ ] **Step 3: Implement** in `bgg/importers.py`:
```python
from accounts.models import Wishlist
from catalog.models import BoardGame

from .client import BggClient


@register("WISHLIST")
def import_wishlist(job):
    username = job.user.profile.bgg_username
    rows = BggClient().fetch_collection(username, "WISHLIST")
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    matched, skipped = [], []
    for r in rows:
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"})
            continue
        Wishlist.objects.update_or_create(
            user=job.user, board_game_bgg_id=r.bgg_id,
            defaults={"note": (r.wishlist_comment or "")[:200]},
        )
        matched.append(r.bgg_id)
    return {
        "summary": {"matched": len(matched), "skipped": len(skipped)},
        "result": {"matched": matched, "skipped": skipped},
        "log": f"Wishlist sync: {len(matched)} matched, {len(skipped)} skipped.",
    }
```
Import `BggClient` and `register` at the top of `importers.py` (keep the registry definition above the importer so `@register` exists).

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**
```bash
git add backend/bgg/importers.py backend/bgg/tests/test_import_wishlist.py
git commit -m "F1: BGG wishlist importer"
```

---

### Task B2 [BE]: Want-builder game filters (`wishlisted`, `min_rating`, `is_expansion`)

**Files:**
- Modify: `backend/events/views.py` (`games` action)
- Test: `backend/events/test_games_filters.py`

- [ ] **Step 1: Write the failing test** — seed an event with listings for two games (one in the user's Wishlist, one not; different `average`), assert `?wishlisted=true` returns only the wishlisted one and `?min_rating=8` filters by `average`. Model setup on `seed_test_event` / existing events tests.
```python
# Assertions:
#   r = client.get(f"/api/events/{slug}/games/?wishlisted=true")
#   self.assertEqual({g["bgg_id"] for g in r.data["results"]}, {wishlisted_bgg_id})
#   r2 = client.get(f"/api/events/{slug}/games/?min_rating=8")
#   self.assertTrue(all(g["average"] >= 8 for g in r2.data["results"]))
```

- [ ] **Step 2: Run → fail** (params ignored).

- [ ] **Step 3: Implement** in the `games` action (after the `search` filter, before ordering):
```python
        if request.query_params.get("wishlisted") in ("true", "1"):
            from accounts.models import Wishlist
            ids = Wishlist.objects.filter(user=request.user).values_list("board_game_bgg_id", flat=True)
            qs = qs.filter(bgg_id__in=list(ids))

        min_rating = request.query_params.get("min_rating")
        if min_rating:
            qs = qs.filter(average__gte=float(min_rating))

        is_expansion = request.query_params.get("is_expansion")
        if is_expansion in ("true", "false"):
            qs = qs.filter(is_expansion=(is_expansion == "true"))
```
**Required serializer change:** `EventGameSerializer` (`events/serializers.py:204`) does NOT currently expose `average`, which the `min_rating` test reads. Add this line to it (after `rank`):
```python
    average = serializers.FloatField(allow_null=True)
```
and add `average` to the documented EventGame item in API_CONTRACT.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Document** the new query params on the `/events/{slug}/games/` row in `docs/API_CONTRACT.md`.

- [ ] **Step 6: Commit**
```bash
git add backend/events/views.py backend/events/serializers.py backend/events/test_games_filters.py docs/API_CONTRACT.md
git commit -m "F1: wishlisted/min_rating/is_expansion filters on event games"
```

---

### Task B3 [FE]: Filter bar + "Sync BGG wishlist" button

**Files:**
- Modify: `frontend/src/api/events.ts` (`EventGamesParams` + fetch)
- Create: `frontend/src/api/bgg.ts` (import-job hooks)
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (filter bar + sync button)

- [ ] **Step 1: API types.** In `events.ts`, extend `EventGamesParams` with `wishlisted?: boolean; min_rating?: number; is_expansion?: boolean`, and serialize them in `fetchEventGames`. Create `frontend/src/api/bgg.ts`:
```ts
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from './client'

export type ImportKind = 'WISHLIST' | 'RATINGS' | 'OWNED' | 'GEEKLIST'
export interface ImportJob {
  id: number; kind: ImportKind; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'
  summary: Record<string, number>; result: Record<string, unknown>; log: string
}
export async function startImport(body: { kind: ImportKind; source_ref?: string; options?: Record<string, unknown> }) {
  const { data } = await apiClient.post<ImportJob>('/bgg/imports/', body)
  return data
}
export function useStartImport() {
  return useMutation({ mutationFn: startImport })
}
export function useImportJob(id: number | null) {
  return useQuery({
    queryKey: ['bgg', 'import', id],
    queryFn: async () => (await apiClient.get<ImportJob>(`/bgg/imports/${id}/`)).data,
    enabled: id != null,
    refetchInterval: (q) => (['PENDING', 'RUNNING'].includes(q.state.data?.status ?? '') ? 2000 : false),
  })
}
```

- [ ] **Step 2: Filter bar.** In `MyWantsPage`'s game-browse panel, add controls (wishlist toggle, min-rating select, expansion toggle, sort) that feed `useEventGames(slug, params)`.

- [ ] **Step 3: Sync button.** Add a "Sync BGG wishlist" button: `const m = useStartImport()` → `m.mutate({ kind: 'WISHLIST' })`, poll via `useImportJob`, show progress, and on DONE invalidate the games query + wishlist query and toast `summary.matched`/`summary.skipped`. Disable with a hint linking to the profile when `bgg_username` is empty (read from profile query).

- [ ] **Step 4: Lint + manual verify** (mock-friendly: the eager backend completes immediately; with a seeded catalog + a real BGG username it populates the wishlist; the `?wishlisted=true` toggle then filters).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/events.ts frontend/src/api/bgg.ts frontend/src/features/trades/MyWantsPage.tsx
git commit -m "F1: want-builder filter bar + BGG wishlist sync"
```

### Task B4 [QA]: F1 checkpoint
- [ ] Importer matched/skipped counts correct; out-of-catalog skipped; `?wishlisted=`/`?min_rating=` behave per contract; sync button polls + refreshes. File `qa/BUG-F1-*.md` on mismatch.

---

## F2 — Game ratings + grid auto-tick + ratings import

### Task B5 [BE]: `GameRating` model + CRUD API

**Files:**
- Modify: `backend/accounts/models.py` (GameRating)
- Modify: `backend/accounts/serializers.py`, `backend/accounts/views.py`, `backend/accounts/urls.py`
- Test: `backend/accounts/test_game_ratings.py`

- [ ] **Step 1: Write the failing test:**
```python
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame

User = get_user_model()


class GameRatingApiTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        BoardGame.objects.create(bgg_id=224517, name="Brass")
        self.client.force_authenticate(self.u)

    def test_create_and_list_mine(self):
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "8.5"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["board_game"], 224517)
        self.assertEqual(r.data["board_game_name"], "Brass")
        lst = self.client.get("/api/game-ratings/")
        self.assertEqual(lst.data["count"] if "count" in lst.data else len(lst.data), 1)

    def test_upsert_on_repeat(self):
        self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "8"}, format="json")
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "9"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(str(r.data["value"]), "9.0")

    def test_out_of_range_rejected(self):
        r = self.client.post("/api/game-ratings/", {"board_game": 224517, "value": "11"}, format="json")
        self.assertEqual(r.status_code, 400)
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement model** in `accounts/models.py`:
```python
from django.core.validators import MaxValueValidator, MinValueValidator  # already imported


class GameRating(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_ratings")
    board_game = models.ForeignKey("catalog.BoardGame", on_delete=models.CASCADE, related_name="ratings")
    value = models.DecimalField(
        max_digits=3, decimal_places=1,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "board_game")]
        ordering = ["-updated"]
```

- [ ] **Step 4: Serializer/view/urls.** In `accounts/serializers.py`, add `from catalog.models import BoardGame` at the top, then:
```python
class GameRatingSerializer(serializers.ModelSerializer):
    board_game = serializers.PrimaryKeyRelatedField(queryset=BoardGame.objects.all())
    board_game_name = serializers.CharField(source="board_game.name", read_only=True)

    class Meta:
        model = GameRating
        fields = ["id", "board_game", "board_game_name", "value", "created", "updated"]
        read_only_fields = ["id", "board_game_name", "created", "updated"]
```
`accounts/views.py`:
```python
class GameRatingListCreateView(generics.ListCreateAPIView):
    serializer_class = GameRatingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return GameRating.objects.filter(user=self.request.user).select_related("board_game")

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj, _ = GameRating.objects.update_or_create(
            user=request.user, board_game=ser.validated_data["board_game"],
            defaults={"value": ser.validated_data["value"]},
        )
        out = self.get_serializer(obj)
        return Response(out.data, status=status.HTTP_201_CREATED)


class GameRatingDestroyView(generics.DestroyAPIView):
    serializer_class = GameRatingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return GameRating.objects.filter(user=self.request.user)
```
(Add `from rest_framework.response import Response` and `from rest_framework import status` imports.) `accounts/urls.py`: add
```python
    path("game-ratings/", GameRatingListCreateView.as_view(), name="game-rating-list-create"),
    path("game-ratings/<int:pk>/", GameRatingDestroyView.as_view(), name="game-rating-destroy"),
```

- [ ] **Step 5: Migrate + run → pass.**
```bash
backend/venv/bin/python manage.py makemigrations accounts
backend/venv/bin/python manage.py test accounts.test_game_ratings -v2
```

- [ ] **Step 6: Document** in API_CONTRACT (`/api/game-ratings/`) + DATA_MODEL (GameRating).

- [ ] **Step 7: Commit**
```bash
git add backend/accounts docs/API_CONTRACT.md docs/DATA_MODEL.md
git commit -m "F2: GameRating model + CRUD API"
```

---

### Task B6 [BE]: Ratings importer

**Files:**
- Modify: `backend/bgg/importers.py` (`import_ratings`, register RATINGS)
- Test: `backend/bgg/tests/test_import_ratings.py`

- [ ] **Step 1: Write the failing test** — like wishlist, but rows carry `my_rating`; assert `GameRating` upserted for in-catalog rows, skipped otherwise, rows without `my_rating` skipped as "no rating".
```python
# rows = [CollectionRow(224517, "Brass", my_rating=Decimal("8.5")),
#         CollectionRow(167791, "TM", my_rating=Decimal("7"))]  # 167791 not in catalog
# after import: GameRating(user, 224517).value == Decimal("8.5"); summary matched==1, skipped==1
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement:**
```python
from accounts.models import GameRating


@register("RATINGS")
def import_ratings(job):
    rows = BggClient().fetch_collection(job.user.profile.bgg_username, "RATED")
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    matched, skipped = [], []
    for r in rows:
        if r.my_rating is None:
            skipped.append({"bgg_id": r.bgg_id, "reason": "no rating"}); continue
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"}); continue
        GameRating.objects.update_or_create(
            user=job.user, board_game_id=r.bgg_id, defaults={"value": r.my_rating},
        )
        matched.append(r.bgg_id)
    return {"summary": {"matched": len(matched), "skipped": len(skipped)},
            "result": {"matched": matched, "skipped": skipped},
            "log": f"Ratings import: {len(matched)} matched, {len(skipped)} skipped."}
```

- [ ] **Step 4: Run → pass. Step 5: Commit**
```bash
git add backend/bgg/importers.py backend/bgg/tests/test_import_ratings.py
git commit -m "F2: BGG ratings importer"
```

---

### Task B7 [FE]: Ratings hooks + grid "Auto-tick by rating" + rating UI

**Files:**
- Create: `frontend/src/api/ratings.ts`
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (auto-tick button in `GridMode`)
- Modify: `frontend/src/api/bgg.ts` (reuse) — import ratings button (profile or builder)
- Modify: game detail / copies UI for setting a rating (e.g. `frontend/src/features/copies/MyCopiesPage.tsx` or game detail) — minimal: a rating input where a game is shown.

- [ ] **Step 1: Ratings API** (`frontend/src/api/ratings.ts`):
```ts
import { useQuery } from '@tanstack/react-query'
import { apiClient } from './client'

export interface GameRating { id: number; board_game: number; board_game_name: string; value: string }
export async function fetchMyRatings(): Promise<GameRating[]> {
  const { data } = await apiClient.get('/game-ratings/')
  return Array.isArray(data) ? data : data.results
}
export function useMyRatings() {
  return useQuery({ queryKey: ['ratings', 'mine'], queryFn: fetchMyRatings, staleTime: 60_000 })
}
/** Map bgg_id -> numeric rating for O(1) lookup. */
export function ratingMap(ratings: GameRating[] = []) {
  return new Map(ratings.map((r) => [r.board_game, Number(r.value)]))
}
```

- [ ] **Step 2: Auto-tick button.** In `GridMode`, accept a `ratings: Map<number, number>` prop (passed from the page via `useMyRatings`+`ratingMap`). Add a button above the table:
```tsx
<button
  type="button"
  className="rounded-md border px-2 py-1 text-xs"
  onClick={() => {
    for (const g of groupTargetsByGame(editor.targets)) {
      const wantRating = ratings.get(g.gameId)
      if (wantRating == null) continue
      for (const l of myListings) {
        const ownRating = ratings.get(l.board_game_id)
        if (ownRating == null) continue
        if (ownRating <= wantRating) toggleGroup(editor, l.id, g)  // turn ON
      }
    }
  }}
>
  Auto-tick by rating (give ≤-rated for ≥-rated)
</button>
```
This mutates only the staged editor; the existing save bar persists it. (`groupTargetsByGame`, `toggleGroup`, and `g.gameId`/`l.board_game_id` already exist in this file.)

- [ ] **Step 3: Rating input UI.** Where a canonical game is displayed (game detail or the copies page game header), add a 1–10 rating input that POSTs `/game-ratings/` via a `useSetRating` mutation (invalidate `['ratings','mine']`). Keep it minimal — one number input + save.

- [ ] **Step 4: Import-ratings button.** Add a "Import ratings from BGG" button (profile or builder) using `useStartImport({ kind: 'RATINGS' })` + poll, then invalidate `['ratings','mine']`.

- [ ] **Step 5: Lint + manual verify**: set two ratings (owned=6, wanted=8) → auto-tick checks that cell; owned=9, wanted=8 → leaves it unchecked.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/api/ratings.ts frontend/src/features/trades/MyWantsPage.tsx frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "F2: game ratings UI, BGG import, grid auto-tick by rating"
```

### Task B8 [QA]: F2 checkpoint
- [ ] CRUD upsert + range validation; importer counts; auto-tick logic (`own ≤ want` ticks, missing rating skips, never un-ticks). File `qa/BUG-F2-*.md` on mismatch.

---

## F5 — Owned/geeklist import → copies (with pending)

### Task B9 [BE]: Copy pending fields + EventListing guard

**Files:**
- Modify: `backend/copies/models.py` (fields + helper)
- Modify: `backend/copies/serializers.py` (expose fields + re-evaluate pending on update)
- Modify: `backend/events/views.py` (`_listings_create` guard)
- Test: `backend/copies/test_pending.py`, `backend/events/test_pending_listing_guard.py`

- [ ] **Step 1: Write the failing tests.** `copies/test_pending.py`:
```python
# A copy created without language OR condition is pending; filling BOTH clears it.
#   c = Copy.objects.create(owner=u, board_game=bg, is_pending=True)  # imported, no lang/cond
#   PATCH /api/copies/{id}/ {"language":"English"} → still pending (no condition)
#   PATCH /api/copies/{id}/ {"condition":"GOOD"}   → is_pending == False
```
`events/test_pending_listing_guard.py`:
```python
# POST /api/events/{slug}/listings/ {"copy": <pending copy id>} → 400 with a clear message.
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** In `copies/models.py` `Copy`, add fields + a recompute helper:
```python
    is_pending = models.BooleanField(default=False)
    import_source = models.CharField(max_length=40, blank=True, default="")

    REQUIRED_FOR_COMPLETE = ("language", "condition")

    def recompute_pending(self):
        self.is_pending = not (self.language and self.condition)
```
In `copies/serializers.py`, add `"is_pending"`, `"import_source"` to `fields`; make `is_pending` read-only; on update, recompute:
```python
    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        if instance.is_pending:
            instance.recompute_pending()
            instance.save(update_fields=["is_pending", "updated"])
        return instance
```
In `events/views.py` `_listings_create`, after fetching `copy` and the owner check, add:
```python
        if copy.is_pending:
            raise ValidationError(
                {"copy": "This copy is incomplete (missing language and/or condition). "
                         "Complete its details before adding it to an event."}
            )
```

- [ ] **Step 4: Migrate + run → pass.**
```bash
backend/venv/bin/python manage.py makemigrations copies
backend/venv/bin/python manage.py test copies.test_pending events.test_pending_listing_guard -v2
```

- [ ] **Step 5: Document** Copy shape (`is_pending`, `import_source`) + the EventListing-create 400 in API_CONTRACT; Copy fields in DATA_MODEL.

- [ ] **Step 6: Commit**
```bash
git add backend/copies backend/events/views.py backend/events/test_pending_listing_guard.py docs/API_CONTRACT.md docs/DATA_MODEL.md
git commit -m "F5: pending copy fields + EventListing guard"
```

---

### Task B10 [BE]: Owned + geeklist copy importer (with skip-duplicates)

**Files:**
- Modify: `backend/bgg/importers.py` (`import_copies`, register OWNED + GEEKLIST)
- Test: `backend/bgg/tests/test_import_copies.py`

- [ ] **Step 1: Write the failing test:**
```python
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from bgg.client import CollectionRow
from bgg.models import ImportJob
from bgg.tasks import process_import_job
from catalog.models import BoardGame
from copies.models import Copy

User = get_user_model()


class CopyImportTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.u.profile.bgg_username = "juaniisuar"; self.u.profile.save()
        BoardGame.objects.create(bgg_id=224517, name="Brass")

    def test_owned_creates_pending_copies_skips_out_of_catalog(self):
        rows = [CollectionRow(224517, "Brass"), CollectionRow(999999, "Unknown")]
        job = ImportJob.objects.create(user=self.u, kind="OWNED")
        with patch("bgg.importers.BggClient.fetch_collection", return_value=rows):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.summary["created"], 1)
        self.assertEqual(job.summary["skipped"], 1)
        c = Copy.objects.get(owner=self.u, board_game_id=224517)
        self.assertTrue(c.is_pending)
        self.assertEqual(c.import_source, "BGG_OWNED")

    def test_skip_duplicates(self):
        Copy.objects.create(owner=self.u, board_game_id=224517)
        rows = [CollectionRow(224517, "Brass")]
        job = ImportJob.objects.create(user=self.u, kind="OWNED", options={"skip_duplicates": True})
        with patch("bgg.importers.BggClient.fetch_collection", return_value=rows):
            process_import_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.summary["created"], 0)
        self.assertEqual(job.summary["skipped"], 1)

    def test_geeklist_uses_source_ref(self):
        rows = [CollectionRow(224517, "Brass")]
        job = ImportJob.objects.create(user=self.u, kind="GEEKLIST", source_ref="555")
        with patch("bgg.importers.BggClient.fetch_geeklist", return_value=rows) as f:
            process_import_job(job.id)
        f.assert_called_once_with("555")
        self.assertTrue(Copy.objects.filter(owner=self.u, board_game_id=224517).exists())
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (one importer, registered for both kinds; owned fetches two subtypes):
```python
from copies.models import Copy


@register("OWNED")
@register("GEEKLIST")
def import_copies(job):
    client = BggClient()
    if job.kind == "GEEKLIST":
        rows = client.fetch_geeklist(job.source_ref)
        source = "BGG_GEEKLIST"
    else:
        rows = client.fetch_collection(job.user.profile.bgg_username, "OWNED")
        rows += client.fetch_collection(job.user.profile.bgg_username, "OWNED_EXPANSIONS")
        source = "BGG_OWNED"

    skip_dupes = bool(job.options.get("skip_duplicates"))
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    owned_ids = set(Copy.objects.filter(owner=job.user).values_list("board_game_id", flat=True))
    created, pending, skipped = [], [], []
    for r in rows:
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"}); continue
        if skip_dupes and r.bgg_id in owned_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "duplicate"}); continue
        copy = Copy(owner=job.user, board_game_id=r.bgg_id,
                    language=(r.language or ""), import_source=source)
        copy.recompute_pending()  # no language/condition → pending
        copy.save()
        owned_ids.add(r.bgg_id)
        created.append(copy.id)
        if copy.is_pending:
            pending.append(copy.id)
    return {"summary": {"created": len(created), "pending": len(pending), "skipped": len(skipped)},
            "result": {"created": created, "pending": pending, "skipped": skipped},
            "log": f"Copy import ({source}): {len(created)} created, {len(pending)} pending, {len(skipped)} skipped."}
```
Note the importer registry must support stacking `@register` for two kinds — `register` returns the function unchanged, so stacking works.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**
```bash
git add backend/bgg/importers.py backend/bgg/tests/test_import_copies.py
git commit -m "F5: owned/geeklist copy importer with skip-duplicates + pending"
```

---

### Task B11 [FE]: Import-copies UI + pending banner in `MyCopiesPage`

**Files:**
- Modify: `frontend/src/api/copies.ts` (Copy type: `is_pending`, `import_source`)
- Modify: `frontend/src/features/copies/MyCopiesPage.tsx` (import button + pending banner + complete-details flow)

- [ ] **Step 1: Types.** Add `is_pending: boolean; import_source: string` to the `Copy` interface in `copies.ts`.

- [ ] **Step 2: Import button.** Add "Import owned from BGG" (with a "skip existing duplicates" checkbox) + "Import from geeklist" (id input) using `useStartImport` ({kind:'OWNED', options:{skip_duplicates}} / {kind:'GEEKLIST', source_ref}) + `useImportJob` poll; on DONE invalidate the copies query and toast `summary.created/pending/skipped`.

- [ ] **Step 3: Pending banner.** For copies with `is_pending`, render a highlighted card with a "Complete details" CTA that opens the existing edit form focused on `language` + `condition`; on successful PATCH the copy's `is_pending` flips false (backend recomputes) and the banner clears. Also surface that pending copies can't be added to events (the add-to-event button is disabled with a tooltip).

- [ ] **Step 4: Lint + manual verify**: import populates pending copies; filling language+condition clears pending; adding a pending copy to an event is blocked with the 400 message.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/copies.ts frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "F5: BGG owned/geeklist copy import + pending-copy UX"
```

### Task B12 [QA]: F5 checkpoint
- [ ] Importer created/pending/skipped counts; out-of-catalog + duplicate skipping; pending→complete flow; event-add guard. File `qa/BUG-F5-*.md` on mismatch.

---

# Final checkpoint  [QA]

- [ ] Full BE suite green: `backend/venv/bin/python manage.py test` (182 baseline + all new).
- [ ] `cd frontend && npm run build` succeeds (tsc + vite).
- [ ] `docs/API_CONTRACT.md` + `docs/DATA_MODEL.md` reflect every new endpoint/field.
- [ ] All `qa/BUG-*.md` from this effort resolved or triaged.

---

## Self-review notes (author)

- **Spec coverage:** F0 foundation → Tasks 0.1–0.6; F1 → B1–B4 + (filters) B2; F2 → B5–B8; F3 → A1–A2; F4 → A3–A8; F5 → B9–B12. All five spec features + foundation mapped.
- **Catalog-skip rule** enforced in every importer (wishlist/ratings/copies).
- **Pending = missing language OR condition** implemented via `Copy.recompute_pending()` and exercised in tests.
- **Distance reuse** routed through the existing `_blocked_with` union, not a new solver structure.
- **No live network** — every external call (`BggClient`, `geocode`) is patched in tests.
