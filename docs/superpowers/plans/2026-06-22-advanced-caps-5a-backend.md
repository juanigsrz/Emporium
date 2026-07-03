# Advanced Panel 5a — Manual Caps Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for user-defined solver caps — a `TradeCap`/`TradeCapItem` model (TAKE/GIVE, N, items = listings and/or combos), CRUD endpoints, and export emission of `takecap`/`givecap` lines.

**Architecture:** Mirrors the existing `OfferGroup`/`Combo` patterns: a parent `TradeCap` + `TradeCapItem` with the two-target (`event_listing` XOR `combo`) CheckConstraint; an id-list write serializer with GIVE-ownership validation; `EventScopedMixin` views; and a `_build_user_caps` block appended in `build_wants`.

**Tech Stack:** Django 5, DRF, SQLite/Postgres. Tests: `manage.py test`.

**Spec:** `docs/superpowers/specs/2026-06-22-advanced-panel-caps-prices-design.md` (Part A).

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd: `backend/`. Interpreter: `./.venv/bin/python`. Tests: `./.venv/bin/python manage.py test <dotted.path> -v 2` (from `backend/`).

**This is Plan 5a of 2** (5b = advanced-builder UI). Builds on merged solver `takecap`/`givecap` and the combos models.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/advanced-caps-5a
```

Expected: `Switched to a new branch 'feat/advanced-caps-5a'`

---

### Task 1: `TradeCap` + `TradeCapItem` models

**Files:**
- Modify: `backend/trades/models.py`
- Create: `backend/trades/test_caps.py`
- Migration: `backend/trades/migrations/` (generated)

- [ ] **Step 1: Write the failing test**

Create `backend/trades/test_caps.py`:

```python
"""TradeCap model + API tests."""
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from trades.models import TradeCap, TradeCapItem

User = get_user_model()


class TradeCapModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("capu", "capu@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=9001, name="CapGame")
        cls.event = TradeEvent.objects.create(name="Cap Ev", organizer=cls.u)
        cls.copy = Copy.objects.create(owner=cls.u, board_game=cls.bg)
        cls.el = EventListing.objects.create(event=cls.event, copy=cls.copy)

    def test_create_cap_with_listing_item(self):
        cap = TradeCap.objects.create(
            event=self.event, user=self.u, kind=TradeCap.Kind.GIVE, n=1
        )
        TradeCapItem.objects.create(cap=cap, event_listing=self.el)
        self.assertEqual(cap.items.count(), 1)
        self.assertEqual(cap.kind, "GIVE")

    def test_capitem_requires_exactly_one_target(self):
        cap = TradeCap.objects.create(
            event=self.event, user=self.u, kind=TradeCap.Kind.TAKE, n=2
        )
        with self.assertRaises(IntegrityError):
            # neither target set -> violates the check constraint
            TradeCapItem.objects.create(cap=cap)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps -v 2`
Expected: FAIL — `ImportError: cannot import name 'TradeCap' from 'trades.models'`.

- [ ] **Step 3: Add the models**

Append to `backend/trades/models.py` (the file already imports `settings`, `models`, `ValidationError`, and `Q`):

```python
# ---------------------------------------------------------------------------
# TradeCap — user-defined solver cap (takecap / givecap)
# ---------------------------------------------------------------------------

class TradeCap(models.Model):
    """A user-defined cap: receive (TAKE) or give (GIVE) at most N of a listed
    set of items (event listings and/or combos). Emitted to the solver as a
    `takecap`/`givecap` directive."""

    class Kind(models.TextChoices):
        TAKE = "TAKE", "Take (receive at most N)"
        GIVE = "GIVE", "Give (send at most N)"

    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="trade_caps"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trade_caps"
    )
    kind = models.CharField(max_length=4, choices=Kind.choices)
    n = models.PositiveIntegerField()

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"TradeCap({self.kind} {self.n}, user={self.user_id}, event={self.event_id})"


class TradeCapItem(models.Model):
    """One item in a TradeCap — exactly one of {event_listing, combo}."""

    cap = models.ForeignKey(
        TradeCap, on_delete=models.CASCADE, related_name="items"
    )
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        related_name="cap_memberships", null=True, blank=True,
    )
    combo = models.ForeignKey(
        "events.Combo", on_delete=models.CASCADE,
        related_name="cap_memberships", null=True, blank=True,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                check=(Q(event_listing__isnull=False) & Q(combo__isnull=True))
                | (Q(event_listing__isnull=True) & Q(combo__isnull=False)),
                name="capitem_exactly_one_target",
            ),
        ]

    def __str__(self):
        target = self.event_listing_id or f"combo={self.combo_id}"
        return f"TradeCapItem(cap={self.cap_id}, {target})"
