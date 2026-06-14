# Postgres + Railway deployment

**Date:** 2026-06-14

## Problem

The app currently runs on SQLite via a hand-rolled `DATABASE_URL` parser
(`backend/bgtrade/settings.py:33-58`) that only understands `sqlite:///` and
falls back to SQLite for anything else (psycopg is not installed). It has no
deployment artifacts (no Dockerfile/Procfile/railway config), runs Celery in
eager mode with no broker, serves no static files in production, and the
frontend is a separate Vite SPA that talks to `http://localhost:8000/api`.

We want two things, delivered as two sequential branches:

1. **Postgres** — make Postgres the real database, driven by `DATABASE_URL`,
   while keeping a zero-setup SQLite fallback for tests and quick local runs.
2. **Railway** — prepare the repo to run as a Railway deployment: a single web
   service where Django serves the built SPA and the `/api`, a separate Celery
   worker service, plus Redis and Postgres plugins.

## Decisions (locked)

- **Postgres scope:** `DATABASE_URL`-driven via `dj-database-url` + `psycopg`
  (psycopg3). Postgres when `DATABASE_URL` is a `postgres://` URL (Railway /
  prod); SQLite when the env var is absent (tests, quick local).
- **Railway service shape:** single web service. Django serves the built Vite
  SPA via WhiteNoise and serves `/api`. No separate frontend deploy.
- **Celery:** Redis broker + a separate worker service in prod.
  `CELERY_TASK_ALWAYS_EAGER` stays `True` in dev/tests and is set to `False`
  via env in prod.
- **Branches:** `feat/postgres` first (merge to `main`), then
  `feat/railway-deploy` off the updated `main`.
- **Build:** multi-stage `Dockerfile` (Node build of the SPA + Python runtime),
  chosen over Nixpacks because one service builds two languages.

## Phase 1 — Postgres (`feat/postgres`)

### Dependencies — `backend/requirements.txt`

Add:

- `dj-database-url` — parse `DATABASE_URL` into Django's `DATABASES` dict.
- `psycopg[binary]` — psycopg3; Django 5.2's `django.db.backends.postgresql`
  uses it automatically when present.

### Settings — `backend/bgtrade/settings.py`

Replace the entire hand-rolled database block (the `_database_url = …` parser
through the `else:` SQLite fallback, lines ~31-58) with:

```python
import dj_database_url

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}
```

(`import dj_database_url` goes with the other top-of-file imports.) Behaviour:

- No `DATABASE_URL` set → SQLite at `BASE_DIR/db.sqlite3` (tests + quick local
  unchanged).
- `DATABASE_URL=postgres://…` → Postgres with persistent connections + health
  checks.

Phase 2 adds `ssl_require` for prod; Phase 1 leaves SSL off so local Postgres
works without TLS.

### Local Postgres — `docker-compose.yml` (repo root)

A `postgres:16` service for developers who want prod parity locally:

- DB / user / password all `emporium`; named volume for persistence; host port
  `5432`.
- Documented DSN: `DATABASE_URL=postgres://emporium:emporium@localhost:5432/emporium`.

### README

Add a short "Database" subsection: SQLite is the default (no setup); to use
Postgres locally, `docker compose up -d db` and export the DSN above, then
`python manage.py migrate`.

### Verification

- Full backend test suite passes on SQLite (no env) — proves no regression.
- Import smoke check: `python -c "import dj_database_url, psycopg"`.
- Settings load + `manage.py check` with a `postgres://` `DATABASE_URL` (parser
  selects the Postgres engine) — no live connection needed for `check`.
- Manual (documented, needs Docker): `docker compose up -d db`,
  `DATABASE_URL=postgres://… manage.py migrate`, run a small test subset against
  Postgres.

## Phase 2 — Railway (`feat/railway-deploy`)

### Dependencies — `backend/requirements.txt`

Add `gunicorn` (WSGI server), `whitenoise` (static serving), `redis` (Celery
broker client).

### Settings — `backend/bgtrade/settings.py` (all env-guarded; dev defaults unchanged)

- **WhiteNoise:** insert `whitenoise.middleware.WhiteNoiseMiddleware` directly
  after `SecurityMiddleware`. Set `STATIC_ROOT = BASE_DIR / "staticfiles"` and
  `STORAGES["staticfiles"]` to
  `whitenoise.storage.CompressedManifestStaticFilesStorage`.
