# Postgres + Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Postgres the `DATABASE_URL`-driven database (SQLite fallback for tests), then prepare the repo to deploy on Railway as a single Django web service that serves the built Vite SPA, plus a Celery worker service backed by Redis.

**Architecture:** Two sequential branches. **Phase 1** (`feat/postgres`) swaps the hand-rolled DB parser for `dj-database-url` + psycopg3 and adds a local Postgres `docker-compose.yml`; merges to `main`. **Phase 2** (`feat/railway-deploy`, off updated `main`) adds env-guarded production settings (WhiteNoise static, SPA catch-all, TLS/proxy, env-driven Celery eager toggle), a multi-stage Dockerfile, and Railway/process config.

**Tech Stack:** Django 5.2, dj-database-url, psycopg3, gunicorn, WhiteNoise, Redis/Celery, Vite/React, Docker, Railway.

**Note on commands:** the project has no pytest — tests run with Django's runner via `backend/manage.py test`. The venv python is `backend/.venv/bin/python`. Run backend commands from the `backend/` directory unless stated otherwise.

---

## File Structure

**Phase 1:**
- `backend/requirements.txt` — add `dj-database-url`, `psycopg[binary]`.
- `backend/bgtrade/settings.py` — replace DB block with `dj_database_url.config(...)`.
- `backend/bgtrade/test_settings.py` (new) — assert DB engine selection.
- `docker-compose.yml` (new, repo root) — local Postgres 16.
- `README.md` — Database subsection.

**Phase 2:**
- `backend/requirements.txt` — add `gunicorn`, `whitenoise`, `redis`.
- `backend/bgtrade/settings.py` — WhiteNoise/static, SPA dir, hosts/CSRF/TLS, DB ssl, Celery eager env toggle.
- `backend/bgtrade/urls.py` — SPA catch-all route + view.
- `backend/bgtrade/test_settings.py` — append deploy-settings + SPA tests.
- `frontend/vite.config.ts` — `base:'/static/'` on build only.
- `Dockerfile` (new, repo root) — multi-stage Node build + Python runtime.
- `Procfile`, `railway.toml`, `.env.example` (new, repo root).
- `README.md` — Deployment section.

---

# PHASE 1 — Postgres (`feat/postgres`)

## Task 1: Create the Phase 1 branch

- [ ] **Step 1: Branch off main**

```bash
cd /home/juanigsrz/Desktop/Emporium
git checkout main
git checkout -b feat/postgres
git branch --show-current   # expect: feat/postgres
```

---

## Task 2: DATABASE_URL-driven database config

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/bgtrade/settings.py` (imports ~line 5-6; DB block ~lines 30-58)
- Create: `backend/bgtrade/test_settings.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/bgtrade/test_settings.py`:

```python
"""Settings-level tests: database engine selection."""

import dj_database_url
from django.conf import settings
from django.test import SimpleTestCase


class DatabaseConfigTests(SimpleTestCase):
    def test_default_is_sqlite(self):
        # Run without DATABASE_URL in the environment.
        self.assertEqual(
            settings.DATABASES["default"]["ENGINE"],
            "django.db.backends.sqlite3",
        )

    def test_postgres_url_selects_postgres_engine(self):
        cfg = dj_database_url.parse("postgres://u:p@h:5432/d")
        self.assertEqual(cfg["ENGINE"], "django.db.backends.postgresql")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings -v1`
Expected: FAIL — `ModuleNotFoundError: No module named 'dj_database_url'`.

- [ ] **Step 3: Add the dependencies**

In `backend/requirements.txt`, under the `# Misc deps` section (or a new `# Database` section near the top), add:

```
# Database
dj-database-url==2.3.0
psycopg[binary]==3.2.9
```

- [ ] **Step 4: Install the dependencies**

Run: `cd backend && .venv/bin/pip install dj-database-url==2.3.0 "psycopg[binary]==3.2.9"`
Expected: successful install (if a pinned version is unavailable, install the nearest compatible and update the pin in `requirements.txt` to match).

