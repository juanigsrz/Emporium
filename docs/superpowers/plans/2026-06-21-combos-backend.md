# Combos — Backend Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for combos — a `Combo` bundle of ≥2 of a user's own `EventListing`s, tradeable as one unit (barter or cash), offerable/wantable/biddable, exported to the solver with `givecap` so a physical member never leaves twice, and loaded back as a single combo `TradeAssignment`.

**Architecture:** New `Combo`/`ComboItem` models in the `events` app with their own `combo_code` solver token. `OfferGroupItem`/`WantGroupItem`/`WantBid`/`TradeAssignment` each gain a nullable `combo` FK (exactly one of `{event_listing, combo}`). The exporter emits combo `item`/`ask`/`bid`/give/take lines plus `givecap <owner> 1 <member> <combo>` per member; the loader resolves a `combo_code` move to one combo assignment.

**Tech Stack:** Django 5, DRF, SQLite/Postgres. Tests: `manage.py test`.

**Spec:** `docs/superpowers/specs/2026-06-21-combos-design.md`

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd: `backend/`. Interpreter: `./.venv/bin/python`. Test command: `./.venv/bin/python manage.py test <dotted.path> -v 2` (run from `backend/`).

**Frontend is a separate plan** (`combos-frontend`), written after this lands.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/combos-backend
```

Expected: `Switched to a new branch 'feat/combos-backend'`

---

### Task 1: `Combo` + `ComboItem` models

**Files:**
- Modify: `backend/events/models.py`
- Create: `backend/events/test_combos.py`
- Migration: `backend/events/migrations/` (generated)

- [ ] **Step 1: Write the failing test**

Create `backend/events/test_combos.py`:

```python
"""Combo model + API tests."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent

User = get_user_model()


class ComboModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("cu", "cu@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=1001, name="Wingspan")
        cls.bg2 = BoardGame.objects.create(bgg_id=1002, name="Wingspan: Europe")
        cls.event = TradeEvent.objects.create(name="Combo Ev", organizer=cls.u)
        cls.copy1 = Copy.objects.create(owner=cls.u, board_game=cls.bg1)
        cls.copy2 = Copy.objects.create(owner=cls.u, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.copy1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.copy2)

    def test_combo_code_generated_with_k_prefix(self):
        c = Combo.objects.create(event=self.event, owner=self.u, name="WS bundle")
        self.assertTrue(c.combo_code.startswith("K-"))
        self.assertEqual(len(c.combo_code), 8)

    def test_combo_holds_members(self):
        c = Combo.objects.create(event=self.event, owner=self.u, name="WS bundle",
                                 sell_price=Decimal("40.00"))
        ComboItem.objects.create(combo=c, event_listing=self.el1)
        ComboItem.objects.create(combo=c, event_listing=self.el2)
        self.assertEqual(c.items.count(), 2)
        self.assertEqual(c.sell_price, Decimal("40.00"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_combos -v 2`
Expected: FAIL — `ImportError: cannot import name 'Combo' from 'events.models'`.

- [ ] **Step 3: Add the models**

In `backend/events/models.py`, update the top imports block:

```python
from django.conf import settings
from django.db import models
from django.utils.text import slugify
```

to:

```python
import base64
import os

from django.conf import settings
from django.db import IntegrityError, models
from django.utils.text import slugify
```

Append at the end of `backend/events/models.py`:

```python
# ---------------------------------------------------------------------------
# Combo — a bundle of >=2 of a user's own EventListings, traded as one unit
# ---------------------------------------------------------------------------

COMBO_CODE_RETRIES = 10


def _generate_combo_code():
    """"K-XXXXXX": 6 random uppercase base32 chars. Mirrors Copy.listing_code
    but with a "K-" prefix so combo tokens never collide with copies' "C-"."""
    raw = os.urandom(4)
    encoded = base64.b32encode(raw).decode("ascii")
    chars = encoded.rstrip("=")[:6]
    return f"K-{chars}"


class Combo(models.Model):
    """A user-defined bundle of their own EventListings in one event."""

    event = models.ForeignKey(
        TradeEvent, on_delete=models.CASCADE, related_name="combos"
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="combos"
    )
    name = models.CharField(max_length=120)
    combo_code = models.CharField(max_length=12, unique=True, db_index=True)
    active = models.BooleanField(default=True)
    # Bundle cash ask; null => barter-only (no per-game fallback — a combo has
    # no single game).
    sell_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def save(self, *args, **kwargs):
        if not self.combo_code:
            for _ in range(COMBO_CODE_RETRIES):
                code = _generate_combo_code()
                if not Combo.objects.filter(combo_code=code).exists():
                    self.combo_code = code
                    break
            else:
                raise IntegrityError(
                    "Could not generate a unique combo_code after "
                    f"{COMBO_CODE_RETRIES} attempts."
                )
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Combo({self.combo_code}, {self.name!r}, event={self.event.slug})"


class ComboItem(models.Model):
    """One EventListing member of a Combo."""

    combo = models.ForeignKey(
        Combo, on_delete=models.CASCADE, related_name="items"
    )
    event_listing = models.ForeignKey(
        EventListing, on_delete=models.CASCADE, related_name="combo_memberships"
    )

    class Meta:
        unique_together = [("combo", "event_listing")]
        ordering = ["id"]

    def __str__(self):
        return f"ComboItem(combo={self.combo_id}, listing={self.event_listing_id})"
```

- [ ] **Step 4: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations events`
Expected: a new migration creating `Combo` and `ComboItem`.

- [ ] **Step 5: Run the test — verify it passes**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_combos -v 2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/events/models.py backend/events/test_combos.py backend/events/migrations/
git commit -m "feat(combos): Combo + ComboItem models with K- token"
```

---

### Task 2: Combo serializer, CRUD views, browse endpoint

**Files:**
- Modify: `backend/events/serializers.py`
- Create: `backend/events/combo_views.py`
- Modify: `backend/events/urls.py`
- Modify: `backend/events/test_combos.py`

- [ ] **Step 1: Write the failing API tests**

Append to `backend/events/test_combos.py`:

```python
from rest_framework import status
from rest_framework.test import APITestCase


class ComboAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("co", "co@t.test", "pass1234")
        cls.other = User.objects.create_user("cx", "cx@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=2001, name="Brass")
        cls.bg2 = BoardGame.objects.create(bgg_id=2002, name="Brass Exp")
        cls.event = TradeEvent.objects.create(name="API Ev", organizer=cls.owner)
        cls.copy1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.copy2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.copy_other = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.copy1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.copy2)
        cls.el_other = EventListing.objects.create(event=cls.event, copy=cls.copy_other)

    def _url(self):
        return f"/api/events/{self.event.slug}/combos/"

    def test_create_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "Brass bundle", "sell_price": "40.00",
            "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["combo_code"].startswith("K-"))
        self.assertEqual(len(resp.data["items"]), 2)

    def test_reject_fewer_than_two(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_non_owned_member(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id, self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_member_already_in_another_combo(self):
        self.client.force_authenticate(self.owner)
        first = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        copy3 = Copy.objects.create(owner=self.owner, board_game=self.bg1)
        el3 = EventListing.objects.create(event=self.event, copy=copy3)
        resp = self.client.post(self._url(), {
            "name": "b", "item_listing_ids": [self.el1.id, el3.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_blocked_when_inputs_locked(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_browse_lists_all_active_combos(self):
        self.client.force_authenticate(self.owner)
        self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        # other user can see it in browse
        self.client.force_authenticate(self.other)
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 1)

    def test_browse_filter_by_board_game(self):
        self.client.force_authenticate(self.owner)
        self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        resp = self.client.get(self._url() + f"?board_game={self.bg1.bgg_id}")
        self.assertEqual(resp.data["count"], 1)
        resp2 = self.client.get(self._url() + "?board_game=999999")
        self.assertEqual(resp2.data["count"], 0)

    def test_only_owner_can_delete(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json").data
        self.client.force_authenticate(self.other)
        resp = self.client.delete(f"{self._url()}{created['id']}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_combos.ComboAPITests -v 2`
Expected: FAIL — 404s (no `/combos/` route yet).

- [ ] **Step 3: Add combo serializers**

In `backend/events/serializers.py`, change the import line:

```python
from .models import EventListing, EventParticipation, TradeEvent
```

to:

```python
from django.db import transaction

from .models import Combo, ComboItem, EventListing, EventParticipation, TradeEvent
```

Append to `backend/events/serializers.py`:

```python
class ComboItemSerializer(serializers.ModelSerializer):
    """Read-only member of a combo, with the member listing's game identity."""

    event_listing = serializers.IntegerField(source="event_listing_id", read_only=True)
    listing_code = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
    board_game_id = serializers.IntegerField(
        source="event_listing.copy.board_game_id", read_only=True
    )
    board_game_name = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = ComboItem
        fields = [
            "id", "event_listing", "listing_code",
            "board_game_id", "board_game_name", "board_game_thumbnail",
        ]
        read_only_fields = fields

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")


class ComboSerializer(serializers.ModelSerializer):
    """Read: combo + members. Write: name, sell_price, item_listing_ids."""

    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_username = serializers.SerializerMethodField()
    items = ComboItemSerializer(many=True, read_only=True)
    item_listing_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False, default=list,
    )

    class Meta:
        model = Combo
        fields = [
            "id", "event", "owner", "owner_username", "name", "combo_code",
            "active", "sell_price", "items", "item_listing_ids",
            "created", "updated",
        ]
        read_only_fields = [
            "id", "event", "owner", "owner_username", "combo_code",
            "items", "created", "updated",
        ]

    def get_owner_username(self, obj):
        return obj.owner.username

    def validate_sell_price(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("sell_price must be greater than 0.")
        return value

    def _resolve_members(self, listing_ids, event, owner, instance=None):
        if len(set(listing_ids)) < 2:
            raise serializers.ValidationError(
                {"item_listing_ids": "A combo needs at least 2 listings."}
            )
        listings = list(
            EventListing.objects.select_related("copy")
            .filter(id__in=listing_ids, event=event)
        )
        found = {el.id for el in listings}
        missing = set(listing_ids) - found
        if missing:
            raise serializers.ValidationError(
                {"item_listing_ids": f"Listings not found in this event: {sorted(missing)}"}
            )
        not_owned = [el.id for el in listings if el.copy.owner_id != owner.id]
        if not_owned:
            raise serializers.ValidationError(
                {"item_listing_ids": f"Listings not owned by you: {not_owned}"}
            )
        clash = ComboItem.objects.filter(
            combo__event=event, combo__owner=owner, event_listing_id__in=found
        )
        if instance is not None:
            clash = clash.exclude(combo=instance)
        clash_ids = sorted({ci.event_listing_id for ci in clash})
        if clash_ids:
            raise serializers.ValidationError(
                {"item_listing_ids": f"Listings already in another combo: {clash_ids}"}
            )
        return listings

    @transaction.atomic
    def create(self, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", [])
        event = validated_data["event"]
        owner = validated_data["owner"]
        listings = self._resolve_members(listing_ids, event, owner)
        combo = Combo.objects.create(**validated_data)
        for el in listings:
            ComboItem.objects.create(combo=combo, event_listing=el)
        return combo

    @transaction.atomic
    def update(self, instance, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if listing_ids is not None:
            listings = self._resolve_members(
                listing_ids, instance.event, instance.owner, instance=instance
            )
            instance.items.all().delete()
            for el in listings:
                ComboItem.objects.create(combo=instance, event_listing=el)
        return instance
```

- [ ] **Step 4: Add combo views**

Create `backend/events/combo_views.py`:

```python
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
        if event.inputs_locked:
            raise PermissionDenied("Combos are locked — this event has moved to matching.")

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
```

- [ ] **Step 5: Wire the routes**

In `backend/events/urls.py`, change:

```python
from .views import TradeEventViewSet

router = DefaultRouter()
router.register(r"events", TradeEventViewSet, basename="event")

urlpatterns = [
    path("", include(router.urls)),
]
```

to:

```python
from .combo_views import ComboDetailView, ComboListCreateView
from .views import TradeEventViewSet

router = DefaultRouter()
router.register(r"events", TradeEventViewSet, basename="event")

urlpatterns = [
    path("events/<slug:slug>/combos/", ComboListCreateView.as_view(), name="combo-list"),
    path("events/<slug:slug>/combos/<int:pk>/", ComboDetailView.as_view(), name="combo-detail"),
    path("", include(router.urls)),
]
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_combos -v 2`
Expected: PASS (all ComboModelTests + ComboAPITests).

- [ ] **Step 7: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/events/serializers.py backend/events/combo_views.py backend/events/urls.py backend/events/test_combos.py
git commit -m "feat(combos): combo serializer, CRUD + browse endpoints"
```

---

### Task 3: Combo targeting on offer/want/bid (models + migration)

**Files:**
- Modify: `backend/trades/models.py`
- Migration: `backend/trades/migrations/` (generated)

- [ ] **Step 1: Add the imports and FK + constraints**

In `backend/trades/models.py`, the import block is:

```python
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
```

Change it to:

```python
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
```

In `OfferGroupItem`, the current fields + Meta are:

```python
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="offer_memberships",
    )

    class Meta:
        unique_together = [("offer_group", "event_listing")]
        ordering = ["id"]
```

Replace with:

```python
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="offer_memberships",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="offer_memberships",
        null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="offeritem_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["offer_group", "event_listing"],
                condition=Q(event_listing__isnull=False),
                name="uniq_offeritem_group_listing",
            ),
            models.UniqueConstraint(
                fields=["offer_group", "combo"],
                condition=Q(combo__isnull=False),
                name="uniq_offeritem_group_combo",
            ),
        ]
```

Also update `OfferGroupItem.clean` (currently asserts the listing's copy owner). Replace the method body:

```python
    def clean(self):
        """Validate that the listing's copy is owned by the offer group's user."""
        if self.event_listing.copy.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The event listing does not belong to the offer group's user."
            )
```

with:

```python
    def clean(self):
        """Validate the target (listing or combo) belongs to the group's user."""
        if self.event_listing_id and \
                self.event_listing.copy.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The event listing does not belong to the offer group's user."
            )
        if self.combo_id and self.combo.owner_id != self.offer_group.user_id:
            raise ValidationError(
                "The combo does not belong to the offer group's user."
            )
```

In `WantGroupItem`, the current fields + Meta are:

```python
    want_group    = models.ForeignKey(
        WantGroup,
        on_delete=models.CASCADE,
        related_name="items",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="want_memberships",
    )

    class Meta:
        ordering = ["id"]
```

Replace with:

```python
    want_group    = models.ForeignKey(
        WantGroup,
        on_delete=models.CASCADE,
        related_name="items",
    )
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="want_memberships",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="want_memberships",
        null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="wantitem_exactly_one_target",
            ),
        ]
```

In `WantBid`, the current fields + Meta are:

```python
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        related_name="want_bids",
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                name="uniq_wantbid_user_event_listing",
            ),
        ]
        ordering = ["id"]
```

Replace with:

```python
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        related_name="want_bids",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo", on_delete=models.CASCADE,
        related_name="want_bids",
        null=True, blank=True,
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="wantbid_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                condition=Q(event_listing__isnull=False),
                name="uniq_wantbid_user_event_listing",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "combo"],
                condition=Q(combo__isnull=False),
                name="uniq_wantbid_user_event_combo",
            ),
        ]
        ordering = ["id"]
```

Update `WantBid.clean`:

```python
    def clean(self):
        """Validate the listing belongs to the same event as this bid."""
        if self.event_listing.event_id != self.event_id:
            raise ValidationError("event_listing must belong to the same event as this bid.")
```

to:

```python
    def clean(self):
        """Validate the target belongs to the same event as this bid."""
        if self.event_listing_id and self.event_listing.event_id != self.event_id:
            raise ValidationError("event_listing must belong to the same event as this bid.")
        if self.combo_id and self.combo.event_id != self.event_id:
            raise ValidationError("combo must belong to the same event as this bid.")
