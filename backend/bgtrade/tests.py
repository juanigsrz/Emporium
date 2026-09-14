"""
bgtrade/tests.py

Settings guards that only bite outside the dev defaults. Each case boots a
fresh interpreter so this test process's own settings stay untouched.
"""

import os
import subprocess
import sys

from django.conf import settings
from django.test import SimpleTestCase


def _boot(**env):
    base = {k: v for k, v in os.environ.items() if k != "SECRET_KEY"}
    return subprocess.run(
        [sys.executable, "-c",
         "import django; django.setup(); from django.conf import settings; "
         "print(settings.CELERY_TASK_ALWAYS_EAGER)"],
        cwd=settings.BASE_DIR,
        env={**base, "DJANGO_SETTINGS_MODULE": "bgtrade.settings", **env},
        capture_output=True, text=True,
    )


class SettingsGuardTests(SimpleTestCase):
    def test_insecure_secret_key_rejected_when_debug_off(self):
        r = _boot(DEBUG="false")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ImproperlyConfigured", r.stderr)

    def test_celery_eager_is_env_driven(self):
        self.assertEqual(_boot().stdout.strip(), "True")
        self.assertEqual(_boot(CELERY_TASK_ALWAYS_EAGER="false").stdout.strip(), "False")