- [ ] **Step 5: Replace the database block in settings**

In `backend/bgtrade/settings.py`, add the import near the top imports (after `from pathlib import Path`, ~line 6):

```python
import dj_database_url
```

Then replace the entire block from the `# Database` comment header through the end of the `else:` SQLite fallback (currently ~lines 30-58):

```python
# ---------------------------------------------------------------------------
# Database (DATABASE_URL → sqlite default)
# ---------------------------------------------------------------------------
_database_url = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}")

# Minimal DATABASE_URL parser — supports sqlite:///path and postgres://...
# (no native deps; psycopg2 not installed; SQLite only for v1)
if _database_url.startswith("sqlite:///"):
    _db_path = _database_url[len("sqlite:///"):]
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": _db_path,
        }
    }
else:
    # Fallback to SQLite if an unsupported URL is supplied in dev
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
```

with:

```python
# ---------------------------------------------------------------------------
# Database (DATABASE_URL → Postgres in prod; SQLite fallback for tests/local)
# ---------------------------------------------------------------------------
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings -v1`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite (no regression on SQLite)**

Run: `cd backend && .venv/bin/python manage.py test -v1 2>&1 | tail -5`
Expected: `OK` — all existing tests still pass on SQLite.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add backend/requirements.txt backend/bgtrade/settings.py backend/bgtrade/test_settings.py
git commit -m "feat(db): drive DATABASES via dj-database-url + psycopg3, sqlite fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Local Postgres via docker-compose + README

**Files:**
- Create: `docker-compose.yml` (repo root)
- Modify: `README.md`

- [ ] **Step 1: Create `docker-compose.yml` at the repo root**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: emporium
      POSTGRES_USER: emporium
      POSTGRES_PASSWORD: emporium
    ports:
      - "5432:5432"
    volumes:
      - emporium_pgdata:/var/lib/postgresql/data

volumes:
  emporium_pgdata:
```

- [ ] **Step 2: Validate the compose file (if Docker is available)**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK`. If Docker is not installed in this environment, skip — the file is static YAML and will be exercised on the operator's machine.

- [ ] **Step 3: Add a Database subsection to `README.md`**

Find the existing local-setup / backend section of `README.md` and add this subsection (adjust the heading depth to match surrounding headings):

```markdown
### Database

By default the backend uses SQLite — no setup required. To run Postgres
locally (matches production):

```bash
docker compose up -d db
export DATABASE_URL=postgres://emporium:emporium@localhost:5432/emporium
cd backend && .venv/bin/python manage.py migrate
```

Unset `DATABASE_URL` (or open a new shell) to fall back to SQLite.
```

- [ ] **Step 4: Manual Postgres run-through (optional, needs Docker)**

If Docker is available, prove the wiring end-to-end:

```bash
docker compose up -d db
cd backend
DATABASE_URL=postgres://emporium:emporium@localhost:5432/emporium .venv/bin/python manage.py migrate
DATABASE_URL=postgres://emporium:emporium@localhost:5432/emporium .venv/bin/python manage.py test matching.test_external_solver -v1 2>&1 | tail -3
```
Expected: migrations apply cleanly; the test module reports `OK` against Postgres.
If Docker is unavailable, record this as a documented manual step and move on.

- [ ] **Step 5: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add docker-compose.yml README.md
git commit -m "feat(db): add local Postgres docker-compose + README instructions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 1 checkpoint: merge to main

- [ ] **Step 1: Run the full suite once more, then merge**

```bash
cd /home/juanigsrz/Desktop/Emporium/backend && .venv/bin/python manage.py test -v1 2>&1 | tail -3
cd /home/juanigsrz/Desktop/Emporium
git checkout main
git merge --no-ff feat/postgres -m "Merge feat/postgres: dj-database-url + psycopg3, local Postgres compose"
git branch -d feat/postgres
```
Expected: suite `OK`; clean merge. (Do not push unless the user asks.)

