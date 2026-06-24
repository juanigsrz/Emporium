# Pricing Model Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move money prices off X-to-Y group rows onto a per-game canonical default (`UserGamePrice`) with per-copy sell (`EventListing.sell_price`) and per-want bid (`WantBid`) overrides, resolved `override > game default > none`.

**Architecture:** Additive-first — add the new storage + resolution + endpoints + UI, switch the solver export and reads to the resolved values, then delete the old `OfferGroupItem.money_amount` / `WantGroupItem.money_amount` fields last so the test suite stays green between tasks. Backend is Django REST Framework with `APIView`/`ViewSet` event-scoped endpoints; resolution lives in a single pure helper module.

**Tech Stack:** Django + DRF (backend, `pytest`/Django `TestCase`), Vite + React + TypeScript (frontend), gurobi external solver bridge.

Spec: `docs/superpowers/specs/2026-06-11-pricing-model-refactor-design.md`.

**Conventions observed:**
- `BoardGame` PK **is** `bgg_id` (catalog/models.py:20) — FKs and API ids use it directly.
- Event-scoped trade routes live in `trades/urls.py` mounted at `/api/` (paths embed `events/<slug:slug>/...`).
- Commit messages: Conventional Commits. **No `Co-Authored-By` trailer** (project rule).
- Run backend tests from `backend/`: `python manage.py test <path>`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/trades/models.py` | `UserGamePrice`, `WantBid` models; drop two `money_amount` fields | Modify |
| `backend/events/models.py` | `EventListing.sell_price` | Modify |
| `backend/trades/pricing.py` | `resolve_ask`, `resolve_bid` pure helpers | Create |
| `backend/trades/serializers.py` | new serializers; drop `money_amount`/`item_money`; resolved read fields | Modify |
| `backend/trades/views.py` | `UserGamePrice` + `WantBid` upsert views | Modify |
| `backend/trades/urls.py` | register `game-prices/` + `want-bids/` | Modify |
| `backend/events/views.py` | add PATCH `sell_price` to `listing_detail` | Modify |
| `backend/events/serializers.py` | `EventListingSerializer.sell_price` (writable, owner) | Modify |
| `backend/matching/external_solver.py` | ask/bid from resolution helpers | Modify |
| `backend/trades/tests_pricing.py` | resolution + endpoint tests | Create |
| `backend/matching/test_external_solver.py` | rewrite money cases to new model | Modify |
| `frontend/src/api/trades.ts`, `events.ts` | types + API calls for new fields/endpoints | Modify |
| `frontend/src/features/events/EventDetailPage.tsx` | per-copy sell price input | Modify |
| `frontend/src/features/trades/MyWantsPage.tsx` | Catalog per-game price | Modify |
| `frontend/src/features/trades/WantListBuilderPage.tsx` | per-want bid; remove offer price | Modify |

---

## Task 1: Add new storage (UserGamePrice, WantBid, EventListing.sell_price)

Additive only — old `money_amount` fields stay for now so nothing breaks.

**Files:**
- Modify: `backend/trades/models.py`
- Modify: `backend/events/models.py`
- Test: `backend/trades/tests_pricing.py` (create)

- [ ] **Step 1: Write failing tests for the new models**

Create `backend/trades/tests_pricing.py`:

```python
"""Pricing model refactor — models, resolution, and endpoints."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from matching.tests import MatchingTestBase
from trades.models import UserGamePrice, WantBid


class PricingModelTests(MatchingTestBase):
    def test_user_game_price_unique_per_user_event_game(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UserGamePrice.objects.create(
                    user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("50")
                )

    def test_event_listing_sell_price_nullable(self):
        self.el_a1.sell_price = Decimal("12.50")
        self.el_a1.save(update_fields=["sell_price"])
        self.el_a1.refresh_from_db()
        self.assertEqual(self.el_a1.sell_price, Decimal("12.50"))

    def test_want_bid_board_game_target_requires_board_game(self):
        wb = WantBid(
            user=self.user_a, event=self.event,
            target_type=WantBid.TargetType.BOARD_GAME, amount=Decimal("30"),
        )
        with self.assertRaises(ValidationError):
            wb.clean()

    def test_want_bid_listing_target_ok(self):
        wb = WantBid(
            user=self.user_a, event=self.event,
            target_type=WantBid.TargetType.LISTING,
            event_listing=self.el_b1, amount=Decimal("30"),
        )
        wb.clean()  # no raise
        wb.save()
        self.assertEqual(WantBid.objects.count(), 1)
```

- [ ] **Step 2: Run tests — verify they fail (import error)**

Run: `cd backend && python manage.py test trades.tests_pricing -v 2`
Expected: FAIL — `ImportError: cannot import name 'UserGamePrice'`.

- [ ] **Step 3: Add `sell_price` to `EventListing`**

In `backend/events/models.py`, inside `class EventListing`, after the `active` field:

```python
    active = models.BooleanField(default=True)

    # Per-copy sell-price override for money trading. null => fall through to the
    # owner's UserGamePrice for this game (see trades/pricing.resolve_ask).
    sell_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
```

- [ ] **Step 4: Add `UserGamePrice` and `WantBid` to `trades/models.py`**

Append to `backend/trades/models.py` (after `TradeWish`):

```python
# ---------------------------------------------------------------------------
# UserGamePrice — canonical per-game price (defaults both sell ask and buy bid)
# ---------------------------------------------------------------------------

class UserGamePrice(models.Model):
    """A user's standing price for a game in an event.

    Serves as the default ask for every copy of the game they own and the
    default bid for any want targeting the game, unless a per-copy
    (EventListing.sell_price) or per-want (WantBid) override is set.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_prices"
    )
    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="game_prices"
    )
    board_game = models.ForeignKey(
        "catalog.BoardGame", on_delete=models.CASCADE, related_name="game_prices"
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "event", "board_game")]
        ordering = ["id"]

    def __str__(self):
        return f"UserGamePrice({self.user.username}, {self.board_game_id}, {self.price})"


