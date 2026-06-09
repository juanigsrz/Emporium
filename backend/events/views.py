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
    DELETE        /api/events/{slug}/listings/{id}/

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

from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, status, viewsets
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
        listing_detail — DELETE /{slug}/listings/{id}/
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
        deleted, _ = EventParticipation.objects.filter(
            event=event, user=request.user
        ).delete()
        if not deleted:
            raise ValidationError({"detail": "You are not a participant in this event."})
        return Response(status=status.HTTP_204_NO_CONTENT)

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
        methods=["delete"],
        url_path=r"listings/(?P<listing_id>[^/.]+)",
    )
    def listing_detail(self, request, slug=None, listing_id=None):
        event = self.get_object()
        listing = get_object_or_404(EventListing, pk=listing_id, event=event)

        if listing.copy.owner != request.user:
            raise PermissionDenied("Only the copy owner can remove this listing.")

        listing.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

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

    @action(detail=True, methods=["get"], url_path="wants-export")
    def wants_export(self, request, slug=None):
        """Organizer-only export of the active wishes as a solver wants file.

        Format follows the event's matching_mode (ONETOONE -> OLWLG for the
        hosted ftm solver; XTOY -> `(NforM) give -> take` for the local solver).
        """
        from django.http import HttpResponse
        from matching.external_solver import build_wants

        event = self.get_object()
        self._check_organizer(event)

        text = build_wants(event)
        resp = HttpResponse(text, content_type="text/plain; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{event.slug}-wants.txt"'
        return resp