---

# PHASE 2 — Railway (`feat/railway-deploy`)

## Task 4: Create the Phase 2 branch + add deploy dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Branch off updated main**

```bash
cd /home/juanigsrz/Desktop/Emporium
git checkout main
git checkout -b feat/railway-deploy
git branch --show-current   # expect: feat/railway-deploy
```

- [ ] **Step 2: Add the dependencies to `backend/requirements.txt`**

Add a new section:

```
# Production server / static / broker
gunicorn==23.0.0
whitenoise==6.9.0
redis==5.2.1
```

- [ ] **Step 3: Install them**

Run: `cd backend && .venv/bin/pip install gunicorn==23.0.0 whitenoise==6.9.0 redis==5.2.1`
Expected: successful install (nearest compatible versions are fine; keep pins in sync).

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add backend/requirements.txt
git commit -m "build(deploy): add gunicorn, whitenoise, redis deps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Production-hardened settings (env-guarded)

**Files:**
- Modify: `backend/bgtrade/settings.py`
- Modify: `backend/bgtrade/test_settings.py`

- [ ] **Step 1: Write the failing settings tests**

Append to `backend/bgtrade/test_settings.py`:

```python
class DeploySettingsTests(SimpleTestCase):
    def test_whitenoise_right_after_security_middleware(self):
        mw = settings.MIDDLEWARE
        i = mw.index("django.middleware.security.SecurityMiddleware")
        self.assertEqual(mw[i + 1], "whitenoise.middleware.WhiteNoiseMiddleware")

    def test_static_root_named_staticfiles(self):
        self.assertTrue(str(settings.STATIC_ROOT).endswith("staticfiles"))

    def test_staticfiles_storage_is_compressed_not_manifest(self):
        # Vite already content-hashes assets; Manifest storage would re-hash and
        # break the SPA's index.html references. Must be plain Compressed.
        backend = settings.STORAGES["staticfiles"]["BACKEND"]
        self.assertEqual(backend, "whitenoise.storage.CompressedStaticFilesStorage")

    def test_celery_eager_defaults_true(self):
        # No CELERY_TASK_ALWAYS_EAGER in the test env -> eager stays on.
        self.assertTrue(settings.CELERY_TASK_ALWAYS_EAGER)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings.DeploySettingsTests -v1`
Expected: FAIL — WhiteNoise not in MIDDLEWARE / `STATIC_ROOT` absent / `STORAGES` not set.

- [ ] **Step 3: Insert the WhiteNoise middleware**

In `backend/bgtrade/settings.py`, in `MIDDLEWARE`, add the WhiteNoise line immediately after `SecurityMiddleware`:

```python
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
```

- [ ] **Step 4: Replace the static-files section**

In `backend/bgtrade/settings.py`, replace the static section (currently just `STATIC_URL = "static/"`, ~line 139) with:

```python
# ---------------------------------------------------------------------------
# Static files (WhiteNoise serves collected static + the built SPA assets)
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The built Vite SPA (frontend/dist) is collected into STATIC_ROOT so WhiteNoise
# serves its hashed assets. Only added when present (absent in dev/test).
_spa_dist = BASE_DIR.parent / "frontend" / "dist"
STATICFILES_DIRS = [_spa_dist] if _spa_dist.exists() else []

# Compressed (NOT Manifest): Vite already content-hashes assets; Manifest would
# re-hash them and break the SPA index.html references.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
```

- [ ] **Step 5: Add the Celery eager env toggle**

In `backend/bgtrade/settings.py`, replace the line `CELERY_TASK_ALWAYS_EAGER = True` (~line 210) with:

```python
CELERY_TASK_ALWAYS_EAGER = os.environ.get(
    "CELERY_TASK_ALWAYS_EAGER", "True"
).lower() not in ("false", "0", "no")
```

