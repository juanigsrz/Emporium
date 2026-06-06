"""
Celery application configuration for bgtrade.

In development, CELERY_TASK_ALWAYS_EAGER=True (set in settings.py) means
tasks run synchronously in the same process — no broker required.

To run a real worker (when a broker is available):
    celery -A bgtrade worker -l info
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bgtrade.settings")

app = Celery("bgtrade")

# Read Celery configuration from Django settings (CELERY_ namespace prefix).
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discover tasks in all installed Django apps.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
