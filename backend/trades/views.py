"""
trades/views.py

F5 X-to-Y Trades endpoints, all nested under /api/events/{slug}/.

Routes (registered via events/urls.py extra patterns):
    GET/POST      /api/events/{slug}/offer-groups/
    GET/PATCH/DELETE /api/events/{slug}/offer-groups/{id}/
    GET/POST      /api/events/{slug}/want-groups/
    GET/PATCH/DELETE /api/events/{slug}/want-groups/{id}/
    GET/POST      /api/events/{slug}/wishes/
    GET/PATCH/DELETE /api/events/{slug}/wishes/{id}/

Permissions:
    - All endpoints: IsAuthenticated
    - List/Read: returns only the requesting user's own objects (mine by default).
    - Create: user = request.user; group/wish must belong to the request user.
    - Update/Destroy: owner-only (403 otherwise).

Context passed to serializers:
    - "request": the DRF request
    - "event": the resolved TradeEvent instance
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import TradeEvent
from .models import OfferGroup, WantGroup, TradeWish, UserGamePrice, WantBid
from .serializers import OfferGroupSerializer, WantGroupSerializer, TradeWishSerializer, UserGamePriceSerializer, WantBidSerializer


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class TradePagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------------------
# Mixin: resolve the event from the URL slug and attach to context
# ---------------------------------------------------------------------------

class EventScopedMixin:
    """
    Resolves the event from the URL kwarg `slug` and provides helpers.
    Subclasses get `self.event` after calling `_get_event(request, slug)`.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = TradePagination

    def _get_event(self, slug):
        return get_object_or_404(TradeEvent, slug=slug)

    def _assert_editable(self, event):
        if event.inputs_locked:
            raise PermissionDenied("Want lists are locked — this event has moved to matching.")

    def _serializer_context(self, request, event):
        return {"request": request, "event": event}

    def _paginate(self, queryset, serializer_class, request, event):
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request)
        if page is not None:
            ser = serializer_class(
                page, many=True, context=self._serializer_context(request, event)
            )
            return paginator.get_paginated_response(ser.data)
        ser = serializer_class(
            queryset, many=True, context=self._serializer_context(request, event)
        )
        return Response(ser.data)


# ---------------------------------------------------------------------------
# OfferGroup list + create
# ---------------------------------------------------------------------------