- [ ] **Step 6: Add hosts / CSRF / proxy / TLS hardening + DB SSL**

In `backend/bgtrade/settings.py`, immediately after the existing `ALLOWED_HOSTS = [...]` block (~line 27), add:

```python
# Railway provides RAILWAY_PUBLIC_DOMAIN; trust it for hosts + CSRF.
_railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
if _railway_domain:
    ALLOWED_HOSTS.append(_railway_domain)

CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()
]
if _railway_domain:
    CSRF_TRUSTED_ORIGINS.append(f"https://{_railway_domain}")

# Railway terminates TLS at its proxy.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
```

Then update the `DATABASES` block (added in Phase 1) to require SSL in production
only — replace it with:

```python
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
        # TLS only for a real (Postgres) DATABASE_URL in production; never sqlite.
        ssl_require=(not DEBUG) and bool(os.environ.get("DATABASE_URL")),
    )
}
```

Note: this `ALLOWED_HOSTS` add-on must appear after the `ALLOWED_HOSTS` list and
after `DEBUG` is defined (both are at the top of the file, ~lines 18-27), so it is
correctly ordered.

- [ ] **Step 7: Run the settings tests to verify they pass**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings -v1`
Expected: PASS (all DatabaseConfig + DeploySettings tests).

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add backend/bgtrade/settings.py backend/bgtrade/test_settings.py
git commit -m "feat(deploy): env-guarded WhiteNoise, TLS/proxy, CSRF, Celery eager toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Serve the SPA from Django (catch-all)

**Files:**
- Modify: `backend/bgtrade/urls.py`
- Modify: `backend/bgtrade/test_settings.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/bgtrade/test_settings.py`:

```python
from django.test import TestCase


class SpaServingTests(TestCase):
    def test_api_path_is_not_swallowed_by_spa(self):
        resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "ok")

    def test_spa_route_serves_built_index(self):
        # Simulate a collected SPA build at STATIC_ROOT/index.html.
        settings.STATIC_ROOT.mkdir(parents=True, exist_ok=True)
        index = settings.STATIC_ROOT / "index.html"
        index.write_text("<!doctype html><div id='root'></div>", encoding="utf-8")
        try:
            resp = self.client.get("/events/some-slug")
            self.assertEqual(resp.status_code, 200)
            self.assertIn("id='root'", resp.content.decode())
        finally:
            index.unlink()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings.SpaServingTests -v1`
Expected: FAIL — `/events/some-slug` returns 404 (no catch-all yet).

- [ ] **Step 3: Add the SPA catch-all view + route**

In `backend/bgtrade/urls.py`, add imports at the top (with the existing imports):

```python
from django.conf import settings
from django.http import Http404, HttpResponse
from django.urls import re_path
```

Add the view function (near the existing `health` view):

```python
def spa_index(request):
    """Serve the built SPA index for client-side routes. 404 before a build."""
    index_path = settings.STATIC_ROOT / "index.html"
    if not index_path.exists():
        raise Http404("SPA build not found")
    return HttpResponse(index_path.read_text(encoding="utf-8"), content_type="text/html")
```

Then add the catch-all as the **last** entry in `urlpatterns` (after the
`notifications` include):

```python
    # SPA catch-all — anything not under api/, admin/, static/, media/ serves the
    # built index.html so client-side routing works on deep links. Must be last.
    re_path(r"^(?!api/|admin/|static/|media/).*$", spa_index, name="spa"),
