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
