"""
matching/views.py

F6 Matching endpoints, nested under /api/events/{slug}/matches/.

Routes:
    GET  /api/events/{slug}/matches/           — list MatchRuns (newest first)
    POST /api/events/{slug}/matches/           — organizer triggers a run
    GET  /api/events/{slug}/matches/{id}/      — run detail (status/log/summary)
    GET  /api/events/{slug}/matches/{id}/result/ — full result JSON
    GET  /api/events/{slug}/matches/{id}/mine/ — current user's assignments

Permissions:
    - List/Detail/Result/Mine: IsAuthenticated (participants may read).
    - POST: IsAuthenticated + must be the event organizer.
    - POST also validates event.status == MATCHING (else 400).

No WebSocket in v1 — the FE should poll GET /matches/{id}/ every 2 s while
status is PENDING or RUNNING; when DONE it fetches /result/ once.
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import TradeEvent
from .models import MatchRun, TradeAssignment
from .serializers import (
    MatchRunDetailSerializer,
    MatchRunListSerializer,
    TradeAssignmentSerializer,
)


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class MatchPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_event(slug: str) -> TradeEvent:
    return get_object_or_404(TradeEvent, slug=slug)


def _get_run(event: TradeEvent, run_id: int) -> MatchRun:
    return get_object_or_404(MatchRun, pk=run_id, event=event)


# ---------------------------------------------------------------------------
# List + Create
# ---------------------------------------------------------------------------

class MatchRunListCreateView(APIView):
    """
    GET  /api/events/{slug}/matches/  — list (newest first)
    POST /api/events/{slug}/matches/  — organizer triggers a new run
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        qs = MatchRun.objects.filter(event=event).order_by("-created")

        paginator = MatchPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            ser = MatchRunListSerializer(page, many=True)
            return paginator.get_paginated_response(ser.data)

        ser = MatchRunListSerializer(qs, many=True)
        return Response(ser.data)

    def post(self, request, slug):
        event = _get_event(slug)

        # Organizer-only
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can trigger a match run.")

        # Require event to be in MATCHING state
        if event.status != TradeEvent.Status.MATCHING:
            raise ValidationError(
                {"detail": "Event must be in MATCHING status to trigger a run."}
            )

        match_run = MatchRun.objects.create(
            event=event,
            status=MatchRun.Status.PENDING,
            algorithm="fake",
        )

        # Enqueue the Celery task (runs eagerly in dev)
        from matching.tasks import run_match
        run_match.delay(match_run.pk)

        return Response(
            {"id": match_run.pk, "status": match_run.status},
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------

class MatchRunDetailView(APIView):
    """
    GET /api/events/{slug}/matches/{id}/

    Returns status, summary, log, timestamps — suitable for polling.
    FE polls this every 2 s while status is PENDING/RUNNING.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug, run_id):
        event = _get_event(slug)
        run = _get_run(event, run_id)
        ser = MatchRunDetailSerializer(run)
        return Response(ser.data)


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

class MatchRunResultView(APIView):
    """
    GET /api/events/{slug}/matches/{id}/result/

    Returns the raw result JSON blob (DATA_MODEL schema).
    Returns 400 if the run is not DONE.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug, run_id):
        event = _get_event(slug)
        run = _get_run(event, run_id)

        if run.status != MatchRun.Status.DONE:
            raise ValidationError(
                {"detail": f"Result not available; run status is {run.status}."}
            )

        return Response(run.result)


# ---------------------------------------------------------------------------
# Mine
# ---------------------------------------------------------------------------

class MatchRunMineView(APIView):
    """
    GET /api/events/{slug}/matches/{id}/mine/

    Returns only the requesting user's TradeAssignments (as giver OR receiver).
    Includes display companions so the UI can render:
      "you give <listing_code> to <receiver_username>"
      "you receive <listing_code> from <giver_username>"
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug, run_id):
        from django.db.models import Q

        event = _get_event(slug)
        run = _get_run(event, run_id)

        qs = (
            TradeAssignment.objects
            .filter(match_run=run)
            .filter(Q(giver=request.user) | Q(receiver=request.user))
            .select_related(
                "event_listing__copy__board_game",
                "giver",
                "receiver",
            )
            .order_by("cycle_id", "id")
        )

        paginator = MatchPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            ser = TradeAssignmentSerializer(page, many=True)
            return paginator.get_paginated_response(ser.data)

        ser = TradeAssignmentSerializer(qs, many=True)
        return Response(ser.data)