# ---------------------------------------------------------------------------
# WantBid — per-target bid override (mirrors WantGroupItem target shape)
# ---------------------------------------------------------------------------

class WantBid(models.Model):
    """A user's bid override for one target (a game or a specific listing)."""

    class TargetType(models.TextChoices):
        BOARD_GAME = "BOARD_GAME", "Board Game (any copy)"
        LISTING    = "LISTING",    "Specific Listing"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="want_bids"
    )
    event = models.ForeignKey(
        "events.TradeEvent", on_delete=models.CASCADE, related_name="want_bids"
    )
    target_type = models.CharField(max_length=20, choices=TargetType.choices)
    board_game = models.ForeignKey(
        "catalog.BoardGame", on_delete=models.CASCADE,
        null=True, blank=True, related_name="want_bids",
    )
    event_listing = models.ForeignKey(
        "events.EventListing", on_delete=models.CASCADE,
        null=True, blank=True, related_name="want_bids",
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event", "board_game"],
                condition=models.Q(board_game__isnull=False),
                name="uniq_wantbid_user_event_game",
            ),
            models.UniqueConstraint(
                fields=["user", "event", "event_listing"],
                condition=models.Q(event_listing__isnull=False),
                name="uniq_wantbid_user_event_listing",
            ),
        ]
        ordering = ["id"]

    def clean(self):
        if self.target_type == self.TargetType.BOARD_GAME:
            if not self.board_game_id:
                raise ValidationError("board_game is required when target_type is BOARD_GAME.")
            if self.event_listing_id:
                raise ValidationError("event_listing must be null when target_type is BOARD_GAME.")
        elif self.target_type == self.TargetType.LISTING:
            if not self.event_listing_id:
                raise ValidationError("event_listing is required when target_type is LISTING.")
            if self.board_game_id:
                raise ValidationError("board_game must be null when target_type is LISTING.")
        else:
            raise ValidationError(f"Unknown target_type: {self.target_type}")

    def __str__(self):
        return f"WantBid({self.user.username}, {self.target_type}, {self.amount})"
```

- [ ] **Step 5: Make migrations**

Run: `cd backend && python manage.py makemigrations trades events`
Expected: two migration files created (trades: UserGamePrice + WantBid; events: EventListing.sell_price).

- [ ] **Step 6: Run tests — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing -v 2`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full backend suite — verify no regression**

Run: `cd backend && python manage.py test -v 1`
Expected: all green (old `money_amount` still present, nothing removed yet).

- [ ] **Step 8: Commit**

```bash
git add backend/trades/models.py backend/events/models.py backend/trades/migrations backend/events/migrations backend/trades/tests_pricing.py
git commit -m "feat(pricing): add UserGamePrice, WantBid, EventListing.sell_price"
```

---

## Task 2: Resolution helper (`trades/pricing.py`)

**Files:**
- Create: `backend/trades/pricing.py`
- Test: `backend/trades/tests_pricing.py` (append)

- [ ] **Step 1: Write failing resolution tests**

Append to `backend/trades/tests_pricing.py`:

```python
from trades import pricing
from trades.models import WantGroupItem


class ResolveAskTests(MatchingTestBase):
    def test_per_copy_override_wins(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        self.el_a1.sell_price = Decimal("33")
        self.el_a1.save(update_fields=["sell_price"])
        self.assertEqual(pricing.resolve_ask(self.el_a1), Decimal("33"))

    def test_falls_through_to_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40")
        )
        self.assertIsNone(self.el_a1.sell_price)
        self.assertEqual(pricing.resolve_ask(self.el_a1), Decimal("40"))

    def test_none_when_no_price_anywhere(self):
        self.assertIsNone(pricing.resolve_ask(self.el_a1))


class ResolveBidTests(MatchingTestBase):
    def test_want_override_wins_over_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("20")
        )
        WantBid.objects.create(
            user=self.user_a, event=self.event,
            target_type=WantBid.TargetType.BOARD_GAME,
            board_game=self.game_terra, amount=Decimal("25"),
        )
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game_terra
        )
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("25"))

    def test_listing_target_uses_listing_game_default(self):
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=Decimal("20")
        )
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.LISTING, event_listing=self.el_b1
        )  # el_b1 is a terra copy
        self.assertEqual(pricing.resolve_bid(self.user_a, self.event, target), Decimal("20"))

    def test_none_when_no_bid(self):
        target = WantGroupItem(
            target_type=WantGroupItem.TargetType.BOARD_GAME, board_game=self.game_terra
        )
        self.assertIsNone(pricing.resolve_bid(self.user_a, self.event, target))
```

> Confirm in `matching/tests.py` that `el_b1`'s copy is `game_terra`. If the fixture differs, use the listing whose `copy.board_game` is `game_terra`.

- [ ] **Step 2: Run — verify fail**

Run: `cd backend && python manage.py test trades.tests_pricing.ResolveAskTests trades.tests_pricing.ResolveBidTests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'trades.pricing'`.

