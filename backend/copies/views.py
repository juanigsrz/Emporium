"""
copies/views.py

Endpoints:
    GET  /api/copies/         — list (paginated). Filters: ?owner=<id>, ?board_game=<bgg_id>,
                                ?status=<STATUS>, ?mine=true
    POST /api/copies/         — create (owner = request.user, listing_code auto-generated)
    GET  /api/copies/{id}/    — retrieve
    PATCH /api/copies/{id}/   — update (owner only)
    DELETE /api/copies/{id}/  — delete (owner only)

Filter parameter docs:
    ?owner=<int>      — filter by owner user id (integer PK)
    ?board_game=<int> — filter by board_game bgg_id (integer)
    ?status=<str>     — filter by status (ACTIVE, RESERVED, TRADED, WITHDRAWN)
    ?mine=true        — shortcut: filter to request.user's copies (overrides ?owner=)

Permissions:
    - List/Retrieve: IsAuthenticated (match accounts pattern — authenticated reads)
    - Create: IsAuthenticated
    - Update/Destroy: IsAuthenticated + owner check (403 for non-owners)
"""

from rest_framework import mixins, permissions, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .models import Copy
from .serializers import CopySerializer


class CopyPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 100


class CopyViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    ViewSet for Copy CRUD.

    list/retrieve: any authenticated user.
    create: authenticated user; owner set server-side.
    update/partial_update/destroy: owner only.
    """

    serializer_class = CopySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = CopyPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = Copy.objects.select_related("owner", "board_game").all()
        params = self.request.query_params

        # ?mine=true — current user's copies (takes precedence over ?owner=)
        mine = params.get("mine", "").lower()
        if mine in ("1", "true", "yes"):
            qs = qs.filter(owner=self.request.user)
            return qs

        # ?owner=<int> — filter by owner user id
        owner_id = params.get("owner")
        if owner_id is not None:
            qs = qs.filter(owner_id=owner_id)

        # ?board_game=<bgg_id>
        board_game = params.get("board_game")
        if board_game is not None:
            qs = qs.filter(board_game_id=board_game)

        # ?status=<STATUS>
        status_filter = params.get("status")
        if status_filter is not None:
            qs = qs.filter(status=status_filter)

        return qs

    def perform_create(self, serializer):
        """Set owner to the authenticated user; listing_code is auto-generated in model.save()."""
        serializer.save(owner=self.request.user)

    def _check_owner(self, instance):
        """Raise 403 if the requester is not the copy owner."""
        if instance.owner != self.request.user:
            raise PermissionDenied("You do not have permission to modify this copy.")

    def update(self, request, *args, **kwargs):
        """PATCH only; PUT not supported."""
        kwargs["partial"] = True
        instance = self.get_object()
        self._check_owner(instance)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self._check_owner(instance)
        return super().destroy(request, *args, **kwargs)