```

- [ ] **Step 2: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations trades`
Expected: a migration altering `OfferGroupItem`, `WantGroupItem`, `WantBid` (nullable `event_listing`, new `combo`, new constraints).

- [ ] **Step 3: Verify migrations apply (regression check)**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.tests events.test_event_cycle_qa -v 1`
Expected: PASS — existing offer/want/wish/export tests still green with the new nullable schema (all existing rows set `event_listing`, `combo` null → check passes).

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/models.py backend/trades/migrations/
git commit -m "feat(combos): combo FK + exactly-one-target constraints on offer/want/bid"
```

---

### Task 4: Combo targeting in serializers

**Files:**
- Modify: `backend/trades/serializers.py`
- Create: `backend/trades/test_combos.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/trades/test_combos.py`:

```python
"""Combo targeting through offer/want/bid serializers (via API)."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent

User = get_user_model()


class ComboTargetingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("to", "to@t.test", "pass1234")
        cls.wisher = User.objects.create_user("tw", "tw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=3001, name="Gaia")
        cls.bg2 = BoardGame.objects.create(bgg_id=3002, name="Gaia Exp")
        cls.event = TradeEvent.objects.create(
            name="T Ev", organizer=cls.owner, status="WANTLIST_OPEN", money_enabled=True
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="GA bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def _u(self, suffix):
        return f"/api/events/{self.event.slug}/{suffix}"

    def test_want_group_targets_combo(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "want the bundle", "min_receive": 1,
            "items": [{"combo": self.combo.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        item = resp.data["items"][0]
        self.assertEqual(item["combo"], self.combo.id)
        self.assertEqual(item["combo_code"], self.combo.combo_code)

    def test_want_item_rejects_both_targets(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "bad", "min_receive": 1,
            "items": [{"combo": self.combo.id, "event_listing": self.el1.id}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_want_item_rejects_neither_target(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.post(self._u("want-groups/"), {
            "name": "bad", "min_receive": 1, "items": [{}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_offer_group_targets_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._u("offer-groups/"), {
            "name": "offer the bundle", "max_give": 1,
            "item_combo_ids": [self.combo.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["items"][0]["combo"], self.combo.id)

    def test_want_bid_on_combo(self):
        self.client.force_authenticate(self.wisher)
        resp = self.client.put(self._u("want-bids/"), {
            "combo": self.combo.id, "amount": "35.00",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["combo"], self.combo.id)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos -v 2`
Expected: FAIL — serializers don't accept `combo`/`item_combo_ids` yet.

- [ ] **Step 3: WantGroupItem serializer — accept/expose combo + exactly-one**

In `backend/trades/serializers.py`, the `WantGroupItemSerializer` declares its writable FK as:

```python
    # Writable FK reference
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.select_related("copy", "copy__board_game").all(),
    )
```

Replace with:

```python
    # Writable FK references — exactly one of {event_listing, combo}
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.select_related("copy", "copy__board_game").all(),
        required=False, allow_null=True,
    )
    combo = serializers.PrimaryKeyRelatedField(
        queryset=Combo.objects.all(), required=False, allow_null=True,
    )
    combo_code = serializers.CharField(source="combo.combo_code", read_only=True)
    combo_name = serializers.CharField(source="combo.name", read_only=True)
```

Add the `Combo` import at the top of `serializers.py`:

```python
from events.models import EventListing
```

becomes

```python
from events.models import Combo, EventListing
```

Extend the `WantGroupItemSerializer.Meta.fields` and `read_only_fields` to include the combo fields. Change:

```python
        fields = [
            "id",
            "board_game_name",
            "board_game_id",        # canonical bgg_id (FE grouping)
            "board_game_thumbnail",
            "event_listing",        # EventListing pk int
            "listing_code",
            "resolved_bid",
            "bid_is_override",
        ]
        read_only_fields = ["id", "board_game_name", "board_game_id", "board_game_thumbnail",
                            "listing_code", "resolved_bid", "bid_is_override"]
```

to:

```python
        fields = [
            "id",
            "board_game_name",
            "board_game_id",        # canonical bgg_id (FE grouping)
            "board_game_thumbnail",
            "event_listing",        # EventListing pk int
            "listing_code",
            "combo",                # Combo pk int
            "combo_code",
            "combo_name",
            "resolved_bid",
            "bid_is_override",
        ]
        read_only_fields = ["id", "board_game_name", "board_game_id", "board_game_thumbnail",
                            "listing_code", "combo_code", "combo_name",
                            "resolved_bid", "bid_is_override"]
```

Add a `validate` method to `WantGroupItemSerializer` (after `get_bid_is_override`):

```python
    def validate(self, data):
        el = data.get("event_listing")
        combo = data.get("combo")
        if bool(el) == bool(combo):
            raise serializers.ValidationError(
                "Provide exactly one of 'event_listing' or 'combo'."
            )
        return data
```

The display companions (`board_game_name`, etc.) read `event_listing.copy...`; guard them for combo rows. Replace:

```python
    board_game_name      = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_id        = serializers.IntegerField(
        source="event_listing.copy.board_game_id", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()
    listing_code         = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
```

with `SerializerMethodField`s that tolerate a null listing:

```python
    board_game_name      = serializers.SerializerMethodField()
    board_game_id        = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()
    listing_code         = serializers.SerializerMethodField()
```

and add the methods (after `get_board_game_thumbnail`, replacing the old thumbnail method body to also guard null):

```python
    def get_board_game_name(self, obj):
        if obj.event_listing_id:
            return obj.event_listing.copy.board_game.name
        return None

    def get_board_game_id(self, obj):
        if obj.event_listing_id:
            return obj.event_listing.copy.board_game_id
        return None

    def get_board_game_thumbnail(self, obj):
        if obj.event_listing_id:
            return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
        return ""

    def get_listing_code(self, obj):
        if obj.event_listing_id:
            return obj.event_listing.copy.listing_code
        return None
```

Guard the two bid methods for combo rows. Replace `get_resolved_bid` and `get_bid_is_override` bodies:

```python
    def get_resolved_bid(self, obj):
        from trades.pricing import resolve_bid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return None
        v = resolve_bid(obj.want_group.user, event, obj)
        return f"{v:.2f}" if v is not None else None

    def get_bid_is_override(self, obj):
        from trades.models import WantBid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return False
        return WantBid.objects.filter(
            user=obj.want_group.user, event=event,
            event_listing_id=obj.event_listing_id,
        ).exists()
```

with:

```python
    def get_resolved_bid(self, obj):
        from trades.pricing import resolve_bid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return None
        v = resolve_bid(obj.want_group.user, event, obj)
        return f"{v:.2f}" if v is not None else None

    def get_bid_is_override(self, obj):
        from trades.models import WantBid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return False
        if obj.combo_id:
            return WantBid.objects.filter(
                user=obj.want_group.user, event=event, combo_id=obj.combo_id,
            ).exists()
        return WantBid.objects.filter(
            user=obj.want_group.user, event=event,
            event_listing_id=obj.event_listing_id,
        ).exists()
```

- [ ] **Step 4: OfferGroup serializer — accept combo ids**

In `OfferGroupItemSerializer.Meta.fields`, add the combo companions. Change:

```python
        fields = [
            "id",
            "event_listing",   # id (int)
            "listing_code",
            "board_game_name",
            "board_game_id",
            "board_game_thumbnail",
        ]
        read_only_fields = fields
```

to:

```python
        fields = [
            "id",
            "event_listing",   # id (int) — null for combo items
            "listing_code",
            "board_game_name",
            "board_game_id",
            "board_game_thumbnail",
            "combo",
            "combo_code",
            "combo_name",
        ]
        read_only_fields = fields
```

And make the `OfferGroupItemSerializer` display fields tolerate null listing + expose combo. Replace its field declarations:

```python
    listing_code    = serializers.CharField(
        source="event_listing.copy.listing_code", read_only=True
    )
    board_game_name = serializers.CharField(
        source="event_listing.copy.board_game.name", read_only=True
    )
    board_game_id   = serializers.IntegerField(
        source="event_listing.copy.board_game.bgg_id", read_only=True
    )
    board_game_thumbnail = serializers.SerializerMethodField()

    def get_board_game_thumbnail(self, obj):
        return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
```

