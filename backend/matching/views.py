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

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import TradeEvent
from .models import MatchRun, TradeAssignment, Shipment
from .services import ensure_shipments
from .serializers import (
    MatchRunDetailSerializer,
    MatchRunListSerializer,
    ShipmentSerializer,
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


# ---------------------------------------------------------------------------
# Upload (locally-solved solution)
# ---------------------------------------------------------------------------

class MatchRunUploadView(APIView):
    """
    POST /api/events/{slug}/matches/upload/

    Organizer uploads raw gurobi solver stdout (`give -> take`). Body = plain
    text. Parsed into a DONE MatchRun with TradeAssignment rows. Organizer-only;
    event must be in MATCHING.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug):
        from datetime import datetime, timezone

        from events.models import TradeEvent
        from matching.external_solver import load_solution

        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can upload a solution.")
        if event.status != TradeEvent.Status.MATCHING:
            raise ValidationError(
                {"detail": "Event must be in MATCHING status to upload a solution."}
            )

        # Accept a raw text body (text/plain) or a {"output": "..."} JSON payload.
        # Read request.body for raw text — touching request.data on a non-JSON
        # body would raise UnsupportedMediaType.
        content_type = request.content_type or ""
        if "application/json" in content_type:
            raw = request.data.get("output", "") if isinstance(request.data, dict) else ""
        else:
            raw = request.body.decode("utf-8", "replace")
        if not raw.strip():
            raise ValidationError({"detail": "Empty solution upload."})

        run = MatchRun.objects.create(
            event=event, status=MatchRun.Status.RUNNING, algorithm="gurobi-xy",
            started_at=datetime.now(timezone.utc),
        )
        try:
            result, summary, log = load_solution(run, raw)
        except ValueError as exc:
            run.delete()  # nothing half-persisted (load_solution is atomic)
            raise ValidationError({"detail": str(exc)})

        run.result = result
        run.summary = summary
        run.log = log
        run.status = MatchRun.Status.DONE
        run.finished_at = datetime.now(timezone.utc)
        run.save(update_fields=[
            "result", "summary", "log", "status", "finished_at",
        ])
        return Response(
            {"id": run.pk, "status": run.status, "summary": run.summary},
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Shipping
# ---------------------------------------------------------------------------

def _latest_done_run(event):
    return event.match_runs.filter(status=MatchRun.Status.DONE).order_by("-created").first()


class ShippingView(APIView):
    """
    GET /api/events/{slug}/shipping/

    Returns the requesting user's Shipments for the latest DONE run.
    Lazily creates Shipment rows on first access.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        run = _latest_done_run(event)
        if run is None:
            return Response([])
        ensure_shipments(run)
        shipments = (
            Shipment.objects.filter(assignment__match_run=run)
            .filter(Q(assignment__giver=request.user) | Q(assignment__receiver=request.user))
            .select_related(
                "assignment__event_listing__copy__board_game",
                "assignment__giver", "assignment__receiver",
            )
            .order_by("id")
        )
        return Response(
            ShipmentSerializer(shipments, many=True, context={"request": request}).data
        )


class ShippingOverviewView(APIView):
    """
    GET /api/events/{slug}/shipping/overview/

    Organizer-only: ALL shipments for the latest DONE run (lazily created).
    Read-only browse of overall shipping status.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"count": 0, "next": None, "previous": None, "results": []})
        ensure_shipments(run)
        qs = (
            Shipment.objects.filter(assignment__match_run=run)
            .select_related(
                "assignment__event_listing__copy__board_game",
                "assignment__giver", "assignment__receiver",
            )
            .order_by("id")
        )
        status_f = request.query_params.get("status")
        if status_f:
            qs = qs.filter(status=status_f)
        paginator = MatchPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            ShipmentSerializer(page, many=True, context={"request": request}).data
        )


class ShippingOverviewSummaryView(APIView):
    """GET /api/events/{slug}/shipping/overview/summary/ — organizer-only.
    Global status counts + per-trader rollup (independent of pagination)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _get_event(slug)
        if event.organizer_id != request.user.id:
            raise PermissionDenied("Only the organizer can view the shipping overview.")
        run = _latest_done_run(event)
        if run is None:
            return Response({"counts": {}, "traders": []})
        ensure_shipments(run)
        base = Shipment.objects.filter(assignment__match_run=run)
        counts = {
            row["status"]: row["c"]
            for row in base.values("status").annotate(c=Count("id"))
        }
        traders: dict[str, dict] = {}

        def slot(username):
            return traders.setdefault(username, {
                "username": username, "out_total": 0, "out_sent": 0,
                "in_total": 0, "in_received": 0,
            })

        for row in base.values("assignment__giver__username").annotate(
            out_total=Count("id"),
            out_sent=Count("id", filter=Q(status__in=["SENT", "RECEIVED"])),
        ):
            s = slot(row["assignment__giver__username"])
            s["out_total"] = row["out_total"]
            s["out_sent"] = row["out_sent"]
        for row in base.values("assignment__receiver__username").annotate(
            in_total=Count("id"),
            in_received=Count("id", filter=Q(status="RECEIVED")),
        ):
            s = slot(row["assignment__receiver__username"])
            s["in_total"] = row["in_total"]
            s["in_received"] = row["in_received"]

        return Response({
            "counts": counts,
            "traders": sorted(traders.values(), key=lambda t: t["username"]),
        })


class ShipmentDetailView(APIView):
    """
    PATCH /api/events/{slug}/shipping/{pk}/

    Sender marks SENT (with optional shipping_info); receiver marks RECEIVED.
    Only allowed while event.status == SHIPPING.
    """

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, slug, pk):
        event = _get_event(slug)
        if event.status != "SHIPPING":
            raise PermissionDenied("Shipping updates are only allowed while the event is shipping.")
        try:
            shipment = (
                Shipment.objects
                .select_related("assignment__giver", "assignment__receiver", "assignment__match_run")
                .get(pk=pk, assignment__match_run__event=event)
            )
        except Shipment.DoesNotExist:
            raise NotFound("Shipment not found.")

        a = shipment.assignment
        target = request.data.get("status")

        if target == "SENT":
            if request.user != a.giver:
                raise PermissionDenied("Only the sender can mark a shipment sent.")
            shipment.status = Shipment.Status.SENT
            shipment.sent_at = timezone.now()
            if "shipping_info" in request.data:
                shipment.shipping_info = request.data["shipping_info"]
        elif target == "RECEIVED":
            if request.user != a.receiver:
                raise PermissionDenied("Only the receiver can mark a shipment received.")
            shipment.status = Shipment.Status.RECEIVED
            shipment.received_at = timezone.now()
        else:
            raise ValidationError({"status": "Must be 'SENT' (sender) or 'RECEIVED' (receiver)."})

        shipment.save()
        return Response(ShipmentSerializer(shipment, context={"request": request}).data)