class OfferGroupListCreateView(EventScopedMixin, APIView):
    """
    GET  /api/events/{slug}/offer-groups/  — list current user's offer groups
    POST /api/events/{slug}/offer-groups/  — create an offer group
    """

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = (
            OfferGroup.objects
            .filter(event=event, user=request.user)
            .prefetch_related("items__event_listing__copy__board_game")
            .order_by("-created")
        )
        return self._paginate(qs, OfferGroupSerializer, request, event)

    def post(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = OfferGroupSerializer(data=request.data, context=ctx)
        ser.is_valid(raise_exception=True)
        group = ser.save(event=event, user=request.user)
        # Re-serialize with prefetch for nested items
        group_full = (
            OfferGroup.objects
            .prefetch_related("items__event_listing__copy__board_game")
            .get(pk=group.pk)
        )
        out = OfferGroupSerializer(group_full, context=ctx)
        return Response(out.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# OfferGroup retrieve + update + delete
# ---------------------------------------------------------------------------

class OfferGroupDetailView(EventScopedMixin, APIView):
    """
    GET    /api/events/{slug}/offer-groups/{id}/
    PATCH  /api/events/{slug}/offer-groups/{id}/
    DELETE /api/events/{slug}/offer-groups/{id}/
    """

    def _get_group(self, slug, pk, request):
        event = self._get_event(slug)
        group = get_object_or_404(OfferGroup, pk=pk, event=event)
        if group.user != request.user:
            raise PermissionDenied("You do not own this offer group.")
        return event, group

    def get(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        group = (
            OfferGroup.objects
            .prefetch_related("items__event_listing__copy__board_game")
            .get(pk=group.pk)
        )
        ser = OfferGroupSerializer(group, context=self._serializer_context(request, event))
        return Response(ser.data)

    def patch(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = OfferGroupSerializer(group, data=request.data, partial=True, context=ctx)
        ser.is_valid(raise_exception=True)
        group = ser.save()
        group = (
            OfferGroup.objects
            .prefetch_related("items__event_listing__copy__board_game")
            .get(pk=group.pk)
        )
        out = OfferGroupSerializer(group, context=ctx)
        return Response(out.data)

    def delete(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        self._assert_editable(event)
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# WantGroup list + create
# ---------------------------------------------------------------------------

class WantGroupListCreateView(EventScopedMixin, APIView):
    """
    GET  /api/events/{slug}/want-groups/
    POST /api/events/{slug}/want-groups/
    """

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = (
            WantGroup.objects
            .filter(event=event, user=request.user)
            .prefetch_related(
                "items__board_game",
                "items__event_listing__copy__board_game",
            )
            .order_by("-created")
        )
        return self._paginate(qs, WantGroupSerializer, request, event)

    def post(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)

        # Validate event_listing items belong to this event before saving.
        # The WantGroupItemSerializer validates target_type logic; we add event
        # scoping here.
        self._check_want_items_event_scope(request.data.get("items", []), event)

        ser = WantGroupSerializer(data=request.data, context=ctx)
        ser.is_valid(raise_exception=True)
        group = ser.save(event=event, user=request.user)
        group_full = (
            WantGroup.objects
            .prefetch_related(
                "items__board_game",
                "items__event_listing__copy__board_game",
            )
            .get(pk=group.pk)
        )
        out = WantGroupSerializer(group_full, context=ctx)
        return Response(out.data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _check_want_items_event_scope(items_data, event):
        """Ensure any event_listing references belong to the given event."""
        from events.models import EventListing
        for idx, item in enumerate(items_data):
            el_id = item.get("event_listing")
            if el_id:
                if not EventListing.objects.filter(pk=el_id, event=event).exists():
                    raise ValidationError(
                        {f"items[{idx}].event_listing": (
                            f"EventListing {el_id} does not belong to this event."
                        )}
                    )


# ---------------------------------------------------------------------------
# WantGroup retrieve + update + delete
# ---------------------------------------------------------------------------

class WantGroupDetailView(EventScopedMixin, APIView):
    """
    GET    /api/events/{slug}/want-groups/{id}/
    PATCH  /api/events/{slug}/want-groups/{id}/  — REPLACES items list (bulk)
    DELETE /api/events/{slug}/want-groups/{id}/
    """

    def _get_group(self, slug, pk, request):
        event = self._get_event(slug)
        group = get_object_or_404(WantGroup, pk=pk, event=event)
        if group.user != request.user:
            raise PermissionDenied("You do not own this want group.")
        return event, group

    def _prefetch(self, pk):
        return (
            WantGroup.objects
            .prefetch_related(
                "items__board_game",
                "items__event_listing__copy__board_game",
            )
            .get(pk=pk)
        )

    def get(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        group = self._prefetch(group.pk)
        ser = WantGroupSerializer(group, context=self._serializer_context(request, event))
        return Response(ser.data)

    def patch(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)

        # Validate event scoping of any listing references in the incoming items
        if "items" in request.data:
            WantGroupListCreateView._check_want_items_event_scope(
                request.data["items"], event
            )

        ser = WantGroupSerializer(group, data=request.data, partial=True, context=ctx)
        ser.is_valid(raise_exception=True)
        group = ser.save()
        group = self._prefetch(group.pk)
        out = WantGroupSerializer(group, context=ctx)
        return Response(out.data)

    def delete(self, request, slug, pk):
        event, group = self._get_group(slug, pk, request)
        self._assert_editable(event)
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# TradeWish list + create
# ---------------------------------------------------------------------------

class TradeWishListCreateView(EventScopedMixin, APIView):
    """
    GET  /api/events/{slug}/wishes/
    POST /api/events/{slug}/wishes/
    """

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = (
            TradeWish.objects
            .filter(event=event, user=request.user)
            .select_related("offer_group", "want_group")
            .order_by("-created")
        )
        return self._paginate(qs, TradeWishSerializer, request, event)

    def post(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = TradeWishSerializer(data=request.data, context=ctx)
        ser.is_valid(raise_exception=True)
        wish = ser.save(event=event, user=request.user)
        wish_full = (
            TradeWish.objects
            .select_related("offer_group", "want_group")
            .get(pk=wish.pk)
        )
        out = TradeWishSerializer(wish_full, context=ctx)
        return Response(out.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# TradeWish retrieve + update + delete
# ---------------------------------------------------------------------------

class TradeWishDetailView(EventScopedMixin, APIView):
    """
    GET    /api/events/{slug}/wishes/{id}/
    PATCH  /api/events/{slug}/wishes/{id}/
    DELETE /api/events/{slug}/wishes/{id}/
    """

    def _get_wish(self, slug, pk, request):
        event = self._get_event(slug)
        wish = get_object_or_404(TradeWish, pk=pk, event=event)
        if wish.user != request.user:
            raise PermissionDenied("You do not own this wish.")
        return event, wish

    def get(self, request, slug, pk):
        event, wish = self._get_wish(slug, pk, request)
        wish = (
            TradeWish.objects
            .select_related("offer_group", "want_group")
            .get(pk=wish.pk)
        )
        ser = TradeWishSerializer(wish, context=self._serializer_context(request, event))
        return Response(ser.data)

    def patch(self, request, slug, pk):
        event, wish = self._get_wish(slug, pk, request)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = TradeWishSerializer(wish, data=request.data, partial=True, context=ctx)
        ser.is_valid(raise_exception=True)
        wish = ser.save()
        wish = (
            TradeWish.objects
            .select_related("offer_group", "want_group")
            .get(pk=wish.pk)
        )
        out = TradeWishSerializer(wish, context=ctx)
        return Response(out.data)

    def delete(self, request, slug, pk):
        event, wish = self._get_wish(slug, pk, request)
        self._assert_editable(event)
        wish.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# GamePrice upsert
# ---------------------------------------------------------------------------

class GamePriceView(EventScopedMixin, APIView):
    """GET/PUT/DELETE /api/events/{slug}/game-prices/ — the user's per-game prices."""

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = UserGamePrice.objects.filter(event=event, user=request.user).select_related("board_game")
        return Response(UserGamePriceSerializer(qs, many=True).data)

    def put(self, request, slug):
        event = self._get_event(slug)
        ser = UserGamePriceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        board_game = ser.validated_data["board_game"]
        obj, _ = UserGamePrice.objects.update_or_create(
            user=request.user, event=event, board_game=board_game,
            defaults={"price": ser.validated_data["price"]},
        )
        return Response(UserGamePriceSerializer(obj).data, status=status.HTTP_200_OK)

    def delete(self, request, slug):
        event = self._get_event(slug)
        bgg_id = request.query_params.get("board_game")
        if not bgg_id:
            raise ValidationError({"board_game": "Required query parameter."})
        try:
            bgg_id = int(bgg_id)
        except (TypeError, ValueError):
            raise ValidationError({"board_game": "Must be an integer."})
        UserGamePrice.objects.filter(
            user=request.user, event=event, board_game_id=bgg_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# WantBid upsert
# ---------------------------------------------------------------------------

class WantBidView(EventScopedMixin, APIView):
    """GET/PUT/DELETE /api/events/{slug}/want-bids/ — the user's per-target bids."""

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = WantBid.objects.filter(event=event, user=request.user)
        return Response(WantBidSerializer(qs, many=True).data)

    def put(self, request, slug):
        event = self._get_event(slug)
        ser = WantBidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d["target_type"] == WantBid.TargetType.BOARD_GAME:
            key = {"board_game": d["board_game"], "event_listing": None}
        else:
            key = {"event_listing": d["event_listing"], "board_game": None}
        obj, _ = WantBid.objects.update_or_create(
            user=request.user, event=event, target_type=d["target_type"], **key,
            defaults={"amount": d["amount"]},
        )
        return Response(WantBidSerializer(obj).data, status=status.HTTP_200_OK)

    def delete(self, request, slug):
        event = self._get_event(slug)
        bgg = request.query_params.get("board_game")
        el = request.query_params.get("event_listing")
        if not bgg and not el:
            raise ValidationError({"detail": "board_game or event_listing query param required."})
        f = {"user": request.user, "event": event}
        if bgg:
            try:
                f["board_game_id"] = int(bgg)
            except (TypeError, ValueError):
                raise ValidationError({"board_game": "Must be an integer."})
        if el:
            try:
                f["event_listing_id"] = int(el)
            except (TypeError, ValueError):
                raise ValidationError({"event_listing": "Must be an integer."})
        WantBid.objects.filter(**f).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