```

- [ ] **Step 4: Run the SPA tests to verify they pass**

Run: `cd backend && .venv/bin/python manage.py test bgtrade.test_settings.SpaServingTests -v1`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add backend/bgtrade/urls.py backend/bgtrade/test_settings.py
git commit -m "feat(deploy): serve built SPA via Django catch-all route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend build base path

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Set `base:'/static/'` for production builds only**

Replace the contents of `frontend/vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base '/static/' on build so asset URLs resolve under Django/WhiteNoise
// (STATIC_URL). Dev server keeps '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
}))
```

- [ ] **Step 2: Verify the production build emits `/static/` asset URLs**

Run: `cd frontend && VITE_API_BASE=/api npm run build 2>&1 | tail -5 && grep -o '/static/assets/[^"]*' dist/index.html | head`
Expected: build succeeds; `dist/index.html` references assets under `/static/assets/…`.

- [ ] **Step 3: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add frontend/vite.config.ts
git commit -m "build(frontend): base '/static/' on prod build for Django static serving

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Verify collectstatic gathers admin + SPA

**Files:** none (verification task using Task 7's build output)

- [ ] **Step 1: Run collectstatic with the built SPA present**

Run:
```bash
cd /home/juanigsrz/Desktop/Emporium/backend
.venv/bin/python manage.py collectstatic --noinput 2>&1 | tail -5
ls staticfiles/index.html && ls -d staticfiles/assets >/dev/null && echo "SPA collected OK"
```
Expected: collectstatic reports copied files with no error; `staticfiles/index.html`
and `staticfiles/assets/` exist (proves the SPA dir was collected and WhiteNoise
will serve it). `frontend/dist` exists from Task 7.

- [ ] **Step 2: Clean the local collectstatic output (not committed)**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && rm -rf staticfiles`
Note: `staticfiles/` is build output; confirm it is git-ignored (the repo's
`.gitignore` already ignores `*.log` etc.; if `staticfiles/` is not ignored, add a
line `staticfiles/` to the root `.gitignore` and commit that one-line change).

- [ ] **Step 3: If a .gitignore change was needed, commit it**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add .gitignore
git commit -m "chore: gitignore collected staticfiles/

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Skip if `staticfiles/` was already ignored.)

---

## Task 9: Dockerfile + Railway/process config

**Files:**
- Create: `Dockerfile`, `Procfile`, `railway.toml`, `.env.example` (all repo root)

- [ ] **Step 1: Create `Dockerfile` at the repo root**

```dockerfile
# syntax=docker/dockerfile:1

# --- Stage 1: build the Vite SPA ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE=/api
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=bgtrade.settings
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
# Bring in the built SPA so collectstatic gathers it.
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Collect static at build time (no DB needed; uses the default dev SECRET_KEY).
RUN python backend/manage.py collectstatic --noinput

EXPOSE 8000
CMD ["sh", "-c", "gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:${PORT:-8000}"]
```

- [ ] **Step 2: Create `Procfile` at the repo root**

```
release: python backend/manage.py migrate --noinput
web: gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:$PORT
worker: celery -A bgtrade worker -l info --workdir backend
```

- [ ] **Step 3: Create `railway.toml` at the repo root**

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:$PORT"
preDeployCommand = "python backend/manage.py migrate --noinput"
healthcheckPath = "/api/health/"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

- [ ] **Step 4: Create `.env.example` at the repo root**

```
# Django
SECRET_KEY=change-me-to-a-long-random-string
DEBUG=False
ALLOWED_HOSTS=
# Comma-separated, e.g. https://your-app.up.railway.app (RAILWAY_PUBLIC_DOMAIN is auto-trusted)
CSRF_TRUSTED_ORIGINS=

# Database (Railway Postgres plugin injects DATABASE_URL automatically)
DATABASE_URL=postgres://emporium:emporium@localhost:5432/emporium

# Celery / Redis (Railway Redis plugin injects the URL; set EAGER False in prod)
CELERY_TASK_ALWAYS_EAGER=False
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# Integrations
BGG_API_KEY=your-bgg-bearer-token
NOMINATIM_USER_AGENT=emporium/1.0 (+https://github.com/juanigsrz/Emporium)
```

- [ ] **Step 5: Validate the Dockerfile build (if Docker is available)**

