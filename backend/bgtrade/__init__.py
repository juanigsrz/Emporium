# Load Celery app at Django startup so shared_task decorators work correctly.
from .celery import app as celery_app

__all__ = ("celery_app",)