- [ ] **Step 3: Implement `trades/pricing.py`**

```python
"""trades/pricing.py

Resolve effective money prices from the per-game default + overrides.

    resolve_ask(event_listing) -> Decimal | None
        per-copy EventListing.sell_price
        ?? UserGamePrice(owner, event, game)
        ?? None  (barter-only)

    resolve_bid(user, event, target) -> Decimal | None
        WantBid(user, event, target)
        ?? UserGamePrice(user, event, target.board_game)
        ?? None  (no bid)

`target` is anything exposing `.target_type`, `.board_game(_id)`, and
`.event_listing` — i.e. a WantGroupItem or a WantBid-shaped object.
"""

from .models import UserGamePrice, WantBid, WantGroupItem


def _game_default(user_id, event_id, board_game_id):
    if board_game_id is None:
        return None
    row = (
        UserGamePrice.objects
        .filter(user_id=user_id, event_id=event_id, board_game_id=board_game_id)
        .values_list("price", flat=True)
        .first()
    )
    return row


def resolve_ask(event_listing):
    """Effective sell ask for a listing, or None if barter-only."""
    if event_listing.sell_price is not None:
        return event_listing.sell_price
    copy = event_listing.copy
    return _game_default(copy.owner_id, event_listing.event_id, copy.board_game_id)


def _target_board_game_id(target):
    if target.target_type == WantGroupItem.TargetType.BOARD_GAME:
        return target.board_game_id
    return target.event_listing.copy.board_game_id


def resolve_bid(user, event, target):
    """Effective buy bid for a user's want target, or None if no bid."""
    if target.target_type == WantGroupItem.TargetType.BOARD_GAME:
        override = (
            WantBid.objects
            .filter(user=user, event=event,
                    target_type=WantBid.TargetType.BOARD_GAME,
                    board_game_id=target.board_game_id)
            .values_list("amount", flat=True)
            .first()
        )
    else:
        override = (
            WantBid.objects
            .filter(user=user, event=event,
                    target_type=WantBid.TargetType.LISTING,
                    event_listing_id=target.event_listing_id)
            .values_list("amount", flat=True)
            .first()
        )
    if override is not None:
        return override
    return _game_default(user.id, event.id, _target_board_game_id(target))
```

- [ ] **Step 4: Run — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing.ResolveAskTests trades.tests_pricing.ResolveBidTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/trades/pricing.py backend/trades/tests_pricing.py
git commit -m "feat(pricing): resolve_ask/resolve_bid override>default>none helpers"
```

---

## Task 3: Switch solver export to resolved prices

Replace the `min(OfferGroupItem.money_amount)` ask query and per-`WantGroupItem.money_amount` bid with `resolve_ask` / `resolve_bid`. The old fields still exist but the export stops reading them.

**Files:**
- Modify: `backend/matching/external_solver.py:209-283` (`_build_xtoy_money_directives`), `:177-201` (`_build_placeholder_header`)
- Modify: `backend/matching/test_external_solver.py` (money cases)

- [ ] **Step 1: Update the XToY money-directive test to set prices via the new model**

In `backend/matching/test_external_solver.py`, replace the body of `test_xtoy_money_directives` (lines ~142-149) that sets `ogi.money_amount` / `item.money_amount` with:

```python
        from trades.models import UserGamePrice
        # Sell ask: per-copy override on alice's offered listing (el_a1 = brass copy)
        self.el_a1.sell_price = 20   # $20.00 -> 2000 cents
        self.el_a1.save(update_fields=["sell_price"])
        # Buy bid: alice's per-game default for terra = $30.00 -> 3000 cents
        UserGamePrice.objects.create(
            user=self.user_a, event=self.event, board_game=self.game_terra, price=30
        )
```

And delete the `ogi.money_amount`/`item.money_amount` cleanup lines at the end of that test (lines ~168-171); keep the `money_enabled = False` reset.

- [ ] **Step 2: Update the placeholder-header (ONETOONE) test to the new model**

In `PlaceholderHeaderTests.setUpTestData` (lines ~409-415), replace the `item.money_amount`/`ogi.money_amount` block with:

```python
        from trades.models import UserGamePrice
        UserGamePrice.objects.create(
            user=cls.user_a, event=cls.event, board_game=cls.game_terra, price=30
        )  # buy bid P
        cls.el_a1.sell_price = 20  # sell ask Q
        cls.el_a1.save(update_fields=["sell_price"])
```

Update the two assertions in `test_header_has_money_budget_dup_and_money_want`:

```python
        self.assertIn(
            f"#! MONEY-WANT ({self.user_a.username}) game={self.game_terra.bgg_id} max=30.00",
            text,
        )
        self.assertIn(
            f"#! MONEY-OFFER ({self.user_a.username}) listing={self.copy_a1.listing_code} min=20.00",
            text,
        )
```

(These strings are unchanged — only their data source moved — but keep them to lock the format.)

- [ ] **Step 3: Run — verify the two money tests now fail**

Run: `cd backend && python manage.py test matching.test_external_solver.ExportXToYTests.test_xtoy_money_directives matching.test_external_solver.PlaceholderHeaderTests -v 2`
Expected: FAIL — export still reads `money_amount`, so ask/bid lines are missing.

- [ ] **Step 4: Rewrite `_build_xtoy_money_directives` item + bid sections**

In `backend/matching/external_solver.py`, replace the item-lines loop (lines ~241-251):

```python
    # --- item lines ---
    from trades.pricing import resolve_ask
    for el in sorted(listings, key=lambda e: e.copy.listing_code):
        code = el.copy.listing_code
        owner_username = el.copy.owner.username
        ask = resolve_ask(el)
        if ask is not None:
            lines.append(f"item {code} owner {owner_username} ask {_to_cents(ask)}")
        else:
            lines.append(f"item {code} owner {owner_username}")
