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