```

(If `Q` is not already imported at the top of `trades/models.py`, add `from django.db.models import Q` — it was added with the combos work, so it should be present.)

- [ ] **Step 4: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations trades`
Expected: a migration creating `TradeCap` and `TradeCapItem`.

- [ ] **Step 5: Run the test — verify it passes**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps -v 2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/models.py backend/trades/test_caps.py backend/trades/migrations/
git commit -m "feat(caps): TradeCap + TradeCapItem models"
```

---

### Task 2: Serializer, views, routes

**Files:**
- Modify: `backend/trades/serializers.py`
- Modify: `backend/trades/views.py`
- Modify: `backend/trades/urls.py`
- Modify: `backend/trades/test_caps.py`

- [ ] **Step 1: Write the failing API tests**

Append to `backend/trades/test_caps.py`:

```python
from rest_framework import status
from rest_framework.test import APITestCase


class TradeCapAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("capo", "capo@t.test", "pass1234")
        cls.other = User.objects.create_user("capx", "capx@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=9101, name="G1")
        cls.bg2 = BoardGame.objects.create(bgg_id=9102, name="G2")
        cls.event = TradeEvent.objects.create(
            name="Cap API Ev", organizer=cls.owner, status="WANTLIST_OPEN"
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.co = Copy.objects.create(owner=cls.other, board_game=cls.bg1)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.el_other = EventListing.objects.create(event=cls.event, copy=cls.co)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="bundle")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def _url(self):
        return f"/api/events/{self.event.slug}/caps/"

    def test_create_give_cap_listings_and_combo(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1,
            "item_listing_ids": [self.el1.id],
            "item_combo_ids": [self.combo.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["kind"], "GIVE")
        self.assertEqual(len(resp.data["items"]), 2)

    def test_create_take_cap_other_listing(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "TAKE", "n": 2, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_give_cap_rejects_non_owned_item(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_no_items(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {"kind": "TAKE", "n": 1}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_n_below_one(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "TAKE", "n": 0, "item_listing_ids": [self.el_other.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_blocked_when_locked(self):
        self.event.status = "MATCHING"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_returns_only_own_caps(self):
        self.client.force_authenticate(self.owner)
        self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json")
        self.client.force_authenticate(self.other)
        resp = self.client.get(self._url())
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 0)

    def test_only_owner_can_delete(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "kind": "GIVE", "n": 1, "item_listing_ids": [self.el1.id],
        }, format="json").data
        self.client.force_authenticate(self.other)
        resp = self.client.delete(f"{self._url()}{created['id']}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps.TradeCapAPITests -v 2`
Expected: FAIL — 404 (no `/caps/` route).

- [ ] **Step 3: Add the serializers**

In `backend/trades/serializers.py`, add `TradeCap, TradeCapItem` to the local model import line (currently `from .models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, UserGamePrice, WantBid`):

```python
from .models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, UserGamePrice, WantBid, TradeCap, TradeCapItem
```

Append to `backend/trades/serializers.py` (`Combo`/`EventListing` are already imported from `events.models`; `transaction` is already imported):

```python
# ---------------------------------------------------------------------------
# TradeCap
# ---------------------------------------------------------------------------

class TradeCapItemSerializer(serializers.ModelSerializer):
    listing_code    = serializers.SerializerMethodField()
    board_game_name = serializers.SerializerMethodField()
    combo_code      = serializers.CharField(source="combo.combo_code", read_only=True)
    combo_name      = serializers.CharField(source="combo.name", read_only=True)

    class Meta:
        model = TradeCapItem
        fields = ["id", "event_listing", "listing_code", "board_game_name",
                  "combo", "combo_code", "combo_name"]
        read_only_fields = fields

    def get_listing_code(self, obj):
        return obj.event_listing.copy.listing_code if obj.event_listing_id else None

    def get_board_game_name(self, obj):
        return obj.event_listing.copy.board_game.name if obj.event_listing_id else None


class TradeCapSerializer(serializers.ModelSerializer):
    user  = serializers.PrimaryKeyRelatedField(read_only=True)
    items = TradeCapItemSerializer(many=True, read_only=True)
    item_listing_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False, default=list,
    )
    item_combo_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False, default=list,
    )

    class Meta:
        model = TradeCap
        fields = ["id", "event", "user", "kind", "n", "items",
                  "item_listing_ids", "item_combo_ids", "created"]
        read_only_fields = ["id", "event", "user", "items", "created"]

    def validate_n(self, value):
        if value < 1:
            raise serializers.ValidationError("n must be at least 1.")
        return value

    def _resolve_items(self, listing_ids, combo_ids, event, user, kind):
        if not listing_ids and not combo_ids:
            raise serializers.ValidationError("A cap needs at least one item.")
        listings = list(
            EventListing.objects.select_related("copy")
            .filter(id__in=listing_ids, event=event)
        )
        if len(listings) != len(set(listing_ids)):
            found = {el.id for el in listings}
            raise serializers.ValidationError(
                {"item_listing_ids": f"Listings not found in this event: {sorted(set(listing_ids) - found)}"}
            )
        combos = list(Combo.objects.filter(id__in=combo_ids, event=event))
        if len(combos) != len(set(combo_ids)):
            found = {c.id for c in combos}
            raise serializers.ValidationError(
                {"item_combo_ids": f"Combos not found in this event: {sorted(set(combo_ids) - found)}"}
            )
        if kind == TradeCap.Kind.GIVE:
            bad = [el.id for el in listings if el.copy.owner_id != user.id]
            bad += [c.id for c in combos if c.owner_id != user.id]
            if bad:
                raise serializers.ValidationError(
                    {"item_listing_ids": f"givecap items must be owned by you: {sorted(bad)}"}
                )
        return listings, combos

    @transaction.atomic
    def create(self, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", [])
        combo_ids = validated_data.pop("item_combo_ids", [])
        event = validated_data["event"]
        user = validated_data["user"]
        listings, combos = self._resolve_items(
            listing_ids, combo_ids, event, user, validated_data["kind"]
        )
        cap = TradeCap.objects.create(**validated_data)
        for el in listings:
            TradeCapItem.objects.create(cap=cap, event_listing=el)
        for c in combos:
            TradeCapItem.objects.create(cap=cap, combo=c)
        return cap

    @transaction.atomic
    def update(self, instance, validated_data):
        listing_ids = validated_data.pop("item_listing_ids", None)
        combo_ids = validated_data.pop("item_combo_ids", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if listing_ids is not None or combo_ids is not None:
            listings, combos = self._resolve_items(
                listing_ids or [], combo_ids or [], instance.event, instance.user, instance.kind
            )
            instance.items.all().delete()
            for el in listings:
                TradeCapItem.objects.create(cap=instance, event_listing=el)
            for c in combos:
                TradeCapItem.objects.create(cap=instance, combo=c)
        return instance
```

- [ ] **Step 4: Add the views**

In `backend/trades/views.py`, add `TradeCap` to the models import (`from .models import OfferGroup, WantGroup, TradeWish, UserGamePrice, WantBid` → add `, TradeCap`) and `TradeCapSerializer` to the serializers import. Append the views:

```python
class TradeCapListCreateView(EventScopedMixin, APIView):
    """GET/POST /api/events/{slug}/caps/ — the user's own caps."""

    _PREFETCH = ("items__event_listing__copy__board_game", "items__combo")

    def get(self, request, slug):
        event = self._get_event(slug)
        qs = (
            TradeCap.objects.filter(event=event, user=request.user)
            .prefetch_related(*self._PREFETCH)
            .order_by("-created")
        )
        return self._paginate(qs, TradeCapSerializer, request, event)

    def post(self, request, slug):
        event = self._get_event(slug)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = TradeCapSerializer(data=request.data, context=ctx)
        ser.is_valid(raise_exception=True)
        cap = ser.save(event=event, user=request.user)
        full = TradeCap.objects.prefetch_related(*self._PREFETCH).get(pk=cap.pk)
        return Response(TradeCapSerializer(full, context=ctx).data,
                        status=status.HTTP_201_CREATED)


class TradeCapDetailView(EventScopedMixin, APIView):
    """GET/PATCH/DELETE /api/events/{slug}/caps/{id}/ — owner-only."""

    _PREFETCH = ("items__event_listing__copy__board_game", "items__combo")

    def _get_cap(self, slug, pk, request):
        event = self._get_event(slug)
        cap = get_object_or_404(TradeCap, pk=pk, event=event)
        if cap.user_id != request.user.id:
            raise PermissionDenied("You do not own this cap.")
        return event, cap

    def get(self, request, slug, pk):
        event, cap = self._get_cap(slug, pk, request)
        full = TradeCap.objects.prefetch_related(*self._PREFETCH).get(pk=cap.pk)
        return Response(TradeCapSerializer(full, context=self._serializer_context(request, event)).data)

    def patch(self, request, slug, pk):
        event, cap = self._get_cap(slug, pk, request)
        self._assert_editable(event)
        ctx = self._serializer_context(request, event)
        ser = TradeCapSerializer(cap, data=request.data, partial=True, context=ctx)
        ser.is_valid(raise_exception=True)
        cap = ser.save()
        full = TradeCap.objects.prefetch_related(*self._PREFETCH).get(pk=cap.pk)
        return Response(TradeCapSerializer(full, context=ctx).data)

    def delete(self, request, slug, pk):
        event, cap = self._get_cap(slug, pk, request)
        self._assert_editable(event)
        cap.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Wire the routes**

In `backend/trades/urls.py`, import the two views and add routes (mirroring offer-groups):

```python
from .views import (
    GamePriceView,
    OfferGroupDetailView,
    OfferGroupListCreateView,
    TradeCapDetailView,
    TradeCapListCreateView,
    TradeWishDetailView,
    TradeWishListCreateView,
    WantBidView,
    WantGroupDetailView,
    WantGroupListCreateView,
)
```

And add to `urlpatterns` (after the offer-group routes):

```python
    path(
        "events/<slug:slug>/caps/",
        TradeCapListCreateView.as_view(),
        name="trade-cap-list",
    ),
    path(
        "events/<slug:slug>/caps/<int:pk>/",
        TradeCapDetailView.as_view(),
        name="trade-cap-detail",
    ),
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps -v 2`
Expected: PASS (model + 8 API tests).

- [ ] **Step 7: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades -v 1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/trades/serializers.py backend/trades/views.py backend/trades/urls.py backend/trades/test_caps.py
git commit -m "feat(caps): TradeCap serializer, CRUD endpoints"
```

---

### Task 3: Export — emit user cap directives

**Files:**
- Modify: `backend/matching/external_solver.py`
- Modify: `backend/trades/test_caps.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/trades/test_caps.py`:

```python
from matching.external_solver import build_wants
from trades.models import OfferGroup, OfferGroupItem, TradeWish, WantGroup, WantGroupItem


class TradeCapExportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("ce_o", "ce_o@t.test", "pass1234")
        cls.wisher = User.objects.create_user("ce_w", "ce_w@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=9201, name="E1")
        cls.bg2 = BoardGame.objects.create(bgg_id=9202, name="E2")
        cls.event = TradeEvent.objects.create(
            name="Cap Exp Ev", organizer=cls.owner, status="WANTLIST_OPEN"
        )
        cls.c1 = Copy.objects.create(owner=cls.owner, board_game=cls.bg1)
        cls.c2 = Copy.objects.create(owner=cls.owner, board_game=cls.bg2)
        cls.el1 = EventListing.objects.create(event=cls.event, copy=cls.c1)
        cls.el2 = EventListing.objects.create(event=cls.event, copy=cls.c2)
        cls.combo = Combo.objects.create(event=cls.event, owner=cls.owner, name="cb")
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el1)
        ComboItem.objects.create(combo=cls.combo, event_listing=cls.el2)

    def test_give_cap_emits_givecap_line(self):
        cap = TradeCap.objects.create(event=self.event, user=self.owner,
                                      kind=TradeCap.Kind.GIVE, n=1)
        TradeCapItem.objects.create(cap=cap, event_listing=self.el1)
        TradeCapItem.objects.create(cap=cap, combo=self.combo)
        lines = build_wants(self.event).splitlines()
        self.assertIn(
            f"givecap {self.owner.username} 1 {self.c1.listing_code} {self.combo.combo_code}",
            lines,
        )

    def test_take_cap_emits_takecap_line(self):
        cap = TradeCap.objects.create(event=self.event, user=self.wisher,
                                      kind=TradeCap.Kind.TAKE, n=2)
        TradeCapItem.objects.create(cap=cap, event_listing=self.el1)
        TradeCapItem.objects.create(cap=cap, event_listing=self.el2)
        lines = build_wants(self.event).splitlines()
        self.assertIn(
            f"takecap {self.wisher.username} 2 {self.c1.listing_code} {self.c2.listing_code}",
            lines,
        )

    def test_inactive_item_skipped(self):
        cap = TradeCap.objects.create(event=self.event, user=self.owner,
                                      kind=TradeCap.Kind.GIVE, n=1)
        TradeCapItem.objects.create(cap=cap, event_listing=self.el1)
        TradeCapItem.objects.create(cap=cap, event_listing=self.el2)
        EventListing.objects.filter(id=self.el2.id).update(active=False)
        lines = build_wants(self.event).splitlines()
        self.assertIn(f"givecap {self.owner.username} 1 {self.c1.listing_code}", lines)
```

Note: cap tokens are emitted sorted; the assertions list codes in sorted order. If a literal assertion fails only on token order, re-derive the expected order with `sorted([...])` — the implementation sorts tokens.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps.TradeCapExportTests -v 2`
Expected: FAIL — no cap lines emitted.

- [ ] **Step 3: Add the cap-export builder**

In `backend/matching/external_solver.py`, add a builder near `_build_givecaps`:

```python
def _build_user_caps(event, by_id, combo_by_id) -> str:
    """User-defined caps: one `takecap`/`givecap <user> <n> <tokens>` line per
    active TradeCap. Tokens resolve to active listing/combo codes; items whose
    listing/combo is inactive are skipped, and a cap with no live tokens is
    dropped. Additive to the auto dupcap/combo-givecap lines."""
    from trades.models import TradeCap

    caps = (
        TradeCap.objects.filter(event=event)
        .select_related("user")
        .prefetch_related("items__event_listing__copy", "items__combo")
        .order_by("id")
    )
    lines = []
    for cap in caps:
        tokens = []
        for it in cap.items.all():
            if it.event_listing_id:
                el = by_id.get(it.event_listing_id)
                if el:
                    tokens.append(el.copy.listing_code)
            elif it.combo_id:
                c = combo_by_id.get(it.combo_id)
                if c:
                    tokens.append(c.combo_code)
        if not tokens:
            continue
        directive = "takecap" if cap.kind == TradeCap.Kind.TAKE else "givecap"
        lines.append(f"{directive} {cap.user.username} {cap.n} {' '.join(sorted(tokens))}")
    return ("\n".join(lines) + "\n") if lines else ""
```

(`TradeCap.Kind.TAKE` — import is function-local, matching `_combo_index`'s style.)

- [ ] **Step 4: Append the cap block in `build_wants`**

`build_wants` currently ends:

```python
    body = _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs)
    givecap_block = _build_givecaps(combos)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + givecap_block + location_block
```

Replace with (add the caps block):

```python
    body = _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs)
    givecap_block = _build_givecaps(combos)
    caps_block = _build_user_caps(event, by_id, combo_by_id)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + givecap_block + caps_block + location_block
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test trades.test_caps -v 2`
Expected: PASS (all model + API + export tests).

- [ ] **Step 6: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test matching events trades -v 1`
Expected: PASS — existing export unchanged (auto caps still emitted; user caps appended).

- [ ] **Step 7: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/matching/external_solver.py backend/trades/test_caps.py
git commit -m "feat(caps): export user takecap/givecap directives"
```

---

## Self-Review

**Spec coverage (Part A backend):**
- `TradeCap`/`TradeCapItem` (kind TAKE/GIVE, n, two-target items) → Task 1 ✔
- Validation: n≥1, ≥1 item, GIVE-ownership, exactly-one-target, locked-gated, owner-only → Tasks 1–2 ✔
- CRUD endpoints (`/caps/`, `/caps/{id}/`), list = own caps → Task 2 ✔
- Export `takecap`/`givecap <user> <n> <tokens>`, listings + combos, inactive skipped, additive → Task 3 ✔
- Tests for all → Tasks 1–3 ✔

**Placeholder scan:** none.

**Type/name consistency:** `TradeCap.Kind.{TAKE,GIVE}` used in serializer validation, views, and export; `TradeCapItem` two-target check mirrors offer/want/assignment; serializer write fields `item_listing_ids`/`item_combo_ids` match `_resolve_items` + create/update; `_build_user_caps(event, by_id, combo_by_id)` args match the `build_wants` call (`by_id` from `_listing_index`, `combo_by_id` from `_combo_index`).

**Note for executor:** `by_id` (from `_listing_index`) only contains ACTIVE listings; `combo_by_id` (from `_combo_index`) only ACTIVE combos — so the inactive-skip behavior in `_build_user_caps` is automatic via `.get()` returning None.