```

Replace the bid-map build loop (lines ~258-278) inner `for it in ... if it.money_amount is None` logic:

```python
    from trades.pricing import resolve_bid
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        username = w.user.username
        give_codes = {
            ogi.event_listing.copy.listing_code
            for ogi in w.offer_group.items.all()
            if ogi.event_listing.active
        }
        for it in w.want_group.items.all():
            bid = resolve_bid(w.user, w.event, it)
            if bid is None:
                continue
            bid_cents = _to_cents(bid)
            codes = _expand([it], w.user_id, by_game, by_id, blocked)
            codes = [c for c in codes if c not in give_codes]
            for code in codes:
                key = (username, code)
                if key not in bid_map or bid_cents > bid_map[key]:
                    bid_map[key] = bid_cents
```

Remove the now-unused `from trades.models import OfferGroupItem` import at the top of the function (line ~219).

- [ ] **Step 5: Rewrite the ONETOONE money comment lines in `_build_placeholder_header`**

In `_build_placeholder_header` (lines ~182-199), replace the buy/sell comment loops:

```python
        from trades.pricing import resolve_ask, resolve_bid
        # Buy side (P): max the user pays to receive a wanted game.
        for it in w.want_group.items.all():
            bid = resolve_bid(w.user, w.event, it)
            if bid is None:
                continue
            if it.target_type == WantGroupItem.TargetType.BOARD_GAME:
                token = f"game={it.board_game_id}"
            else:
                el = by_id.get(it.event_listing_id)
                token = f"listing={el.copy.listing_code}" if el else f"listing_id={it.event_listing_id}"
            lines.append(f"#! MONEY-WANT ({w.user.username}) {token} max={bid:.2f}")
        # Sell side (Q): min the user accepts to give one of their listings.
        for ogi in w.offer_group.items.all():
            ask = resolve_ask(ogi.event_listing)
            if ask is None:
                continue
            lines.append(
                f"#! MONEY-OFFER ({w.user.username}) "
                f"listing={ogi.event_listing.copy.listing_code} min={ask:.2f}"
            )
```

> `w.event` is available on `TradeWish`. `it.board_game_id` is the bgg_id (FK pk).

- [ ] **Step 6: Run the money tests — verify pass**

Run: `cd backend && python manage.py test matching.test_external_solver -v 2`
Expected: PASS (all export tests).

- [ ] **Step 7: Run full suite**

Run: `cd backend && python manage.py test -v 1`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat(pricing): solver export reads resolved ask/bid"
```

---

## Task 4: UserGamePrice upsert endpoint

`PUT /api/events/{slug}/game-prices/` body `{board_game, price}` — idempotent upsert for `request.user`. `GET` lists the user's prices. `DELETE` via `?board_game=` clears one.

> **Not gated by `inputs_locked`** — price endpoints (game-prices, want-bids, listing sell_price PATCH) are tunable at any event lifecycle stage. The test fixture event is in MATCHING status (locked); gating would 403 these calls. Prices only take effect when an export/solve runs.

**Files:**
- Modify: `backend/trades/serializers.py` (add `UserGamePriceSerializer`)
- Modify: `backend/trades/views.py` (add `GamePriceView`)
- Modify: `backend/trades/urls.py`
- Test: `backend/trades/tests_pricing.py` (append)

- [ ] **Step 1: Write failing endpoint tests**

Append to `backend/trades/tests_pricing.py`:

```python
class GamePriceEndpointTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.user_a)
        self.url = f"/api/events/{self.slug}/game-prices/"

    def test_put_creates_then_updates(self):
        r1 = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "40.00"}, format="json")
        self.assertEqual(r1.status_code, 200, r1.data)
        self.assertEqual(UserGamePrice.objects.count(), 1)
        r2 = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "55.00"}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(UserGamePrice.objects.count(), 1)  # upsert, not duplicate
        self.assertEqual(UserGamePrice.objects.get().price, Decimal("55.00"))

    def test_get_lists_only_my_prices(self):
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40"))
        UserGamePrice.objects.create(user=self.user_b, event=self.event, board_game=self.game_brass, price=Decimal("99"))
        r = self.client.get(self.url)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(Decimal(r.data[0]["price"]), Decimal("40"))

    def test_negative_price_rejected(self):
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "-5"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        r = self.client.put(self.url, {"board_game": self.game_brass.bgg_id, "price": "40"}, format="json")
        self.assertIn(r.status_code, (401, 403))  # depends on DRF auth classes
```

- [ ] **Step 2: Run — verify fail (404, route missing)**

Run: `cd backend && python manage.py test trades.tests_pricing.GamePriceEndpointTests -v 2`
Expected: FAIL (404 / route not found).

- [ ] **Step 3: Add `UserGamePriceSerializer`**

Append to `backend/trades/serializers.py` (and add `UserGamePrice` to the model import at line 35):