with:

```python
    listing_code    = serializers.SerializerMethodField()
    board_game_name = serializers.SerializerMethodField()
    board_game_id   = serializers.SerializerMethodField()
    board_game_thumbnail = serializers.SerializerMethodField()
    combo_code      = serializers.CharField(source="combo.combo_code", read_only=True)
    combo_name      = serializers.CharField(source="combo.name", read_only=True)

    def get_listing_code(self, obj):
        return obj.event_listing.copy.listing_code if obj.event_listing_id else None

    def get_board_game_name(self, obj):
        return obj.event_listing.copy.board_game.name if obj.event_listing_id else None

    def get_board_game_id(self, obj):
        return obj.event_listing.copy.board_game.bgg_id if obj.event_listing_id else None

    def get_board_game_thumbnail(self, obj):
        if obj.event_listing_id:
            return (obj.event_listing.copy.board_game.metadata or {}).get("thumbnail", "")
        return ""
```

Add a write-only `item_combo_ids` field to `OfferGroupSerializer` and handle it. In the field declarations, after `item_listing_ids`:

```python
    # Write-only: list of EventListing ids to add/replace items
    item_listing_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        default=list,
    )
```

add:

```python
    # Write-only: list of Combo ids to add/replace combo items
    item_combo_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        default=list,
    )
```

Add `item_combo_ids` to `OfferGroupSerializer.Meta.fields`. Change the fields list entry `"item_listing_ids",` to:

```python
            "item_listing_ids",
            "item_combo_ids",
```

Add a combo resolver to `OfferGroupSerializer` (after `_resolve_listings`):

```python
    def _resolve_combos(self, combo_ids, event, user):
        if not combo_ids:
            return []
        combos = list(Combo.objects.filter(id__in=combo_ids, event=event))
        found = {c.id for c in combos}
        missing = set(combo_ids) - found
        if missing:
            raise serializers.ValidationError(
                {"item_combo_ids": f"Combo ids not found in this event: {sorted(missing)}"}
            )
        not_owned = [c.id for c in combos if c.owner_id != user.id]
        if not_owned:
            raise serializers.ValidationError(
                {"item_combo_ids": f"Combos not owned by you: {not_owned}"}
            )
        return combos
```

Update `OfferGroupSerializer.create` to also create combo items. Replace:

```python
    @transaction.atomic
    def create(self, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", [])
        event = validated_data["event"]
        user  = validated_data["user"]

        listings = self._resolve_listings(listing_ids, event, user)
        group = OfferGroup.objects.create(**validated_data)

        for el in listings:
            OfferGroupItem.objects.create(offer_group=group, event_listing=el)

        return group
```

with:

```python
    @transaction.atomic
    def create(self, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", [])
        combo_ids = validated_data.pop("item_combo_ids", [])
        event = validated_data["event"]
        user  = validated_data["user"]

        listings = self._resolve_listings(listing_ids, event, user)
        combos = self._resolve_combos(combo_ids, event, user)
        group = OfferGroup.objects.create(**validated_data)

        for el in listings:
            OfferGroupItem.objects.create(offer_group=group, event_listing=el)
        for c in combos:
            OfferGroupItem.objects.create(offer_group=group, combo=c)

        return group
```

Update `OfferGroupSerializer.update` to replace combo items when provided. Replace:

```python
    @transaction.atomic
    def update(self, instance, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", None)
        event = instance.event
        user  = instance.user

        # Update scalar fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Replace item set only if item_listing_ids was provided
        if listing_ids is not None:
            listings = self._resolve_listings(listing_ids, event, user)
            instance.items.all().delete()
            for el in listings:
                OfferGroupItem.objects.create(offer_group=instance, event_listing=el)

        return instance
```

with:

```python
    @transaction.atomic
    def update(self, instance, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", None)
        combo_ids = validated_data.pop("item_combo_ids", None)
        event = instance.event
        user  = instance.user

        # Update scalar fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Replace the whole item set if either target list was provided.
        if listing_ids is not None or combo_ids is not None:
            listings = self._resolve_listings(listing_ids or [], event, user)
            combos = self._resolve_combos(combo_ids or [], event, user)
            instance.items.all().delete()
            for el in listings:
                OfferGroupItem.objects.create(offer_group=instance, event_listing=el)
            for c in combos:
                OfferGroupItem.objects.create(offer_group=instance, combo=c)

        return instance
```

- [ ] **Step 5: WantBid serializer + view — accept combo**

In `WantBidSerializer`, replace:

```python
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.all(), pk_field=serializers.IntegerField(),
    )

    class Meta:
        model = WantBid
        fields = ["id", "event_listing", "amount", "updated"]
        read_only_fields = ["id", "updated"]

    def validate(self, data):
        if data.get("amount") is not None and data["amount"] < 0:
            raise serializers.ValidationError({"amount": "amount cannot be negative."})
        return data
```

with:

```python
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.all(), pk_field=serializers.IntegerField(),
        required=False, allow_null=True,
    )
    combo = serializers.PrimaryKeyRelatedField(
        queryset=Combo.objects.all(), pk_field=serializers.IntegerField(),
        required=False, allow_null=True,
    )

    class Meta:
        model = WantBid
        fields = ["id", "event_listing", "combo", "amount", "updated"]
        read_only_fields = ["id", "updated"]

    def validate(self, data):
        if data.get("amount") is not None and data["amount"] < 0:
            raise serializers.ValidationError({"amount": "amount cannot be negative."})
        el = data.get("event_listing")
        combo = data.get("combo")
        if bool(el) == bool(combo):
            raise serializers.ValidationError(
                "Provide exactly one of 'event_listing' or 'combo'."
            )
        return data
```

Add the `Combo` import to `serializers.py`'s model import line:

```python
from .models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, UserGamePrice, WantBid
```

(no change needed there — `Combo` comes from `events.models`, already imported in Step 3).

In `backend/trades/views.py`, `WantBidView.put` currently keys only on `event_listing`. Replace the `put` method:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        ser = WantBidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d["event_listing"].event_id != event.id:
            raise ValidationError(
                {"event_listing": "Listing does not belong to this event."}
            )
        obj, _ = WantBid.objects.update_or_create(
            user=request.user, event=event, event_listing=d["event_listing"],
            defaults={"amount": d["amount"]},
        )
        return Response(WantBidSerializer(obj).data, status=status.HTTP_200_OK)
```

with:

```python
    def put(self, request, slug):
        event = self._get_event(slug)
        ser = WantBidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d.get("combo"):
            if d["combo"].event_id != event.id:
                raise ValidationError({"combo": "Combo does not belong to this event."})
            obj, _ = WantBid.objects.update_or_create(
                user=request.user, event=event, combo=d["combo"],
                defaults={"amount": d["amount"]},
            )
        else:
            if d["event_listing"].event_id != event.id:
                raise ValidationError(
                    {"event_listing": "Listing does not belong to this event."}
                )
            obj, _ = WantBid.objects.update_or_create(
                user=request.user, event=event, event_listing=d["event_listing"],
                defaults={"amount": d["amount"]},
            )
        return Response(WantBidSerializer(obj).data, status=status.HTTP_200_OK)
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos -v 2`
Expected: PASS (5 tests).

- [ ] **Step 7: Regression — existing trades tests**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades -v 1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/serializers.py backend/trades/views.py backend/trades/test_combos.py
git commit -m "feat(combos): combo targets in offer/want/bid serializers"
```

---

### Task 5: Pricing — combo ask/bid

**Files:**
- Modify: `backend/trades/pricing.py`
- Modify: `backend/trades/test_combos.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/trades/test_combos.py`:

