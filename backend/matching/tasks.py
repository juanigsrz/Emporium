"""
matching/tasks.py

Celery task for running the matching algorithm asynchronously.

In dev (CELERY_TASK_ALWAYS_EAGER=True) this runs synchronously inline.
"""

import traceback
from datetime import datetime, timezone

from celery import shared_task


@shared_task
def run_match(match_run_id: int):
    """
    Execute the FakeMatcher for the given MatchRun.

    Transitions: PENDING → RUNNING → DONE (or FAILED on exception).
    Progress is appended to MatchRun.log.
    """
    from django.conf import settings

    from events.models import TradeEvent
    from matching.models import MatchRun
    from matching.fake_matcher import FakeMatcher
    from matching import external_solver

    try:
        match_run = MatchRun.objects.select_related("event").get(pk=match_run_id)
    except MatchRun.DoesNotExist:
        return

    # Mark RUNNING
    match_run.status = MatchRun.Status.RUNNING
    match_run.started_at = datetime.now(timezone.utc)
    match_run.log = f"[{_ts()}] run_match started\n"
    match_run.save(update_fields=["status", "started_at", "log"])

    try:
        event = match_run.event
        use_online = getattr(settings, "MATCHING_USE_ONLINE_SOLVER", False)

        if (
            event.matching_mode == TradeEvent.MatchingMode.ONETOONE
            and use_online
        ):
            # Hosted C++ ftm solver: export wants -> POST -> parse stdout.
            match_run.algorithm = "ftm-online"
            wants = external_solver.build_wants(event)
            stdout = external_solver.call_online_solver(wants)
            result, summary, matcher_log = external_solver.load_solution(
                match_run, stdout
            )
        else:
            # Offline placeholder (dev/CI, and X-to-Y is never solved here).
            matcher = FakeMatcher(match_run)
            result, summary, matcher_log = matcher.run()

        match_run.result = result
        match_run.summary = summary
        match_run.log += matcher_log
        match_run.status = MatchRun.Status.DONE
        match_run.finished_at = datetime.now(timezone.utc)
        match_run.log += f"\n[{_ts()}] run_match finished OK"
        match_run.save(
            update_fields=[
                "result", "summary", "log", "status", "finished_at", "algorithm",
            ]
        )

    except Exception:
        tb = traceback.format_exc()
        match_run.status = MatchRun.Status.FAILED
        match_run.finished_at = datetime.now(timezone.utc)
        match_run.log += f"\n[{_ts()}] FAILED:\n{tb}"
        match_run.save(update_fields=["status", "finished_at", "log"])
        raise  # re-raise so Celery marks the task as failed


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")
