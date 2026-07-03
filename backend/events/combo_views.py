"""events/combo_views.py

Combo CRUD + browse, nested under /api/events/{slug}/combos/.

  GET    /combos/            — all active combos in the event (browse);
                               ?board_game=<bgg_id> filter; ?mine=1 own only.
  POST   /combos/            — create (owner = request.user); blocked when locked.
  GET    /combos/{id}/       — detail.
  PATCH  /combos/{id}/       — owner-only; blocked when locked.
  DELETE /combos/{id}/       — owner-only; blocked when locked.
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Combo, TradeEvent
from .serializers import ComboSerializer


class ComboPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


_PREFETCH = "items__event_listing__copy__board_game"


class ComboMixin:
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ComboPagination

    def _get_event(self, slug):
        return get_object_or_404(TradeEvent, slug=slug)

    def _assert_editable(self, event):
        if event.submissions_locked:
            raise PermissionDenied("Combos are locked once want-lists open.")

    def _ctx(self, request, event):
        return {"request": request, "event": event}


class ComboListCreateView(ComboMixin, APIView):
    def get(self, request, slug):
        event = self._get_event(slug)
        qs = (
            Combo.objects.filter(event=event, active=True)
            .select_related("owner")
            .prefetch_related(_PREFETCH)
            .order_by("-created")
        )
        if request.query_params.get("mine") == "1":
            qs = qs.filter(owner=request.user)
        bg = request.query_params.get("board_game")
        if bg:
            qs = qs.filter(items__event_listing__copy__board_game_id=bg).distinct()
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request)
        ser = ComboSerializer(page, many=True, context=self._ctx(request, event))
        return paginator.get_paginated_response(ser.data)

    def post(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ctx = self._ctx(request, event)
        ser = ComboSerializer(data=request.data, context=ctx)
        ser.is_valid(raise_exception=True)
        combo = ser.save(event=event, owner=request.user)
        full = Combo.objects.prefetch_related(_PREFETCH).get(pk=combo.pk)
        return Response(ComboSerializer(full, context=ctx).data,
                        status=status.HTTP_201_CREATED)


class ComboDetailView(ComboMixin, APIView):
    def _get_combo(self, slug, pk):
        event = self._get_event(slug)
        combo = get_object_or_404(Combo, pk=pk, event=event)
        return event, combo

    def get(self, request, slug, pk):
        event, combo = self._get_combo(slug, pk)
        full = Combo.objects.prefetch_related(_PREFETCH).get(pk=combo.pk)
        return Response(ComboSerializer(full, context=self._ctx(request, event)).data)

    def patch(self, request, slug, pk):
        event, combo = self._get_combo(slug, pk)
        if combo.owner_id != request.user.id:
            raise PermissionDenied("You do not own this combo.")
        self._assert_editable(event)
        ctx = self._ctx(request, event)
        ser = ComboSerializer(combo, data=request.data, partial=True, context=ctx)
        ser.is_valid(raise_exception=True)
        combo = ser.save()
        full = Combo.objects.prefetch_related(_PREFETCH).get(pk=combo.pk)
        return Response(ComboSerializer(full, context=ctx).data)

    def delete(self, request, slug, pk):
        event, combo = self._get_combo(slug, pk)
        if combo.owner_id != request.user.id:
            raise PermissionDenied("You do not own this combo.")
        self._assert_editable(event)
        combo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