```python
from django.test import TestCase

from trades.models import WantBid
from trades.pricing import resolve_ask_target, resolve_bid


class ComboPricingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("po", "po@t.test", "pass1234")
        cls.wisher = User.objects.create_user("pw", "pw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=4001, name="Ark")
        cls.bg2 = BoardGame.objects.create(bgg_id=4002, name="Ark Exp")
        cls.event = TradeEvent.objects.create(name="P Ev", organizer=cls.owner)
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(
            event=cls.event, owner=cls.owner, name="bundle", sell_price="40.00"
        )
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def test_resolve_ask_target_combo(self):
        from decimal import Decimal
        self.assertEqual(resolve_ask_target(self.combo), Decimal("40.00"))

    def test_resolve_ask_target_barter_combo_is_none(self):
        barter = Combo.objects.create(event=self.event, owner=self.owner, name="b2")
        self.assertIsNone(resolve_ask_target(barter))

    def test_resolve_bid_combo_target(self):
        from decimal import Decimal
        WantBid.objects.create(
            user=self.wisher, event=self.event, combo=self.combo, amount="35.00"
        )
        item = self.combo.want_memberships.model(combo=self.combo)  # unsaved stand-in
        # Build a minimal want item pointing at the combo:
        from trades.models import WantGroup, WantGroupItem
        wg = WantGroup.objects.create(event=self.event, user=self.wisher, name="w")
        wi = WantGroupItem.objects.create(want_group=wg, combo=self.combo)
        self.assertEqual(resolve_bid(self.wisher, self.event, wi), Decimal("35.00"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos.ComboPricingTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'resolve_ask_target'`.

- [ ] **Step 3: Add the combo pricing branches**

In `backend/trades/pricing.py`, add a combo-ask helper after `resolve_ask` (a combo has no `.copy`, so it needs its own entry point):

```python
def resolve_ask_target(target):
    """Effective sell ask for a tradeable target.

    EventListing -> resolve_ask(target). Combo -> combo.sell_price (no fallback).
    """
    from events.models import Combo
    if isinstance(target, Combo):
        return target.sell_price
    return resolve_ask(target)
```

Extend `resolve_bid` to handle a combo want-target. Replace:

```python
def resolve_bid(user, event, target, bids=None, game_prices=None):
    """Effective buy bid for a user's want target, or None if no bid.

    Pass preloaded bids/game_prices maps (load_bids/load_game_prices) to skip the
    per-item DB lookups in bulk loops.
    """
    if bids is not None:
        override = bids.get((user.id, target.event_listing_id))
    else:
        override = (
            WantBid.objects
            .filter(user=user, event=event, event_listing_id=target.event_listing_id)
            .values_list("amount", flat=True)
            .first()
        )
    if override is not None:
        return override
    bgid = target.event_listing.copy.board_game_id
    if game_prices is not None:
        return game_prices.get((user.id, bgid))
    return _game_default(user.id, event.id, bgid)
```

with:

```python
def resolve_bid(user, event, target, bids=None, game_prices=None, combo_bids=None):
    """Effective buy bid for a user's want target, or None if no bid.

    Pass preloaded bids/game_prices/combo_bids maps to skip per-item DB lookups
    in bulk loops. A combo target has no per-game fallback — its bid is the
    explicit WantBid(user, combo) only.
    """
    combo_id = getattr(target, "combo_id", None)
    if combo_id:
        if combo_bids is not None:
            return combo_bids.get((user.id, combo_id))
        return (
            WantBid.objects
            .filter(user=user, event=event, combo_id=combo_id)
            .values_list("amount", flat=True)
            .first()
        )
    if bids is not None:
        override = bids.get((user.id, target.event_listing_id))
    else:
        override = (
            WantBid.objects
            .filter(user=user, event=event, event_listing_id=target.event_listing_id)
            .values_list("amount", flat=True)
            .first()
        )
    if override is not None:
        return override
    bgid = target.event_listing.copy.board_game_id
    if game_prices is not None:
        return game_prices.get((user.id, bgid))
    return _game_default(user.id, event.id, bgid)
```

Add a combo-bid preloader after `load_bids`:

```python
def load_combo_bids(event):
    """Preload combo WantBids: (user_id, combo_id) -> amount."""
    return {
        (uid, cid): amount
        for uid, cid, amount in WantBid.objects
        .filter(event=event, combo__isnull=False)
        .values_list("user_id", "combo_id", "amount")
    }
```

Also fix `load_bids` to skip combo rows (its key only makes sense for listing bids). Replace:

```python
def load_bids(event):
    """Preload all WantBids for an event: (user_id, event_listing_id) -> amount.

    Pass to resolve_bid to avoid a per-item DB lookup in bulk loops (exports).
    """
    return {
        (uid, elid): amount
        for uid, elid, amount in WantBid.objects
        .filter(event=event)
        .values_list("user_id", "event_listing_id", "amount")
    }
```

with:

```python
def load_bids(event):
    """Preload listing WantBids for an event: (user_id, event_listing_id) -> amount.

    Pass to resolve_bid to avoid a per-item DB lookup in bulk loops (exports).
    Combo bids are loaded separately via load_combo_bids.
    """
    return {
        (uid, elid): amount
        for uid, elid, amount in WantBid.objects
        .filter(event=event, event_listing__isnull=False)
        .values_list("user_id", "event_listing_id", "amount")
    }
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_combos.ComboPricingTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/pricing.py backend/trades/test_combos.py
git commit -m "feat(combos): combo ask/bid resolution + preloaders"
```

---

### Task 6: Solver export — combo items, bids, give/take, givecap

**Files:**
- Modify: `backend/matching/external_solver.py`
- Create: `backend/matching/test_combos.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/matching/test_combos.py`:

```python
"""Combo export: item/ask/bid lines, give/take, and givecap directives."""
from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from trades.models import (
    OfferGroup, OfferGroupItem, TradeWish, WantBid, WantGroup, WantGroupItem,
)
from matching.external_solver import build_wants

User = get_user_model()


class ComboExportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("eo", "eo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("ew", "ew@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=5001, name="Wing")
        cls.bg2 = BoardGame.objects.create(bgg_id=5002, name="WingExp")
        cls.bgw = BoardGame.objects.create(bgg_id=5003, name="Wisher Game")
        cls.event = TradeEvent.objects.create(
            name="E Ev", organizer=cls.owner, status="WANTLIST_OPEN", money_enabled=True
        )
        # owner's two copies -> combo
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(
            event=cls.event, owner=cls.owner, name="WS bundle", sell_price="40.00"
        )
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)
        # wisher's copy to offer for the combo
        cls.cw = Copy.objects.create(owner=cls.wisher, board_game=cls.bgw)
        cls.elw = EventListing.objects.create(event=cls.event, copy=cls.cw)

        # wisher: offer elw -> want the combo (a wish)
        og = OfferGroup.objects.create(event=cls.event, user=cls.wisher, name="og", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, event_listing=cls.elw)
        wg = WantGroup.objects.create(event=cls.event, user=cls.wisher, name="wg", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, combo=cls.combo)
        TradeWish.objects.create(event=cls.event, user=cls.wisher, offer_group=og,
                                 want_group=wg, active=True)
        WantBid.objects.create(user=cls.wisher, event=cls.event, combo=cls.combo, amount="42.00")

    def _lines(self):
        return build_wants(self.event).splitlines()

    def test_combo_item_line_with_ask(self):
        lines = self._lines()
        self.assertIn(
            f"item {self.combo.combo_code} owner {self.owner.username} ask 4000", lines
        )

    def test_combo_bid_line(self):
        lines = self._lines()
        self.assertIn(
            f"bid {self.wisher.username} {self.combo.combo_code} 4200", lines
        )

    def test_givecap_per_member(self):
        lines = self._lines()
        self.assertIn(
            f"givecap {self.owner.username} 1 {self.c1.listing_code} {self.combo.combo_code}",
            lines,
        )
        self.assertIn(
            f"givecap {self.owner.username} 1 {self.c2.listing_code} {self.combo.combo_code}",
            lines,
        )

    def test_combo_appears_as_take(self):
        lines = self._lines()
        wish_lines = [l for l in lines if l.startswith(f"{self.wisher.username} : ")]
        self.assertTrue(any(self.combo.combo_code in l for l in wish_lines),
                        f"combo not in any wish take side: {wish_lines}")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_combos -v 2`
Expected: FAIL — no combo lines emitted.

- [ ] **Step 3: Index active combos**

In `backend/matching/external_solver.py`, add a combo loader after `_listing_index`:

