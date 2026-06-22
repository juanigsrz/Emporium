"""
events/views.py

F4 Trade Events endpoints.

Endpoints:
    GET/POST      /api/events/
    GET/PATCH/DELETE /api/events/{slug}/
    POST          /api/events/{slug}/transition/
    GET           /api/events/{slug}/participants/
    POST          /api/events/{slug}/join/
    DELETE        /api/events/{slug}/leave/
    GET/POST      /api/events/{slug}/listings/
    PATCH/DELETE  /api/events/{slug}/listings/{id}/

Permissions:
    - List/Retrieve: IsAuthenticated
    - Create: IsAuthenticated
    - Update/Destroy event: organizer only (403 otherwise)
    - Transition: organizer only
    - Join/Leave: authenticated user
    - Listings read: authenticated
    - Listings create: authenticated; copy.owner == request.user
    - Listings delete: copy.owner == request.user
"""

import logging

from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .models import EventListing, EventParticipation, TradeEvent
from .serializers import (
    EventGameSerializer,
    EventListingSerializer,
    EventParticipationSerializer,
    TradeEventSerializer,
    TransitionSerializer,
)
from trades.models import OfferGroup, WantGroup, TradeWish
from .admin_actions import kick_participant


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class EventPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------------------
# TradeEvent ViewSet  (lookup by slug)
# ---------------------------------------------------------------------------

class TradeEventViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    CRUD for TradeEvent. Lookup by slug.

    Extra actions:
        transition   — POST /{slug}/transition/ (organizer-only)
        participants — GET /{slug}/participants/
        join         — POST /{slug}/join/
        leave        — DELETE /{slug}/leave/
        listings     — GET/POST /{slug}/listings/
        listing_detail — PATCH/DELETE /{slug}/listings/{id}/
    """

    serializer_class = TradeEventSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = EventPagination
    lookup_field = "slug"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = TradeEvent.objects.select_related("organizer").all()
        params = self.request.query_params

        # ?status=
        status_filter = params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        # ?organizer= (by user id or username)
        organizer = params.get("organizer")
        if organizer:
            # Accept either integer pk or username string
            if organizer.isdigit():
                qs = qs.filter(organizer_id=int(organizer))
            else:
                qs = qs.filter(organizer__username=organizer)

        # ?search= (name icontains)
        search = params.get("search")
        if search:
            qs = qs.filter(name__icontains=search)

        return qs

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)

    def _check_organizer(self, event):
        if event.organizer != self.request.user:
            raise PermissionDenied("Only the organizer can perform this action.")

    def _check_admin(self, event):
        """Organizer-only admin guard; disabled once the event is archived."""
        self._check_organizer(event)
        if event.status == TradeEvent.Status.ARCHIVED:
            raise PermissionDenied("Event is archived; admin actions are disabled.")

    def _resolve_target_user(self, username):
        if not username:
            raise ValidationError({"username": "This field is required."})
        return get_object_or_404(get_user_model(), username=username)

    @staticmethod
    def _positive_int(value, field):
        try:
            n = int(value)
        except (TypeError, ValueError):
            raise ValidationError({field: "Must be an integer."})
        if n < 1:
            raise ValidationError({field: "Must be at least 1."})
        return n

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True  # PATCH only; PUT not supported
        event = self.get_object()
        self._check_organizer(event)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        event = self.get_object()
        self._check_organizer(event)
        return super().destroy(request, *args, **kwargs)

    # ------------------------------------------------------------------
    # POST /{slug}/transition/
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, slug=None):
        event = self.get_object()
        self._check_organizer(event)

        ser = TransitionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        target = ser.validated_data["to"]

        if not event.can_transition_to(target):
            raise ValidationError(
                {
                    "to": (
                        f"Invalid transition: {event.status} → {target}. "
                        f"Allowed: {event.allowed_transitions_list}"
                    )
                }
            )

        event.status = target
        event.save(update_fields=["status", "updated"])

        if target == TradeEvent.Status.ARCHIVED:
            from matching.services import apply_carryover
            try:
                apply_carryover(event)
            except Exception:  # never block archiving on a carryover hiccup (idempotent retry-safe)
                logger.exception("carryover failed for event %s", event.slug)

        from notifications.models import Notification
        Notification.objects.bulk_create([
            Notification(user_id=p.user_id, event=event, kind="EVENT_STATUS",
                         message=f"{event.name} moved to {event.get_status_display()}.")
            for p in event.participations.all()
        ])

        out = TradeEventSerializer(event, context={"request": request})
        return Response(out.data)

    # ------------------------------------------------------------------
    # GET /{slug}/participants/
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="participants")
    def participants(self, request, slug=None):
        event = self.get_object()
        participations = event.participations.select_related("user").all()
        page = self.paginate_queryset(participations)
        if page is not None:
            ser = EventParticipationSerializer(page, many=True)
            return self.get_paginated_response(ser.data)
        ser = EventParticipationSerializer(participations, many=True)
        return Response(ser.data)

    # ------------------------------------------------------------------
    # POST /{slug}/join/
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="join")
    def join(self, request, slug=None):
        event = self.get_object()
        self._enforce_location_gate(event, request.user)
        self._enforce_single_event(event, request.user)
        participation, created = EventParticipation.objects.get_or_create(
            event=event,
            user=request.user,
            defaults={
                "region": request.data.get("region", ""),
                "shipping_pref": request.data.get("shipping_pref", ""),
            },
        )
        # Money budget: settable here so participants can set/update it without a
        # separate endpoint. Ignored unless the organizer enabled money.
        if event.money_enabled and "max_spend" in request.data:
            participation.max_spend = self._clean_max_spend(
                request.data.get("max_spend"), event
            )
            participation.save(update_fields=["max_spend"])

        ser = EventParticipationSerializer(participation)
        return Response(
            ser.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @staticmethod
    def _enforce_single_event(event, user):
        clash = (
            EventParticipation.objects
            .filter(user=user)
            .exclude(event=event)
            .exclude(event__status=TradeEvent.Status.ARCHIVED)
            .select_related("event")
            .first()
        )
        if clash:
            raise ValidationError({"detail":
                f"You're already participating in \"{clash.event.name}\". "
                f"Leave it before joining another event."})

    @staticmethod
    def _enforce_location_gate(event, user):
        from accounts.geo import haversine_km
        if not event.require_location:
            return
        profile = getattr(user, "profile", None)
        lat = getattr(profile, "latitude", None)
        lng = getattr(profile, "longitude", None)
        if lat is None or lng is None:
            raise ValidationError({"location": "Set your location on your profile to join this event."})
        if (event.center_latitude is not None and event.center_longitude is not None
                and event.max_distance_km is not None):
            dist = haversine_km(lat, lng, event.center_latitude, event.center_longitude)
            if dist > event.max_distance_km:
                raise ValidationError(
                    {"location": f"You are {dist:.0f} km from the event area (limit {event.max_distance_km} km)."}
                )

    @staticmethod
    def _clean_max_spend(value, event):
        from decimal import Decimal, InvalidOperation
        try:
            amount = Decimal(str(value))
        except (InvalidOperation, TypeError):
            raise ValidationError({"max_spend": "Must be a number."})
        if amount < 0:
            raise ValidationError({"max_spend": "Cannot be negative."})
        cap = event.max_money_per_user
        if cap is not None and amount > cap:
            raise ValidationError(
                {"max_spend": f"Cannot exceed the event cap of {cap}."}
            )
        return amount

    # ------------------------------------------------------------------
    # DELETE /{slug}/leave/
    # ------------------------------------------------------------------

    @action(detail=True, methods=["delete"], url_path="leave")
    def leave(self, request, slug=None):
        event = self.get_object()
        if not EventParticipation.objects.filter(
            event=event, user=request.user
        ).exists():
            raise ValidationError(
                {"detail": "You are not a participant in this event."}
            )
        if event.inputs_locked:
            raise ValidationError(
                {"detail": "You can't leave once matching has started."}
            )
        summary = kick_participant(event, request.user)
        return Response(summary, status=status.HTTP_200_OK)

    # ------------------------------------------------------------------
    # GET/POST /{slug}/listings/
    # DELETE   /{slug}/listings/{id}/
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get", "post"], url_path="listings")
    def listings(self, request, slug=None):
        event = self.get_object()

        if request.method == "GET":
            return self._listings_list(request, event)
        else:
            return self._listings_create(request, event)

    def _listings_list(self, request, event):
        qs = event.listings.select_related(
            "copy", "copy__owner", "copy__board_game"
        ).all()

        # ?user= (filter by copy owner id or username)
        user_filter = request.query_params.get("user")
        if user_filter:
            if str(user_filter).isdigit():
                qs = qs.filter(copy__owner_id=int(user_filter))
            else:
                qs = qs.filter(copy__owner__username=user_filter)

        # ?board_game= (filter by bgg_id)
        bg_filter = request.query_params.get("board_game")
        if bg_filter:
            qs = qs.filter(copy__board_game_id=bg_filter)

        page = self.paginate_queryset(qs)
        if page is not None:
            ser = EventListingSerializer(
                page, many=True, context={"request": request}
            )
            return self.get_paginated_response(ser.data)
        ser = EventListingSerializer(
            qs, many=True, context={"request": request}
        )
        return Response(ser.data)

    def _listings_create(self, request, event):
        if event.inputs_locked:
            raise PermissionDenied("Listings are locked — this event has moved to matching.")

        copy_id = request.data.get("copy")
        if not copy_id:
            raise ValidationError({"copy": "This field is required."})

        # Import here to avoid circular import issues at module level
        from copies.models import Copy

        try:
            copy = Copy.objects.get(pk=copy_id)
        except Copy.DoesNotExist:
            raise ValidationError({"copy": "Copy not found."})

        if copy.owner != request.user:
            raise PermissionDenied("You can only add your own copies to an event.")

        if copy.status != Copy.Status.ACTIVE:
            raise ValidationError(
                {"copy": "This copy is not active (it may have been traded in a "
                         "previous event) and can't be listed."}
            )

        if copy.is_pending:
            raise ValidationError(
                {"copy": "This copy is incomplete (missing language and/or condition). "
                         "Complete its details before adding it to an event."}
            )

        # Reject duplicate
        if EventListing.objects.filter(event=event, copy=copy).exists():
            raise ValidationError(
                {"copy": "This copy is already listed in this event."}
            )

        listing = EventListing.objects.create(event=event, copy=copy)
        ser = EventListingSerializer(listing, context={"request": request})
        return Response(ser.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"listings/(?P<listing_id>[^/.]+)",
    )
    def listing_detail(self, request, slug=None, listing_id=None):
        event = self.get_object()
        listing = get_object_or_404(EventListing, pk=listing_id, event=event)

        if listing.copy.owner != request.user:
            raise PermissionDenied("Only the copy owner can modify this listing.")

        if request.method == "DELETE":
            if event.inputs_locked:
                raise PermissionDenied("Listings are locked — this event has moved to matching.")
            listing.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH — only sell_price is editable via this route (never copy/active)
        data = {"sell_price": request.data.get("sell_price")} if "sell_price" in request.data else {}
        ser = EventListingSerializer(
            listing, data=data, partial=True, context={"request": request}
        )
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    @action(detail=True, methods=["get"], url_path="games")
    def games(self, request, slug=None):
        """Event-scoped catalog: canonical games that have active copies here.

        GET /api/events/{slug}/games/?search=&ordering=
        Powers the want-list builder's browse/search (global catalog browsing is
        not useful — only games with copies in this event are tradeable).
        Ordering: `copies_count` (default desc), `name`, `rank`.
        """
        from django.db.models import Count, Q
        from catalog.models import BoardGame

        # Resolve the event directly: self.get_object() would apply the list
        # filter_backends (incl. ?search= over event names), 404-ing the event.
        event = get_object_or_404(TradeEvent, slug=slug)
        listed = Q(copies__event_listings__event=event, copies__event_listings__active=True)
        qs = (
            BoardGame.objects
            .filter(listed)
            .annotate(copies_count=Count("copies__event_listings", filter=listed, distinct=True))
            .distinct()
        )

        search = request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search)

        if request.query_params.get("wishlisted") in ("true", "1"):
            from accounts.models import Wishlist
            ids = Wishlist.objects.filter(user=request.user).values_list("board_game_bgg_id", flat=True)
            qs = qs.filter(bgg_id__in=list(ids))

        min_rating = request.query_params.get("min_rating")
        if min_rating:
            qs = qs.filter(average__gte=float(min_rating))

        is_expansion = request.query_params.get("is_expansion")
        if is_expansion in ("true", "false"):
            qs = qs.filter(is_expansion=(is_expansion == "true"))

        ordering = request.query_params.get("ordering", "-copies_count")
        order_map = {
            "name": ["name"],
            "rank": ["rank", "name"],
            "-average": ["-average", "name"],
            "-copies_count": ["-copies_count", "name"],
            "copies_count": ["copies_count", "name"],
        }
        qs = qs.order_by(*order_map.get(ordering, ["-copies_count", "name"]))

        page = self.paginate_queryset(qs)
        if page is not None:
            ser = EventGameSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(ser.data)
        ser = EventGameSerializer(qs, many=True, context={"request": request})
        return Response(ser.data)

    # ------------------------------------------------------------------
    # Organizer admin dashboard
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="admin/submissions")
    def admin_submissions(self, request, slug=None):
        event = self.get_object()
        self._check_admin(event)
        user = self._resolve_target_user(request.query_params.get("user"))

        listings = event.listings.select_related(
            "copy", "copy__owner", "copy__board_game"
        ).filter(copy__owner=user)
        offer_groups = OfferGroup.objects.filter(event=event, user=user)
        want_groups = WantGroup.objects.filter(event=event, user=user)
        wishes = TradeWish.objects.filter(event=event, user=user).select_related(
            "offer_group", "want_group"
        )

        return Response({
            "username": user.username,
            "listings": EventListingSerializer(
                listings, many=True, context={"request": request}
            ).data,
            "offer_groups": [
                {"id": g.id, "name": g.name, "max_give": g.max_give} for g in offer_groups
            ],
            "want_groups": [
                {"id": g.id, "name": g.name, "min_receive": g.min_receive}
                for g in want_groups
            ],
            "wishes": [
                {
                    "id": w.id, "active": w.active,
                    "offer_group": w.offer_group_id, "offer_group_name": w.offer_group.name,
                    "want_group": w.want_group_id, "want_group_name": w.want_group.name,
                }
                for w in wishes
            ],
        })

    @action(detail=True, methods=["patch"], url_path=r"admin/wishes/(?P<wish_id>[^/.]+)")
    def admin_wish(self, request, slug=None, wish_id=None):
        event = self.get_object()
        self._check_admin(event)
        wish = get_object_or_404(TradeWish, pk=wish_id, event=event)
        # Coerce via BooleanField so non-JSON payloads (e.g. the string "false")
        # don't truthily flip to True; invalid values raise 400.
        wish.active = serializers.BooleanField().to_internal_value(
            request.data.get("active", wish.active)
        )
        wish.save(update_fields=["active", "updated"])
        return Response({"id": wish.id, "active": wish.active})

    @action(detail=True, methods=["patch"], url_path=r"admin/offer-groups/(?P<group_id>[^/.]+)")
    def admin_offer_group(self, request, slug=None, group_id=None):
        event = self.get_object()
        self._check_admin(event)
        group = get_object_or_404(OfferGroup, pk=group_id, event=event)
        group.max_give = self._positive_int(request.data.get("max_give"), "max_give")
        group.save(update_fields=["max_give", "updated"])
        return Response({"id": group.id, "max_give": group.max_give})

    @action(detail=True, methods=["patch"], url_path=r"admin/want-groups/(?P<group_id>[^/.]+)")
    def admin_want_group(self, request, slug=None, group_id=None):
        event = self.get_object()
        self._check_admin(event)
        group = get_object_or_404(WantGroup, pk=group_id, event=event)
        group.min_receive = self._positive_int(request.data.get("min_receive"), "min_receive")
        group.save(update_fields=["min_receive", "updated"])
        return Response({"id": group.id, "min_receive": group.min_receive})

    @action(detail=True, methods=["delete"], url_path=r"admin/listings/(?P<listing_id>[^/.]+)")
    def admin_listing(self, request, slug=None, listing_id=None):
        event = self.get_object()
        self._check_admin(event)
        listing = get_object_or_404(EventListing, pk=listing_id, event=event)
        listing.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="admin/kick")
    def admin_kick(self, request, slug=None):
        event = self.get_object()
        self._check_admin(event)
        user = self._resolve_target_user(request.data.get("username"))
        if user == request.user:
            raise ValidationError({"username": "You can't kick yourself."})
        summary = kick_participant(event, user)
        return Response(summary)

    ALLOWED_KPIS = ("trades", "users", "distance")

    def _parse_kpi(self, raw):
        """Comma-separated objectives in priority order. Validates tokens,
        rejects duplicates, defaults to ['trades']."""
        if not raw:
            return ["trades"]
        out = []
        for tok in raw.split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok not in self.ALLOWED_KPIS:
                raise ValidationError({"kpi": f"invalid objective '{tok}'"})
            if tok in out:
                raise ValidationError({"kpi": f"duplicate objective '{tok}'"})
            out.append(tok)
        return out or ["trades"]

    @action(detail=True, methods=["get"], url_path="wants-export")
    def wants_export(self, request, slug=None):
        """Organizer-only export of the active wishes as a solver wants file
        in `(NforM) give -> take` format for the local gurobi solver.
        """
        from django.http import HttpResponse
        from matching.external_solver import build_wants

        event = self.get_object()
        self._check_organizer(event)

        kpi = self._parse_kpi(request.query_params.get("kpi"))
        text = build_wants(event, include_locations=("distance" in kpi))
        resp = HttpResponse(text, content_type="text/plain; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{event.slug}-wants.txt"'
        return resp