- **SPA assets:** add the built SPA dir to `STATICFILES_DIRS` so `collectstatic`
  collects the Vite `assets/` (only when the dir exists, to keep dev/test happy).
- **Hosts / CSRF:** if `RAILWAY_PUBLIC_DOMAIN` is set, append it to
  `ALLOWED_HOSTS` and add `https://<domain>` to `CSRF_TRUSTED_ORIGINS`. Also
  read an explicit `CSRF_TRUSTED_ORIGINS` env (comma list) as an override.
- **Proxy / TLS:** `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`.
  When `DEBUG` is false: `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE` all true.
- **Postgres SSL:** when `DATABASE_URL` is set, configure
  `dj_database_url.config(..., ssl_require=not DEBUG)` so prod requires TLS but
  local compose Postgres does not.
- **Celery:** `CELERY_TASK_ALWAYS_EAGER` from env (default `True`; prod sets
  `False`). `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` already read env — set
  them to the Railway Redis URL in prod.

### SPA serving — Django

- A catch-all URL (registered last in `bgtrade/urls.py`) returns the built
  `index.html` for any path that is not `/api/…`, `/admin/…`, `/static/…`, or
  the schema routes. This makes client-side routing work on refresh/deep-link.
- `index.html` is served from the built SPA (read from the collected/static
  location). API stays under `/api/`.

### Frontend build config

- `frontend/vite.config.ts`: set `base: "/static/"` so built asset URLs resolve
  to `/static/assets/…` (where WhiteNoise serves them via `STATIC_ROOT`).
- Build with `VITE_API_BASE=/api` so the SPA calls the same origin (no CORS in
  prod).

### Dockerfile (repo root, multi-stage)

- **Stage 1 — `node:20`:** `npm ci` + `npm run build` in `frontend/` with
  `VITE_API_BASE=/api`, producing `frontend/dist`.
- **Stage 2 — `python:3.12-slim`:** install `backend/requirements.txt`, copy the
  backend, copy `frontend/dist` to the path referenced by `STATICFILES_DIRS`,
  run `python manage.py collectstatic --noinput`, expose the port, default
  `CMD` runs gunicorn.

### Process / platform config

- **`Procfile`** (repo root):
  - `release: python backend/manage.py migrate`
  - `web: gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:$PORT`
  - `worker: celery -A bgtrade worker -l info --workdir backend`
- **`railway.toml`** (repo root): Dockerfile builder; deploy `startCommand`,
  `healthcheckPath = "/api/schema/"` (or a lightweight health route),
  restart policy.
- **`.env.example`** (repo root): every env var the app reads — `SECRET_KEY`,
  `DEBUG`, `ALLOWED_HOSTS`, `DATABASE_URL`, `CELERY_BROKER_URL`,
  `CELERY_RESULT_BACKEND`, `CELERY_TASK_ALWAYS_EAGER`, `CSRF_TRUSTED_ORIGINS`,
  `BGG_*`, `NOMINATIM_*` — with safe placeholder values.
- **Railway topology (documented in README):** web service (this Dockerfile) +
  worker service (same image, start command `celery -A bgtrade worker
  --workdir backend`) + Redis plugin + Postgres plugin. Railway injects
  `DATABASE_URL`, the Redis URL, and `RAILWAY_PUBLIC_DOMAIN`.

### Verification

- `npm run build` (with `base:"/static/"`) succeeds.
- `python manage.py collectstatic --noinput` collects admin/DRF static + SPA
  assets without error.
- `manage.py check --deploy` under `DEBUG=False` with required env set — no
  blocking errors.
- gunicorn import: `gunicorn bgtrade.wsgi --chdir backend --check-config`.
- `docker build .` succeeds end-to-end (if Docker is available in the
  environment; otherwise documented as a manual step).
- Actual Railway deploy is performed by the operator, outside this environment.

## Out of scope

- Redis-backed Django cache (stays `LocMemCache`; the game cache is a
  best-effort per-process perf cache).
- Production email backend, CDN, CI pipeline.
- Splitting the frontend into its own deploy (single-service decision).