```python
def _combo_index(event):
    """Active Combos of the event, indexed by code / id, members prefetched."""
    from events.models import Combo

    combos = list(
        Combo.objects.filter(event=event, active=True)
        .select_related("owner")
        .prefetch_related("items__event_listing__copy")
    )
    by_code, by_id = {}, {}
    for c in combos:
        by_code[c.combo_code] = c
        by_id[c.id] = c
    return combos, by_code, by_id
```

- [ ] **Step 4: Emit combo item/ask/bid + givecap; expand give/take**

In `build_wants`, thread the combo index through. Replace:

```python
def build_wants(event, include_locations: bool = False) -> str:
    listings, by_code, by_id = _listing_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(event, listings, wishes, by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_id, by_code, block_pairs)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + location_block
```

with:

```python
def build_wants(event, include_locations: bool = False) -> str:
    listings, by_code, by_id = _listing_index(event)
    combos, combo_by_code, combo_by_id = _combo_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(
            event, listings, combos, wishes, by_id, combo_by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs)
    givecap_block = _build_givecaps(combos)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + givecap_block + location_block
```

Add the `givecap` builder (after `_build_xtoy`):

```python
def _build_givecaps(combos) -> str:
    """One `givecap <owner> 1 <member_code> <combo_code>` per combo member, so a
    physical copy leaves at most once — standalone or inside the combo."""
    lines = []
    for c in combos:
        owner = c.owner.username
        for ci in c.items.all():
            member_code = ci.event_listing.copy.listing_code
            lines.append(f"givecap {owner} 1 {member_code} {c.combo_code}")
    return ("\n".join(sorted(lines)) + "\n") if lines else ""
```

`_expand` must yield combo codes for combo want-targets. Replace:

```python
def _expand(want_items, user_id, by_id, blocked):
    """Canonical wants -> concrete listing_codes (others' active copies).

    Binary wants — no priority. Returns a deterministic, sorted list, excluding
    the wisher's own copies and any owned by a blocked user.
    """
    codes = set()
    for it in want_items:
        el = by_id.get(it.event_listing_id)
        if el and el.copy.owner_id != user_id and el.copy.owner_id not in blocked:
            codes.add(el.copy.listing_code)
    return sorted(codes)
```

with:

```python
def _expand(want_items, user_id, by_id, blocked, combo_by_id=None):
    """Canonical wants -> concrete tokens (others' active listings / combos).

    Binary wants — no priority. Returns a deterministic, sorted list, excluding
    the wisher's own items and any owned by a blocked user.
    """
    codes = set()
    for it in want_items:
        if getattr(it, "combo_id", None):
            c = (combo_by_id or {}).get(it.combo_id)
            if c and c.owner_id != user_id and c.owner_id not in blocked:
                codes.add(c.combo_code)
            continue
        el = by_id.get(it.event_listing_id)
        if el and el.copy.owner_id != user_id and el.copy.owner_id not in blocked:
            codes.add(el.copy.listing_code)
    return sorted(codes)
```

Every `_expand(...)` call must pass `combo_by_id`. In `_build_xtoy` the give side and take side both need combos. Replace the whole `_build_xtoy`:

```python
def _build_xtoy(wishes, by_id, by_code, block_pairs) -> str:
    """gurobi: one `username : (NforM) give -> take` line per active wish.

    A duplicate-protected wish lists its real take copies and contributes a
    `dupcap <username> <copies>` directive per (user, canonical game) that has
    >=2 acceptable copies. The solver caps the user's total receipts (swap +
    cash) of those copies at one. dupcap lines are emitted after the wish lines,
    sorted by (username, board_game_id), and union a user's copies for a game
    across all of their dup-protected wishes.
    """
    blocked_cache = {}
    coords = _load_coords()
    lines = []
    dup_groups = {}  # (username, board_game_id) -> set of copy codes
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        give = sorted(
            ogi.event_listing.copy.listing_code
            for ogi in w.offer_group.items.all()
            if ogi.event_listing.active
        )
        take = [c for c in _expand(w.want_group.items.all(), w.user_id, by_id, blocked)
                if c not in give]
        if not give or not take:
            continue
        n = w.offer_group.max_give
        m = w.want_group.min_receive
        if w.want_group.duplicate_protection:
            for code in take:
                key = (w.user.username, by_code[code].copy.board_game_id)
                dup_groups.setdefault(key, set()).add(code)
        lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    for (username, _bg_id), codes in sorted(dup_groups.items()):
        if len(codes) >= 2:
            lines.append(f"dupcap {username} {' '.join(sorted(codes))}")
    return ("\n".join(lines) + "\n") if lines else ""
```

with:

```python
def _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs) -> str:
    """gurobi: one `username : (NforM) give -> take` line per active wish.

    Give/take tokens are listing_codes or combo_codes. A duplicate-protected
    wish contributes `dupcap` over its multi-copy *listing* takes (combos are
    not game-grouped — see the combos spec, out-of-scope note).
    """
    blocked_cache = {}
    coords = _load_coords()
    lines = []
    dup_groups = {}  # (username, board_game_id) -> set of copy codes
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        give = set()
        for ogi in w.offer_group.items.all():
            if ogi.combo_id:
                combo = combo_by_id.get(ogi.combo_id)
                if combo:
                    give.add(combo.combo_code)
            elif ogi.event_listing and ogi.event_listing.active:
                give.add(ogi.event_listing.copy.listing_code)
        give = sorted(give)
        take = [c for c in _expand(w.want_group.items.all(), w.user_id, by_id,
                                   blocked, combo_by_id)
                if c not in give]
        if not give or not take:
            continue
        n = w.offer_group.max_give
        m = w.want_group.min_receive
        if w.want_group.duplicate_protection:
            for code in take:
                el = by_code.get(code)
                if el is None:   # combo token: not game-grouped
                    continue
                key = (w.user.username, el.copy.board_game_id)
                dup_groups.setdefault(key, set()).add(code)
        lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    for (username, _bg_id), codes in sorted(dup_groups.items()):
        if len(codes) >= 2:
            lines.append(f"dupcap {username} {' '.join(sorted(codes))}")
    return ("\n".join(lines) + "\n") if lines else ""
```

Now the prefetch in `_active_wishes` must include offer-group combo items. Replace:

```python
        .prefetch_related(
            "offer_group__items__event_listing__copy",
            "want_group__items",
            "want_group__items__event_listing__copy",
        )
```

with:

```python
        .prefetch_related(
            "offer_group__items__event_listing__copy",
            "offer_group__items__combo",
            "want_group__items",
            "want_group__items__event_listing__copy",
            "want_group__items__combo",
        )
```

- [ ] **Step 5: Emit combo item/ask/bid in the money block**

Replace the signature and body of `_build_xtoy_money_directives`. The current signature is:

```python
def _build_xtoy_money_directives(event, listings, wishes, by_id, block_pairs) -> str:
```

Change it to:

```python
def _build_xtoy_money_directives(event, listings, combos, wishes, by_id, combo_by_id, block_pairs) -> str:
```

Add the combo pricing imports. The function already imports:

```python
    from trades.pricing import (
        load_bids, load_game_prices, resolve_ask, resolve_bid,
    )
```

Change to:

```python
    from trades.pricing import (
        load_bids, load_combo_bids, load_game_prices,
        resolve_ask, resolve_ask_target, resolve_bid,
    )
    combo_bids = load_combo_bids(event)
```

After the existing listing `item` lines block:

```python
    # --- item lines ---
    for el in sorted(listings, key=lambda e: e.copy.listing_code):
        code = el.copy.listing_code
        owner_username = el.copy.owner.username
        ask = resolve_ask(el, game_prices)
        if ask is not None:
            lines.append(f"item {code} owner {owner_username} ask {_to_cents(ask)}")
        else:
            lines.append(f"item {code} owner {owner_username}")
```

add combo `item` lines:

```python
    # --- combo item lines ---
    for c in sorted(combos, key=lambda x: x.combo_code):
        owner_username = c.owner.username
        ask = resolve_ask_target(c)
        if ask is not None:
            lines.append(f"item {c.combo_code} owner {owner_username} ask {_to_cents(ask)}")
        else:
            lines.append(f"item {c.combo_code} owner {owner_username}")
```