Run: `cd /home/juanigsrz/Desktop/Emporium && docker build -t emporium:test . 2>&1 | tail -15`
Expected: build completes through `collectstatic` and tags `emporium:test`.
If Docker is unavailable in this environment, record this as a documented manual
step (the operator runs it / Railway runs it on deploy) and continue.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add Dockerfile Procfile railway.toml .env.example
git commit -m "feat(deploy): multi-stage Dockerfile + Procfile + railway.toml + env example

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Deployment README + deploy-check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run Django's deploy check under prod-like env**

Run:
```bash
cd /home/juanigsrz/Desktop/Emporium/backend
DEBUG=False SECRET_KEY=ci-check-only ALLOWED_HOSTS=example.com \
  DATABASE_URL=postgres://u:p@localhost:5432/d \
  .venv/bin/python manage.py check --deploy 2>&1 | tail -20
```
Expected: completes with no **blocking** errors (security `?: (security.W…)` warnings
about HSTS are acceptable and out of scope). If a blocking error appears, fix the
corresponding setting before continuing.

- [ ] **Step 2: Verify gunicorn can load the app**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && .venv/bin/gunicorn bgtrade.wsgi --chdir . --check-config && echo "gunicorn OK"`
Expected: `gunicorn OK` (config + import succeed).

- [ ] **Step 3: Add a Deployment section to `README.md`**

Add this section to `README.md`:

```markdown
## Deployment (Railway)

The repo deploys as a single Docker image (multi-stage: builds the Vite SPA, then
runs Django via gunicorn with WhiteNoise serving the SPA and static assets).

Create three Railway services from this repo + two plugins:

| Service  | How                                                                 |
|----------|---------------------------------------------------------------------|
| web      | Dockerfile build; start `gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:$PORT` |
| worker   | same image; start `celery -A bgtrade worker -l info --workdir backend` |
| Postgres | Railway Postgres plugin (injects `DATABASE_URL`)                    |
| Redis    | Railway Redis plugin (set `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND`) |

Required env vars (see `.env.example`): `SECRET_KEY`, `DEBUG=False`,
`CELERY_TASK_ALWAYS_EAGER=False`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`.
`RAILWAY_PUBLIC_DOMAIN` is auto-trusted for `ALLOWED_HOSTS` + CSRF. Migrations run
via the `preDeployCommand` in `railway.toml`.
```

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium
git add README.md
git commit -m "docs: Railway deployment instructions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (Phase 2)

- [ ] **Backend suite**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && .venv/bin/python manage.py test -v1 2>&1 | tail -3`
Expected: `OK`.

- [ ] **Frontend build + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && VITE_API_BASE=/api npm run build && npm run lint 2>&1 | tail -5`
Expected: build succeeds; lint shows only the pre-existing `CopyForm.tsx` warning (unrelated to this work).

Then complete via the finishing-a-development-branch skill (present merge/PR options for `feat/railway-deploy`).

---

## Spec coverage check

- Postgres via dj-database-url + psycopg, sqlite fallback → Task 2.
- Local Postgres compose + README → Task 3.
- Phase 1 merged before Phase 2 → Phase 1 checkpoint.
- gunicorn/whitenoise/redis deps → Task 4.
- WhiteNoise + STATIC_ROOT + STORAGES + SPA STATICFILES_DIRS → Task 5.
- Hosts/CSRF/proxy/TLS + DB ssl_require + Celery eager env → Task 5.
- SPA catch-all serving index.html → Task 6.
- Vite base '/static/' + VITE_API_BASE=/api → Task 7 (+ Dockerfile Task 9).
- collectstatic gathers SPA + admin → Task 8.
- Multi-stage Dockerfile, Procfile, railway.toml, .env.example → Task 9.
- README deployment + deploy check + gunicorn import → Task 10.
- Build/manual verification caveats (Docker may be absent) → noted in Tasks 3, 9.
```