```python
class UserGamePriceSerializer(serializers.ModelSerializer):
    board_game = serializers.PrimaryKeyRelatedField(
        queryset=BoardGame.objects.all(), pk_field=serializers.IntegerField()
    )
    board_game_name = serializers.CharField(source="board_game.name", read_only=True)

    class Meta:
        model = UserGamePrice
        fields = ["id", "board_game", "board_game_name", "price", "updated"]
        read_only_fields = ["id", "board_game_name", "updated"]

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("price cannot be negative.")
        return value
```

- [ ] **Step 4: Add `GamePriceView`**

Append to `backend/trades/views.py` (add imports: `from .models import ... UserGamePrice`, `from .serializers import ... UserGamePriceSerializer`):

```python
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
        UserGamePrice.objects.filter(
            user=request.user, event=event, board_game_id=bgg_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Register the route**

In `backend/trades/urls.py`, import `GamePriceView` and add:

```python
    path(
        "events/<slug:slug>/game-prices/",
        GamePriceView.as_view(),
        name="game-price",
    ),
```

- [ ] **Step 6: Run — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing.GamePriceEndpointTests -v 2`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/trades/serializers.py backend/trades/views.py backend/trades/urls.py backend/trades/tests_pricing.py
git commit -m "feat(pricing): game-prices upsert endpoint"
```

---

## Task 5: WantBid upsert endpoint

`PUT /api/events/{slug}/want-bids/` body `{target_type, board_game|event_listing, amount}` — upsert keyed by target. `GET` lists, `DELETE` clears by target.

**Files:**
- Modify: `backend/trades/serializers.py` (`WantBidSerializer`)
- Modify: `backend/trades/views.py` (`WantBidView`)
- Modify: `backend/trades/urls.py`
- Test: `backend/trades/tests_pricing.py` (append)

- [ ] **Step 1: Write failing tests**

```python
class WantBidEndpointTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.user_a)
        self.url = f"/api/events/{self.slug}/want-bids/"

    def test_put_board_game_upsert(self):
        body = {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id, "amount": "25"}
        r1 = self.client.put(self.url, body, format="json")
        self.assertEqual(r1.status_code, 200, r1.data)
        r2 = self.client.put(self.url, {**body, "amount": "30"}, format="json")
        self.assertEqual(WantBid.objects.count(), 1)
        self.assertEqual(WantBid.objects.get().amount, Decimal("30"))

    def test_put_listing_target(self):
        body = {"target_type": "LISTING", "event_listing": self.el_b1.id, "amount": "12"}
        r = self.client.put(self.url, body, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(WantBid.objects.get().event_listing_id, self.el_b1.id)

    def test_board_game_with_listing_rejected(self):
        body = {"target_type": "BOARD_GAME", "board_game": self.game_terra.bgg_id,
                "event_listing": self.el_b1.id, "amount": "5"}
        r = self.client.put(self.url, body, format="json")
        self.assertEqual(r.status_code, 400)
```

- [ ] **Step 2: Run — verify fail**

Run: `cd backend && python manage.py test trades.tests_pricing.WantBidEndpointTests -v 2`
Expected: FAIL (404).

- [ ] **Step 3: Add `WantBidSerializer`**

Append to `backend/trades/serializers.py` (import `WantBid`):

```python
class WantBidSerializer(serializers.ModelSerializer):
    board_game = serializers.PrimaryKeyRelatedField(
        queryset=BoardGame.objects.all(), pk_field=serializers.IntegerField(),
        required=False, allow_null=True,
    )
    event_listing = serializers.PrimaryKeyRelatedField(
        queryset=EventListing.objects.all(), required=False, allow_null=True,
    )

    class Meta:
        model = WantBid
        fields = ["id", "target_type", "board_game", "event_listing", "amount", "updated"]
        read_only_fields = ["id", "updated"]

    def validate(self, data):
        tt = data.get("target_type")
        bg = data.get("board_game")
        el = data.get("event_listing")
        if tt == WantBid.TargetType.BOARD_GAME:
            if not bg:
                raise serializers.ValidationError({"board_game": "required for BOARD_GAME."})
            if el:
                raise serializers.ValidationError({"event_listing": "must be null for BOARD_GAME."})
        elif tt == WantBid.TargetType.LISTING:
            if not el:
                raise serializers.ValidationError({"event_listing": "required for LISTING."})
            if bg:
                raise serializers.ValidationError({"board_game": "must be null for LISTING."})
        else:
            raise serializers.ValidationError({"target_type": f"Invalid: {tt}"})
        if data.get("amount") is not None and data["amount"] < 0:
            raise serializers.ValidationError({"amount": "amount cannot be negative."})
        return data
```

- [ ] **Step 4: Add `WantBidView`**

Append to `backend/trades/views.py` (import `WantBid`, `WantBidSerializer`):

```python
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
        f = {"user": request.user, "event": event}
        if request.query_params.get("board_game"):
            f["board_game_id"] = request.query_params["board_game"]
        if request.query_params.get("event_listing"):
            f["event_listing_id"] = request.query_params["event_listing"]
        WantBid.objects.filter(**f).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Register route**

In `backend/trades/urls.py`, import `WantBidView` and add:

```python
    path(
        "events/<slug:slug>/want-bids/",
        WantBidView.as_view(),
        name="want-bid",
    ),
```

- [ ] **Step 6: Run — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing.WantBidEndpointTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/trades/serializers.py backend/trades/views.py backend/trades/urls.py backend/trades/tests_pricing.py
git commit -m "feat(pricing): want-bids upsert endpoint"
```

---

## Task 6: EventListing.sell_price PATCH

Add `PATCH /api/events/{slug}/listings/{id}/` (owner-only) to set `sell_price`. The `listing_detail` action currently handles only DELETE.

**Files:**
- Modify: `backend/events/views.py:337-350` (`listing_detail`)
- Modify: `backend/events/serializers.py:169-208` (`EventListingSerializer` — make `sell_price` writable)
- Test: `backend/events/tests.py` (append a small class) or `backend/trades/tests_pricing.py`

- [ ] **Step 1: Write failing test**

Append to `backend/trades/tests_pricing.py`:

```python
class SellPricePatchTests(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.url = f"/api/events/{self.slug}/listings/{self.el_a1.id}/"

    def test_owner_sets_sell_price(self):
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": "18.50"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.el_a1.refresh_from_db()
        self.assertEqual(self.el_a1.sell_price, Decimal("18.50"))

    def test_non_owner_forbidden(self):
        self.client.force_authenticate(user=self.user_b)
        r = self.client.patch(self.url, {"sell_price": "1"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_clear_sell_price_with_null(self):
        self.el_a1.sell_price = Decimal("9")
        self.el_a1.save(update_fields=["sell_price"])
        self.client.force_authenticate(user=self.user_a)
        r = self.client.patch(self.url, {"sell_price": None}, format="json")
        self.assertEqual(r.status_code, 200)
        self.el_a1.refresh_from_db()
        self.assertIsNone(self.el_a1.sell_price)
```

- [ ] **Step 2: Run — verify fail (405 method not allowed)**

Run: `cd backend && python manage.py test trades.tests_pricing.SellPricePatchTests -v 2`
Expected: FAIL — PATCH not handled (405).

- [ ] **Step 3: Make `sell_price` writable in `EventListingSerializer`**

In `backend/events/serializers.py`, add `"sell_price"` to `EventListingSerializer.Meta.fields` (keep it OUT of `read_only_fields`). Add an explicit field so null clears it:

```python
    sell_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )

    def validate_sell_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("sell_price cannot be negative.")
        return value
```

- [ ] **Step 4: Handle PATCH in `listing_detail`**

In `backend/events/views.py`, change the `listing_detail` action decorator to include `patch` and branch:

```python
    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"listings/(?P<listing_id>[^/.]+)",
    )
    def listing_detail(self, request, slug=None, listing_id=None):
        event = self._resolve_event(slug)   # use the existing resolver in this file
        listing = get_object_or_404(EventListing, pk=listing_id, event=event)
        if listing.copy.owner != request.user:
            raise PermissionDenied("Only the copy owner can modify this listing.")
        if request.method == "DELETE":
            if event.inputs_locked:
                raise PermissionDenied("Listings are locked — this event has moved to matching.")
            listing.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        # PATCH — sell price (allowed even after lock so prices can be tuned)
        ser = EventListingSerializer(
            listing, data=request.data, partial=True, context={"request": request}
        )
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
```

> Match the existing event-resolution helper name used elsewhere in `TradeEventViewSet` (grep the file for how `listings` resolves `event`; reuse that exact call instead of `_resolve_event` if it differs).

- [ ] **Step 5: Run — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing.SellPricePatchTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full suite**

Run: `cd backend && python manage.py test -v 1`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/events/views.py backend/events/serializers.py backend/trades/tests_pricing.py
git commit -m "feat(pricing): PATCH listing sell_price (owner-only)"
```

---

## Task 7: Expose resolved ask/bid + is_override on reads

So the UI can show effective price and whether it's an override or the game default.

**Files:**
- Modify: `backend/events/serializers.py` (`EventListingSerializer`: add `resolved_ask`, `ask_is_override`)
- Modify: `backend/trades/serializers.py` (`WantGroupItemSerializer`: add `resolved_bid`, `bid_is_override`)
- Test: `backend/trades/tests_pricing.py` (append)

- [ ] **Step 1: Write failing tests**

```python
class ResolvedReadFieldTests(MatchingTestBase):
    def test_listing_resolved_ask_and_override_flag(self):
        UserGamePrice.objects.create(user=self.user_a, event=self.event, board_game=self.game_brass, price=Decimal("40"))
        from events.serializers import EventListingSerializer
        data = EventListingSerializer(self.el_a1, context={"request": None}).data
        self.assertEqual(Decimal(data["resolved_ask"]), Decimal("40"))
        self.assertFalse(data["ask_is_override"])
        self.el_a1.sell_price = Decimal("33")
        self.el_a1.save(update_fields=["sell_price"])
        data = EventListingSerializer(self.el_a1, context={"request": None}).data
        self.assertEqual(Decimal(data["resolved_ask"]), Decimal("33"))
        self.assertTrue(data["ask_is_override"])
```

- [ ] **Step 2: Run — verify fail (KeyError 'resolved_ask')**

Run: `cd backend && python manage.py test trades.tests_pricing.ResolvedReadFieldTests -v 2`
Expected: FAIL.

- [ ] **Step 3: Add resolved fields to `EventListingSerializer`**

In `backend/events/serializers.py`, add to `EventListingSerializer`:

```python
    resolved_ask    = serializers.SerializerMethodField()
    ask_is_override = serializers.SerializerMethodField()

    def get_resolved_ask(self, obj):
        from trades.pricing import resolve_ask
        v = resolve_ask(obj)
        return str(v) if v is not None else None

    def get_ask_is_override(self, obj):
        return obj.sell_price is not None
```

Add `"resolved_ask"`, `"ask_is_override"` to both `fields` and `read_only_fields`.

- [ ] **Step 4: Add resolved bid to `WantGroupItemSerializer`**

In `backend/trades/serializers.py`, add to `WantGroupItemSerializer` (needs `user` + `event` in context — they are passed from the view's `_serializer_context`):

```python
    resolved_bid    = serializers.SerializerMethodField()
    bid_is_override = serializers.SerializerMethodField()

    def get_resolved_bid(self, obj):
        from trades.pricing import resolve_bid
        event = self.context.get("event")
        user = obj.want_group.user if obj.pk else self.context.get("request").user
        if event is None:
            return None
        v = resolve_bid(user, event, obj)
        return str(v) if v is not None else None

    def get_bid_is_override(self, obj):
        from trades.models import WantBid
        event = self.context.get("event")
        if event is None or not obj.pk:
            return False
        if obj.target_type == WantGroupItem.TargetType.BOARD_GAME:
            return WantBid.objects.filter(
                user=obj.want_group.user, event=event,
                target_type=WantBid.TargetType.BOARD_GAME, board_game_id=obj.board_game_id,
            ).exists()
        return WantBid.objects.filter(
            user=obj.want_group.user, event=event,
            target_type=WantBid.TargetType.LISTING, event_listing_id=obj.event_listing_id,
        ).exists()
```

Add `"resolved_bid"`, `"bid_is_override"` to `fields` and `read_only_fields`.

> The nested `WantGroupItemSerializer` is constructed by `WantGroupSerializer(many=True)`; DRF propagates parent context to children, so `event` is available on reads via the view context. On writes the method short-circuits on `obj.pk` being unset.

- [ ] **Step 5: Run — verify pass**

Run: `cd backend && python manage.py test trades.tests_pricing.ResolvedReadFieldTests -v 2`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `cd backend && python manage.py test -v 1`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/events/serializers.py backend/trades/serializers.py backend/trades/tests_pricing.py
git commit -m "feat(pricing): expose resolved_ask/resolved_bid + override flags on reads"
```

---

## Task 8: Frontend API layer (types + calls)

**Files:**
- Modify: `frontend/src/api/trades.ts`
- Modify: `frontend/src/api/events.ts`

- [ ] **Step 1: Add types + calls in `trades.ts`**

Add to `frontend/src/api/trades.ts`:

```typescript
export interface GamePrice {
  id: number
  board_game: number
  board_game_name: string
  price: string
  updated: string
}

export const listGamePrices = (slug: string) =>
  client.get<GamePrice[]>(`/events/${slug}/game-prices/`).then((r) => r.data)

export const setGamePrice = (slug: string, board_game: number, price: string) =>
  client.put<GamePrice>(`/events/${slug}/game-prices/`, { board_game, price }).then((r) => r.data)

export interface WantBidPayload {
  target_type: 'BOARD_GAME' | 'LISTING'
  board_game?: number | null
  event_listing?: number | null
  amount: string
}

export const setWantBid = (slug: string, body: WantBidPayload) =>
  client.put(`/events/${slug}/want-bids/`, body).then((r) => r.data)
```

(Use the existing `client` import already present in the file.)

- [ ] **Step 2: Add listing sell-price call in `events.ts`**

Add to `frontend/src/api/events.ts`:

```typescript
export const setListingSellPrice = (slug: string, listingId: number, sell_price: string | null) =>
  client.patch(`/events/${slug}/listings/${listingId}/`, { sell_price }).then((r) => r.data)
```

Add `resolved_ask?: string | null` and `ask_is_override?: boolean` to the existing `EventListing` TS interface in this file.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from these files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/trades.ts frontend/src/api/events.ts
git commit -m "feat(pricing): FE api for game-prices, want-bids, listing sell_price"
```

---

## Task 9: Frontend — per-copy sell price in "My Listings in This Event"

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

- [ ] **Step 1: Locate the "My Listings in This Event" section**

Run: `cd frontend && grep -n "My Listings\|listings\|EventListing" src/features/events/EventDetailPage.tsx | head`
Identify the list render of the current user's own listings.

- [ ] **Step 2: Add an editable sell-price field per copy**

For each of the user's own listings, render a price input bound to `listing.resolved_ask` showing whether it's an override (`ask_is_override`) vs the game default (e.g. show muted placeholder when it's a default). On blur/save call `setListingSellPrice(slug, listing.id, value || null)` and refresh the listing. Example cell:

```tsx
<input
  type="number"
  step="0.01"
  min="0"
  defaultValue={listing.ask_is_override ? listing.resolved_ask ?? '' : ''}
  placeholder={listing.resolved_ask && !listing.ask_is_override ? `default ${listing.resolved_ask}` : 'price'}
  onBlur={async (e) => {
    const v = e.target.value.trim()
    await setListingSellPrice(slug, listing.id, v === '' ? null : v)
    await reloadListings()
  }}
/>
```

Only render this when `event.money_enabled`.

- [ ] **Step 3: Manual verify**

Run the app (`/run` skill or `cd frontend && npm run dev` + backend). On a money-enabled event, set a per-copy price, reload, confirm it persists and shows as an override. Clear it, confirm it falls back to the game default placeholder.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(pricing): per-copy sell price input in My Listings"
```

---

## Task 10: Frontend — Catalog per-game price

The "Catalog" is the game-browse surface in `MyWantsPage.tsx`, which already tracks `baseMoneyByGame` (a per-game buy price). Extend it to persist as a `UserGamePrice` (one number per game, defaulting both sell and buy).

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

- [ ] **Step 1: Load existing game prices on mount**

Call `listGamePrices(slug)` and seed the per-game price map from it (replacing the old derivation from `item.money_amount`, lines ~150-172).

- [ ] **Step 2: Persist on edit**

Where the per-game price input changes (currently writing `baseMoneyByGame`), call `setGamePrice(slug, gameId, value)` (debounced or on blur). Remove the path that wrote price into want-group `money_amount`.

- [ ] **Step 3: Label it as the price that applies to every copy**

Update the field label/help text to state it sets the default price for all copies of that game (sell) and the bid if wanted.

- [ ] **Step 4: Manual verify**

In the Catalog, set a price for a game you own copies of; confirm the per-copy listings (Task 9) now show that as their default; confirm `listGamePrices` returns it after reload.

- [ ] **Step 5: Type-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(pricing): Catalog per-game price persists to UserGamePrice"
```

---

## Task 11: Frontend — advanced X-to-Y builder

Wishes tab gets a per-target bid override (`WantBid`); the OfferGroup per-item price input is removed and replaced by the read-only resolved sell price.

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`

- [ ] **Step 1: Remove OfferGroup price input**

Remove the per-`OfferGroupItem` `money_amount` input and its `item_money` payload (lines referencing `money_amount` in the offer/give UI). In its place show the listing's `resolved_ask` read-only (from the listing data), labelled "sell price (set in My Listings / Catalog)".

- [ ] **Step 2: Wishes tab — per-target bid override**

For each wish target, render a bid input bound to `resolved_bid`/`bid_is_override`. On save call `setWantBid(slug, { target_type, board_game | event_listing, amount })`. Stop sending `money_amount` in the want-group `items` payload (it is being removed in Task 12).

- [ ] **Step 3: Remove `money_amount` from want-group create/update payloads**

In the save path (lines ~778, 811, 832, 849-861, 971), drop `money_amount` from the item objects sent to `want-groups/`.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only where `money_amount` is still referenced — remove those references until clean.

- [ ] **Step 5: Manual verify**

In the advanced builder, set a wish bid → confirm `want-bids` PUT fires and `resolved_bid` reflects it on reload; confirm the offer side shows read-only resolved sell price and no editable price input.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat(pricing): builder uses WantBid + read-only resolved sell price"
```

---

## Task 12: Remove the old `money_amount` fields

Now nothing reads/writes them. Delete the model fields, strip serializer remnants, drop remaining FE references.

**Files:**
- Modify: `backend/trades/models.py` (drop `OfferGroupItem.money_amount`, `WantGroupItem.money_amount`)
- Modify: `backend/trades/serializers.py` (drop `money_amount` from `OfferGroupItemSerializer`/`WantGroupItemSerializer`; drop `item_money` from `OfferGroupSerializer` + its `_money_map`/create/update usage)
- Modify: `frontend/src/api/trades.ts`, `MyWantsPage.tsx`, `WantListBuilderPage.tsx` (remove any leftover `money_amount`)

- [ ] **Step 1: Grep for all remaining references**

Run: `grep -rn "money_amount\|item_money" backend/ frontend/src/`
Expected: only the definitions/usages this task removes (tests should already be migrated in Task 3). Fix any stragglers found.

- [ ] **Step 2: Remove model fields**

Delete `money_amount` from `OfferGroupItem` (trades/models.py:75-77) and `WantGroupItem` (trades/models.py:168-170), plus the now-stale comments referencing Q/P on those fields.

- [ ] **Step 3: Strip serializer remnants**

- `OfferGroupItemSerializer`: remove `"money_amount"` from `fields`.
- `OfferGroupSerializer`: remove the `item_money` field, `_money_map`, and `money_map` usage in `create`/`update` (the `OfferGroupItem.objects.create(...)` calls drop the `money_amount=` kwarg).
- `WantGroupItemSerializer`: remove `"money_amount"` from `fields` and the `money` negative-check block in `validate`.

- [ ] **Step 4: Make migration**

Run: `cd backend && python manage.py makemigrations trades`
Expected: a migration removing both fields.

- [ ] **Step 5: Remove leftover FE references**

In `frontend/src/api/trades.ts` remove `money_amount` from the want/offer item interfaces. Confirm `MyWantsPage.tsx` / `WantListBuilderPage.tsx` no longer reference it.

- [ ] **Step 6: Run full backend suite + FE type-check**

Run: `cd backend && python manage.py test -v 1`
Expected: all green.
Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Reset + reseed the dev DB (per spec)**

Run the project's reset/seed flow (e.g. drop the dev DB, `python manage.py migrate`, then the seed command). Confirm the app boots and a money-enabled event round-trips prices end to end.

- [ ] **Step 8: Commit**

```bash
git add backend/trades/models.py backend/trades/serializers.py backend/trades/migrations frontend/src/api/trades.ts
git commit -m "refactor(pricing): drop OfferGroupItem/WantGroupItem.money_amount"
```

---

## Final verification

- [ ] `cd backend && python manage.py test` — full suite green.
- [ ] `cd frontend && npx tsc --noEmit` — clean.
- [ ] Manual end-to-end on a money-enabled XTOY event: set an Catalog game price → reflected as default on owned copies and as a bid on wants; per-copy sell override wins; per-want bid override wins; export (`/wants-export/`) shows correct `item ... ask` and `bid ...` cents; run the solver and confirm cash purchases resolve.
- [ ] `grep -rn "money_amount\|item_money" backend/ frontend/src/` returns nothing.
