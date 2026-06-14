"""Settings-level tests: database engine selection."""

import dj_database_url
from django.conf import settings
from django.test import SimpleTestCase, TestCase


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