In the bid loop, the want items now include combo targets. The loop currently is:

```python
        for it in w.want_group.items.all():
            bid = resolve_bid(w.user, event, it, bids, game_prices)
            if bid is None:
                continue
            bid_cents = _to_cents(bid)
            codes = _expand([it], w.user_id, by_id, blocked)
            codes = [c for c in codes if c not in give_codes]
            for code in codes:
                key = (username, code)
                if key not in bid_map or bid_cents > bid_map[key]:
                    bid_map[key] = bid_cents
```

Replace with (pass `combo_bids` and `combo_by_id`):

```python
        for it in w.want_group.items.all():
            bid = resolve_bid(w.user, event, it, bids, game_prices, combo_bids)
            if bid is None:
                continue
            bid_cents = _to_cents(bid)
            codes = _expand([it], w.user_id, by_id, blocked, combo_by_id)
            codes = [c for c in codes if c not in give_codes]
            for code in codes:
                key = (username, code)
                if key not in bid_map or bid_cents > bid_map[key]:
                    bid_map[key] = bid_cents
```

The `give_codes` set in that loop also needs combo offers. The current block:

```python
        give_codes = {
            ogi.event_listing.copy.listing_code
            for ogi in w.offer_group.items.all()
            if ogi.event_listing.active
        }
```

Replace with:

```python
        give_codes = set()
        for ogi in w.offer_group.items.all():
            if ogi.combo_id:
                c = combo_by_id.get(ogi.combo_id)
                if c:
                    give_codes.add(c.combo_code)
            elif ogi.event_listing and ogi.event_listing.active:
                give_codes.add(ogi.event_listing.copy.listing_code)
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_combos -v 2`
Expected: PASS (4 tests).

- [ ] **Step 7: Regression — existing export tests**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_external_solver events.test_event_cycle_qa -v 1`
Expected: PASS — non-combo export unchanged.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/matching/external_solver.py backend/matching/test_combos.py
git commit -m "feat(combos): export combo item/ask/bid, give/take, givecap"
```

---

### Task 7: Solver load — combo move → one TradeAssignment

**Files:**
- Modify: `backend/matching/models.py`
- Migration: `backend/matching/migrations/` (generated)
- Modify: `backend/matching/external_solver.py`
- Modify: `backend/matching/test_combos.py`

- [ ] **Step 1: Add the `combo` FK to TradeAssignment**

In `backend/matching/models.py`, `TradeAssignment.event_listing` is currently:

```python
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="trade_assignments",
    )
```

Replace with (nullable + combo + check constraint):

```python
    event_listing = models.ForeignKey(
        "events.EventListing",
        on_delete=models.CASCADE,
        related_name="trade_assignments",
        null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo",
        on_delete=models.CASCADE,
        related_name="trade_assignments",
        null=True, blank=True,
    )
```

Add a check constraint to `TradeAssignment.Meta`. The current Meta is:

```python
    class Meta:
        ordering = ["cycle_id", "id"]
```

Replace with:

```python
    class Meta:
        ordering = ["cycle_id", "id"]
        constraints = [
            models.CheckConstraint(
                check=(models.Q(event_listing__isnull=False) & models.Q(combo__isnull=True))
                | (models.Q(event_listing__isnull=True) & models.Q(combo__isnull=False)),
                name="assignment_exactly_one_target",
            ),
        ]
```

- [ ] **Step 2: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations matching`
Expected: a migration altering `TradeAssignment`.

- [ ] **Step 3: Write the failing load test**

Append to `backend/matching/test_combos.py`:

```python
from matching.external_solver import load_solution
from matching.models import MatchRun, TradeAssignment


class ComboLoadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("lo", "lo@t.test", "pass1234")
        cls.wisher = User.objects.create_user("lw", "lw@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=6001, name="L1")
        cls.bg2 = BoardGame.objects.create(bgg_id=6002, name="L2")
        cls.bgw = BoardGame.objects.create(bgg_id=6003, name="LW")
        cls.event = TradeEvent.objects.create(
            name="L Ev", organizer=cls.owner, status="MATCHING", money_enabled=False
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)
        cls.cw = Copy.objects.create(owner=cls.wisher, board_game=cls.bgw)
        cls.elw = EventListing.objects.create(event=cls.event, copy=cls.cw)

    def test_combo_move_loads_as_single_assignment(self):
        run = MatchRun.objects.create(event=self.event, algorithm="gurobi")
        # wisher gives their copy LW, receives the combo:
        #   "<wisher give> -> <combo>" reads combo given so wisher's item received
        # Solver emits two barter edges for the cycle; the combo token is K-...
        out = (
            "Trade Results:\n"
            f"{self.combo.combo_code} -> {self.cw.listing_code}\n"
            f"{self.cw.listing_code} -> {self.combo.combo_code}\n"
        )
        result, summary, log = load_solution(run, out)
        combo_rows = TradeAssignment.objects.filter(match_run=run, combo=self.combo)
        self.assertEqual(combo_rows.count(), 1)
        row = combo_rows.first()
        self.assertIsNone(row.event_listing_id)
        self.assertEqual(row.giver_id, self.owner.id)
        self.assertEqual(row.receiver_id, self.wisher.id)
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_combos.ComboLoadTests -v 2`
Expected: FAIL — `load_solution` raises `ValueError: Unknown listing code in solution: 'K-...'`.

- [ ] **Step 5: Resolve combo tokens in load_solution**

In `backend/matching/external_solver.py`, `load_solution` builds `by_code` then resolves tokens. After:

```python
    event = match_run.event
    listings, by_code, by_id = _listing_index(event)
```

add the combo index:

```python
    _combos, combo_by_code, _combo_by_id = _combo_index(event)
```

The swap-resolution loop is:

```python
    resolved = []
    for moved_code, recv_code, group in parsed:
        moved_el = by_code.get(moved_code)
        if moved_el is None:
            raise ValueError(f"Unknown listing code in solution: {moved_code!r}")
        recv_el = by_code.get(recv_code)
        if recv_el is None:
            raise ValueError(f"Unknown listing code in solution: {recv_code!r}")
        resolved.append([moved_el, moved_el.copy.owner, recv_el.copy.owner, group])
```

This builds `[moved_el, giver, receiver, group]` from listing codes. Generalize each token to a "target" that is either an EventListing or a Combo, exposing owner. Replace the loop with:

```python
    def _resolve_token(code):
        """Return (target, owner) where target is an EventListing or Combo."""
        el = by_code.get(code)
        if el is not None:
            return ("listing", el, el.copy.owner)
        combo = combo_by_code.get(code)
        if combo is not None:
            return ("combo", combo, combo.owner)
        raise ValueError(f"Unknown token in solution: {code!r}")

    resolved = []  # [kind, target, giver, receiver, group]
    for moved_code, recv_code, group in parsed:
        moved_kind, moved_target, moved_owner = _resolve_token(moved_code)
        _recv_kind, _recv_target, recv_owner = _resolve_token(recv_code)
        resolved.append([moved_kind, moved_target, moved_owner, recv_owner, group])
```

The cash-move loop appends similarly. Replace:

```python
        for moved_code, buyer_username, amount_cents in cash_moves:
            moved_el = by_code.get(moved_code)
            if moved_el is None:
                raise ValueError(f"Unknown listing code in cash purchase: {moved_code!r}")
            buyer = users_by_name.get(buyer_username)
            if buyer is None:
                raise ValueError(f"Unknown buyer in cash purchase: {buyer_username!r}")
            cash_by_listing[moved_el.id] = Decimal(amount_cents) / 100
            resolved.append([moved_el, moved_el.copy.owner, buyer, None])
```

with:

```python
        for moved_code, buyer_username, amount_cents in cash_moves:
            moved_kind, moved_target, moved_owner = _resolve_token(moved_code)
            buyer = users_by_name.get(buyer_username)
            if buyer is None:
                raise ValueError(f"Unknown buyer in cash purchase: {buyer_username!r}")
            cash_amt = Decimal(amount_cents) / 100
            if moved_kind == "listing":
                cash_by_listing[moved_target.id] = cash_amt
            else:
                cash_by_combo[moved_target.id] = cash_amt
            resolved.append([moved_kind, moved_target, moved_owner, buyer, None])
```

Add `cash_by_combo = {}` next to the existing `cash_by_listing = {}` line:

```python
    cash_by_listing = {}  # event_listing.id -> Decimal dollars
```

becomes

```python
    cash_by_listing = {}  # event_listing.id -> Decimal dollars
    cash_by_combo = {}    # combo.id -> Decimal dollars
```

The component-assignment helper reads `row[1].id` (giver) — the resolved row shape changed (giver is now index 2). Update `_assign_components` callers. The current call site and the row indices afterward all assume the old 4-tuple. Replace `_assign_components` to take explicit giver/receiver indices is invasive; instead keep the resolved row shape compatible by re-deriving. Replace the block:

```python
    # XTOY came back without groups -> recover connected components.
    if resolved and resolved[0][3] is None:
        _assign_components(resolved)
```

with a combo-aware component pass operating on the new 5-element rows:

```python
    # XTOY came back without groups -> recover connected components by user.
    if resolved and resolved[0][4] is None:
        _assign_components_v2(resolved)
```

Add `_assign_components_v2` next to `_assign_components`:

```python
def _assign_components_v2(resolved):
    """Weakly-connected components for rows [kind, target, giver, receiver, group]."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for _kind, _target, giver, receiver, _g in resolved:
        union(giver.id, receiver.id)

    roots = {}
    for row in resolved:
        r = find(row[2].id)
        roots.setdefault(r, len(roots))
        row[4] = roots[r]
```

Now rebuild the `rows` construction to carry both target kinds. The current block:

```python
    rows = []  # (moved_el, giver, receiver, cycle_id, wish_id, cash_amount, item_value)
    for moved_el, giver, receiver, group in resolved:
        wid = _match_wish(wish_index, receiver.id, moved_el.copy.listing_code)
        amt = cash_by_listing.get(moved_el.id)
        # item_value = the money on this item: the parsed cash-buy amount when present
        # (authoritative, from the solver), else the resolved ask for a swap leg.
        val = amt if amt is not None else resolve_ask(moved_el)
        rows.append((moved_el, giver, receiver, (group or 0) + 1, wid, amt, val))
```

Replace with:

```python
    from trades.pricing import resolve_ask_target

    rows = []  # (kind, target, giver, receiver, cycle_id, wish_id, cash_amount, item_value)
    for kind, target, giver, receiver, group in resolved:
        if kind == "listing":
            token = target.copy.listing_code
            amt = cash_by_listing.get(target.id)
        else:
            token = target.combo_code
            amt = cash_by_combo.get(target.id)
        wid = _match_wish(wish_index, receiver.id, token)
        val = amt if amt is not None else resolve_ask_target(target)
        rows.append((kind, target, giver, receiver, (group or 0) + 1, wid, amt, val))
```

(Delete the now-unused `from trades.pricing import resolve_ask` import line that sat just before the old `rows` block.)

The cycle-step builder reads `moved_el.copy...`. Replace:

```python
    cycles = defaultdict(list)
    for moved_el, giver, receiver, cid, wid, amt, val in rows:
        cycles[cid].append({
            "listing_code": moved_el.copy.listing_code,
            "board_game": moved_el.copy.board_game.name,
            "from_user": giver.username,
            "to_user": receiver.username,
            "wish_id": wid,
            "cash_amount": str(amt) if amt is not None else None,
        })
```

with:

```python
    cycles = defaultdict(list)
    for kind, target, giver, receiver, cid, wid, amt, val in rows:
        if kind == "listing":
            step = {
                "listing_code": target.copy.listing_code,
                "board_game": target.copy.board_game.name,
                "combo_code": None,
            }
        else:
            members = list(target.items.all())
            step = {
                "listing_code": None,
                "board_game": ", ".join(
                    ci.event_listing.copy.board_game.name for ci in members
                ),
                "combo_code": target.combo_code,
                "combo_name": target.name,
                "members": [ci.event_listing.copy.listing_code for ci in members],
            }
        step.update({
            "from_user": giver.username,
            "to_user": receiver.username,
            "wish_id": wid,
            "cash_amount": str(amt) if amt is not None else None,
        })
        cycles[cid].append(step)
```

The money reconstruction loop reads the row tuple; update its unpacking. Replace:

```python
        recon = defaultdict(int)  # username -> net cents (received - given)
        for moved_el, giver, receiver, cid, wid, amt, val in rows:
            if val:
                cents = _to_cents(val)
                recon[receiver.username] += cents
                recon[giver.username] -= cents
```

with:

```python
        recon = defaultdict(int)  # username -> net cents (received - given)
        for kind, target, giver, receiver, cid, wid, amt, val in rows:
            if val:
                cents = _to_cents(val)
                recon[receiver.username] += cents
                recon[giver.username] -= cents
```

Update `received_user_ids` and the bulk_create. Replace:

```python
    active_wishes = _active_wishes(event)
    received_user_ids = {r[2].id for r in rows}
```

with:

```python
    active_wishes = _active_wishes(event)
    received_user_ids = {r[3].id for r in rows}
```

Replace the `bulk_create`:

```python
    TradeAssignment.objects.bulk_create([
        TradeAssignment(
            match_run=match_run,
            event_listing=moved_el,
            giver=giver,
            receiver=receiver,
            wish_id=wid,
            cycle_id=cid,
            cash_amount=amt,
            item_value=val,
        )
        for moved_el, giver, receiver, cid, wid, amt, val in rows
    ])
```

with:

```python
    TradeAssignment.objects.bulk_create([
        TradeAssignment(
            match_run=match_run,
            event_listing=(target if kind == "listing" else None),
            combo=(target if kind == "combo" else None),
            giver=giver,
            receiver=receiver,
            wish_id=wid,
            cycle_id=cid,
            cash_amount=amt,
            item_value=val,
        )
        for kind, target, giver, receiver, cid, wid, amt, val in rows
    ])
```

- [ ] **Step 6: Run test — verify it passes**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching.test_combos.ComboLoadTests -v 2`
Expected: PASS.

- [ ] **Step 7: Regression — full matching + events suites**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching events trades -v 1`
Expected: PASS — existing load/assignment behavior unchanged for listing-only solutions.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/matching/models.py backend/matching/external_solver.py backend/matching/migrations/ backend/matching/test_combos.py
git commit -m "feat(combos): load a combo move as one combo TradeAssignment"
```

---

## Self-Review

**Spec coverage:**
- Combo/ComboItem model + `combo_code` "K-" → Task 1 ✔
- Combo validation (≥2, owned, in-event, ≤1 combo, locked, sell_price>0) → Task 2 ✔
- Combo CRUD + browse (`/combos/`, `?board_game`, `?mine`) → Task 2 ✔
- combo FK + nullable event_listing + exactly-one on offer/want/bid → Task 3 ✔
- serializers accept/expose combo targets → Task 4 ✔
- pricing combo ask/bid (no fallback) + preloaders → Task 5 ✔
- export combo item/ask/bid, give/take, `givecap` per member → Task 6 ✔
- load combo move → one `TradeAssignment(combo=…)`, one shipment (OneToOne unchanged) → Task 7 ✔
- dup grouping skips combos → Task 6 (`el is None` guard) ✔
- Out-of-scope (cross-combo dup, finalize status, nested combos) → untouched ✔

**Placeholder scan:** none.

**Type/name consistency:** resolved-row shape is `[kind, target, giver, receiver, group]` (5) in Task 7 throughout; `rows` tuple is `(kind, target, giver, receiver, cid, wid, amt, val)` (8) consistently; `_combo_index` returns `(combos, by_code, by_id)` used in build_wants (by_id) and load (by_code); `resolve_ask_target`, `load_combo_bids`, `combo_bids` arg names match across pricing + export + load; serializer field `item_combo_ids` matches between fields list, create, update.

**Note for executor:** Task 7 rewrites several interlocking blocks of `load_solution`; apply all Step-5 edits before running Step 6, since intermediate states won't import cleanly.
