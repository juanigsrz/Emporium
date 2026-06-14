"""
Django settings for bgtrade project.
"""

import os
from pathlib import Path

import dj_database_url

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Environment-driven core settings
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get(
    "SECRET_KEY",
    "django-insecure-dev-only-change-me-in-production-!@#$%^&*()",
)

DEBUG = os.environ.get("DEBUG", "True").lower() not in ("false", "0", "no")

_allowed_hosts = os.environ.get("ALLOWED_HOSTS", "")
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts.split(",") if h.strip()] or [
    "localhost",
    "127.0.0.1",
]

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

# ---------------------------------------------------------------------------
# Database (DATABASE_URL → Postgres in prod; SQLite fallback for tests/local)
# ---------------------------------------------------------------------------
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
        # TLS only for a real (Postgres) DATABASE_URL in production; never sqlite.
        ssl_require=(not DEBUG) and bool(os.environ.get("DATABASE_URL")),
    )
}

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",  # required by allauth
    # Third-party
    "rest_framework",
    "rest_framework.authtoken",
    "dj_rest_auth",
    "dj_rest_auth.registration",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # Local apps
    "accounts.apps.AccountsConfig",
    "catalog.apps.CatalogConfig",
    "copies.apps.CopiesConfig",
    "events.apps.EventsConfig",
    "trades.apps.TradesConfig",
    "matching.apps.MatchingConfig",
    "bgg.apps.BggConfig",
    "notifications.apps.NotificationsConfig",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # must be before CommonMiddleware
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",  # required by allauth 65+
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "bgtrade.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "bgtrade.wsgi.application"

# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

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

# ---------------------------------------------------------------------------
# Default PK
# ---------------------------------------------------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# django.contrib.sites (allauth requirement)
# ---------------------------------------------------------------------------
SITE_ID = 1

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# ---------------------------------------------------------------------------
# drf-spectacular (OpenAPI schema)
# ---------------------------------------------------------------------------
SPECTACULAR_SETTINGS = {
    "TITLE": "Emporium API",
    "DESCRIPTION": "Board-game math trade platform API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# ---------------------------------------------------------------------------
# django-allauth (65.x+ settings API)
# ---------------------------------------------------------------------------
ACCOUNT_EMAIL_VERIFICATION = "none"  # dev default; set to "mandatory" in prod
# New-style allauth 65+ settings (replaces deprecated EMAIL_REQUIRED / AUTHENTICATION_METHOD)
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_LOGIN_METHODS = {"username", "email"}

# ---------------------------------------------------------------------------
# dj-rest-auth
# ---------------------------------------------------------------------------
REST_AUTH = {
    "USE_JWT": False,
    "TOKEN_MODEL": "rest_framework.authtoken.models.Token",
    "SESSION_LOGIN": False,
}

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
]
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------------
# Celery (no broker required in dev — ALWAYS_EAGER mode)
# ---------------------------------------------------------------------------
CELERY_TASK_ALWAYS_EAGER = os.environ.get(
    "CELERY_TASK_ALWAYS_EAGER", "True"
).lower() not in ("false", "0", "no")
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "memory://")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "cache")
CELERY_CACHE_BACKEND = "memory"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# ---------------------------------------------------------------------------
# Cache (LocMemCache — per-process, dev-only; swap to Redis in prod)
# ---------------------------------------------------------------------------
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "bgtrade-cache",
    }
}
GAME_CACHE_TIMEOUT = 60  # seconds

# ---------------------------------------------------------------------------
# BGG scraping + geocoding
# ---------------------------------------------------------------------------
BGG_BASE_URL = os.environ.get("BGG_BASE_URL", "https://boardgamegeek.com")
BGG_USER_AGENT = os.environ.get(
    "BGG_USER_AGENT", "mathtrade-app/1.0 (+https://example.org; contact ops@example.org)"
)
BGG_REQUEST_DELAY = float(os.environ.get("BGG_REQUEST_DELAY", "1.0"))  # seconds between page fetches
BGG_MAX_PAGES = int(os.environ.get("BGG_MAX_PAGES", "30"))
NOMINATIM_BASE_URL = os.environ.get("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
# OSM Nominatim enforces a stricter UA policy than BGG: stock/placeholder agents
# (e.g. the BGG default's "example.org") get a 403. Keep it separate + compliant,
# overridable so operators can set a real contact. See:
# https://operations.osmfoundation.org/policies/nominatim/
NOMINATIM_USER_AGENT = os.environ.get(
    "NOMINATIM_USER_AGENT",
    "mathtrade-app/1.0 (+https://github.com/juanigsrz/Emporium)",
)

BGG_API_KEY = os.environ.get(
    "BGG_API_KEY",
    "your-bgg-bearer-token",
)