# App Fixes Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four independent fixes — event photo field, lock submissions at Want-List Open (+ copy lock + combo cascade), private grid ask, and start-empty catalog wishing.

**Architecture:** Django REST backend (`backend/`) + React/TanStack-Query frontend (`frontend/`). Backend changes are computed properties + view guards + serializer field gating — no DB migration. Frontend changes are form fields, lock gates, and want-builder interaction.

**Tech Stack:** Django REST Framework, React 18 + TypeScript, react-hook-form + zod, TanStack Query, Tailwind.

## Global Constraints

- Backend tests: `cd backend && python manage.py test <dotted.path> -v 2`.
- Frontend has NO unit-test runner. Verify every frontend task with `cd frontend && npm run build` (tsc typecheck + vite build, expected: no errors) and `cd frontend && npm run lint` (expected: no warnings/errors), then the described manual check.
- No new DB columns; `submissions_locked` and `is_in_active_event` are computed properties (no migration).
- Money/solver/matching logic is untouched.
- Commit after each task with the exact message shown.

---

### Task 1: F3 backend — `resolved_ask` is owner-only

**Files:**
- Modify: `backend/events/serializers.py:183-189`
- Test: `backend/events/test_ask_privacy.py` (create)

**Interfaces:**
- Produces: `EventListingSerializer.get_resolved_ask` / `get_ask_is_override` return `null` for listings the requester does not own.

- [ ] **Step 1: Write the failing test**

Create `backend/events/test_ask_privacy.py`:

```python
"""resolved_ask is private: only the copy owner sees their own ask."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class AskPrivacyTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user("askowner", "o@t.test", "pass1234")
        cls.other = User.objects.create_user("askother", "x@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=22200, name="Priced")
        cls.event = TradeEvent.objects.create(
            name="Ask Ev", organizer=cls.owner, status="WANTLIST_OPEN",
            money_enabled=True,
        )
        copy = Copy.objects.create(owner=cls.owner, board_game=cls.bg,
                                   condition="GOOD", language="EN")
        cls.listing = EventListing.objects.create(
            event=cls.event, copy=copy, sell_price="12.50"
        )

    def _ask_for(self, requester):
        self.client.force_authenticate(requester)
        resp = self.client.get(f"/api/events/{self.event.slug}/listings/")
        self.assertEqual(resp.status_code, 200)
        return resp.data["results"][0]["resolved_ask"]

    def test_owner_sees_own_ask(self):
        self.assertEqual(self._ask_for(self.owner), "12.50")

    def test_other_user_cannot_see_ask(self):
        self.assertIsNone(self._ask_for(self.other))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test events.test_ask_privacy -v 2`
Expected: `test_other_user_cannot_see_ask` FAILS (other user sees `"12.50"`, not `None`).

- [ ] **Step 3: Gate the two methods on ownership**

In `backend/events/serializers.py`, replace the existing methods (lines 183-189):

```python
    def get_resolved_ask(self, obj):
        request = self.context.get("request")
        if request is None or obj.copy.owner_id != request.user.id:
            return None
        from trades.pricing import resolve_ask
        v = resolve_ask(obj)
        return f"{v:.2f}" if v is not None else None

    def get_ask_is_override(self, obj):
        request = self.context.get("request")
        if request is None or obj.copy.owner_id != request.user.id:
            return None
        return obj.sell_price is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test events.test_ask_privacy -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/events/serializers.py backend/events/test_ask_privacy.py
git commit -m "fix(events): restrict resolved_ask to the copy owner (F3 privacy)"
```

---

### Task 2: F2 backend — `submissions_locked` lock for listings + combos

**Files:**
- Modify: `backend/events/models.py:49` (status set) and `:151-154` (property)
- Modify: `backend/events/serializers.py:30` and `:34-79` (field)
- Modify: `backend/events/views.py:363` and `:416-417` (listing gates)
- Modify: `backend/events/combo_views.py:40-42`
- Test: `backend/events/test_listing_status_guard.py` (add), `backend/events/test_combos.py` (add)

**Interfaces:**
- Produces: `TradeEvent.submissions_locked` (bool property, True from `WANTLIST_OPEN` on); serialized read-only on the event endpoint.

- [ ] **Step 1: Write the failing tests**

In `backend/events/test_listing_status_guard.py`, change the import line
`from events.models import TradeEvent` to:

```python
from events.models import EventListing, TradeEvent
```

and append these methods to `ListingStatusGuardTests`:

```python
    def test_listing_create_blocked_at_wantlist_open(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.u)
        resp = self.client.post(
            f"/api/events/{self.event.slug}/listings/", {"copy": copy.id}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_listing_delete_blocked_at_wantlist_open(self):
        copy = Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")
        listing = EventListing.objects.create(event=self.event, copy=copy)
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.u)
        resp = self.client.delete(
            f"/api/events/{self.event.slug}/listings/{listing.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_event_exposes_submissions_locked(self):
        self.client.force_authenticate(self.u)
        self.event.status = "SUBMISSIONS_OPEN"
        self.event.save(update_fields=["status"])
        r1 = self.client.get(f"/api/events/{self.event.slug}/")
        self.assertFalse(r1.data["submissions_locked"])
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        r2 = self.client.get(f"/api/events/{self.event.slug}/")
        self.assertTrue(r2.data["submissions_locked"])
```

In `backend/events/test_combos.py`, append to the test class (same class that holds `test_create_blocked_when_inputs_locked`):

```python
    def test_create_blocked_at_wantlist_open(self):
        self.event.refresh_from_db()
        self.event.status = "WANTLIST_OPEN"
        self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._url(), {
            "name": "x", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test events.test_listing_status_guard events.test_combos -v 2`
Expected: the new tests FAIL — listing create/delete still allowed at `WANTLIST_OPEN`; event response has no `submissions_locked` key (KeyError); combo create allowed.

- [ ] **Step 3: Add the property to the model**

In `backend/events/models.py`, replace line 49:

```python
WANTLIST_LOCKED_STATUSES = {"MATCHING", "MATCH_REVIEW", "FINALIZATION", "SHIPPING", "ARCHIVED"}
SUBMISSIONS_LOCKED_STATUSES = {"WANTLIST_OPEN"} | WANTLIST_LOCKED_STATUSES
```

and add a property right after the existing `inputs_locked` property (after line 154):

```python
    @property
    def submissions_locked(self) -> bool:
        """True once want-lists open — listings and combos are read-only."""
        return self.status in SUBMISSIONS_LOCKED_STATUSES
```

- [ ] **Step 4: Expose it on the serializer**

In `backend/events/serializers.py`, after line 30 (`inputs_locked = ...`) add:

```python
    submissions_locked  = serializers.BooleanField(read_only=True)
```

Add `"submissions_locked",` to the `fields` list (next to `"inputs_locked",` ~line 61) and to `read_only_fields` (next to `"inputs_locked",` ~line 76).

- [ ] **Step 5: Switch the listing + combo gates**

In `backend/events/views.py`:
- `_listings_create` (line 363): change `if event.inputs_locked:` to `if event.submissions_locked:` and the message to `"Listings are locked once want-lists open."`
- `listing_detail` DELETE branch (line 416-417): change `if event.inputs_locked:` to `if event.submissions_locked:` and the message to `"Listings are locked once want-lists open."` (leave `listing.delete()` as-is; Task 3 replaces it). Leave the PATCH/`sell_price` gate (line 422) on `inputs_locked`.

In `backend/events/combo_views.py`, replace `_assert_editable` (lines 40-42):

```python
    def _assert_editable(self, event):
        if event.submissions_locked:
            raise PermissionDenied("Combos are locked once want-lists open.")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python manage.py test events.test_listing_status_guard events.test_combos -v 2`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 7: Commit**

```bash
git add backend/events/models.py backend/events/serializers.py backend/events/views.py backend/events/combo_views.py backend/events/test_listing_status_guard.py backend/events/test_combos.py
git commit -m "feat(events): lock listings and combos from Want-List Open (F2)"
```

---

### Task 3: F2 backend — deleting a listing removes its whole combo

**Files:**
- Modify: `backend/events/admin_actions.py` (add helper)
- Modify: `backend/events/views.py:48` (import) and `:418` (user delete) and `:570` (admin unlist)
- Test: `backend/events/test_combos.py` (add)

**Interfaces:**
- Consumes: `submissions_locked` gate from Task 2.
- Produces: `events.admin_actions.remove_listing(listing)` — deletes the listing and every `Combo` it belongs to.

- [ ] **Step 1: Write the failing test**

In `backend/events/test_combos.py`, append:

```python
    def test_removing_member_listing_deletes_whole_combo(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(self._url(), {
            "name": "a", "item_listing_ids": [self.el1.id, self.el2.id],
        }, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        combo_id = created.data["id"]
        resp = self.client.delete(
            f"/api/events/{self.event.slug}/listings/{self.el1.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Combo.objects.filter(pk=combo_id).exists())
```

(`Combo` is already imported at the top of `test_combos.py`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test events.test_combos.ComboTests.test_removing_member_listing_deletes_whole_combo -v 2`

(If the class name differs, run the whole module: `python manage.py test events.test_combos -v 2`.)
Expected: FAIL — the combo still exists (only its `ComboItem` was cascaded, leaving an orphan combo).

- [ ] **Step 3: Add the cascade helper**

In `backend/events/admin_actions.py`, append:

```python
def remove_listing(listing):
    """Delete an EventListing and every Combo it belongs to.

    A combo is a bundle traded as one unit; if one member leaves, the bundle is
    no longer the thing other users wished for, so the whole Combo is removed
    (not merely its ComboItem)."""
    from .models import Combo
    Combo.objects.filter(items__event_listing=listing).distinct().delete()
    listing.delete()
```

- [ ] **Step 4: Use it in both delete paths**

In `backend/events/views.py`:
- Line 48: change `from .admin_actions import kick_participant` to
  `from .admin_actions import kick_participant, remove_listing`.
- `listing_detail` DELETE (line 418): change `listing.delete()` to `remove_listing(listing)`.
- `admin_listing` (line 570): change `listing.delete()` to `remove_listing(listing)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python manage.py test events.test_combos -v 2`
Expected: PASS (all combo tests).

- [ ] **Step 6: Commit**

```bash
git add backend/events/admin_actions.py backend/events/views.py backend/events/test_combos.py
git commit -m "feat(events): removing a listing deletes its whole combo (F2)"
```

---

### Task 4: F2 backend — lock listed copies in the owner's profile

**Files:**
- Modify: `backend/copies/models.py` (add property)
- Modify: `backend/copies/serializers.py:45-74` (field)
- Modify: `backend/copies/views.py:91-106` (guards)
- Test: `backend/copies/test_event_lock.py` (create)

**Interfaces:**
- Produces: `Copy.is_in_active_event` (bool property); `CopySerializer` exposes read-only `in_active_event`; `PATCH`/`DELETE /api/copies/{id}/` return 403 while the copy is listed in a non-archived event.

- [ ] **Step 1: Write the failing tests**

Create `backend/copies/test_event_lock.py`:

```python
"""A copy listed in an active event is locked in the owner's profile."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, TradeEvent

User = get_user_model()


class CopyEventLockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = User.objects.create_user("clock", "c@t.test", "pass1234")
        cls.bg = BoardGame.objects.create(bgg_id=33300, name="Locked")

    def _make_copy(self):
        return Copy.objects.create(owner=self.u, board_game=self.bg,
                                   condition="GOOD", language="EN")

    def _list_in(self, copy, status_value):
        ev = TradeEvent.objects.create(name=status_value, organizer=self.u,
                                       status=status_value)
        EventListing.objects.create(event=ev, copy=copy)

    def test_edit_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "WANTLIST_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"condition": "FAIR"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_withdraw_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "SUBMISSIONS_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"status": "WITHDRAWN"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_blocked_while_listed(self):
        copy = self._make_copy()
        self._list_in(copy, "WANTLIST_OPEN")
        self.client.force_authenticate(self.u)
        resp = self.client.delete(f"/api/copies/{copy.id}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_edit_allowed_when_event_archived(self):
        copy = self._make_copy()
        self._list_in(copy, "ARCHIVED")
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"owner_notes": "ok"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_edit_allowed_when_not_listed(self):
        copy = self._make_copy()
        self.client.force_authenticate(self.u)
        resp = self.client.patch(f"/api/copies/{copy.id}/",
                                 {"owner_notes": "ok"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_serializer_exposes_in_active_event(self):
        copy = self._make_copy()
        self.client.force_authenticate(self.u)
        r1 = self.client.get(f"/api/copies/{copy.id}/")
        self.assertFalse(r1.data["in_active_event"])
        self._list_in(copy, "WANTLIST_OPEN")
        r2 = self.client.get(f"/api/copies/{copy.id}/")
        self.assertTrue(r2.data["in_active_event"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test copies.test_event_lock -v 2`
Expected: FAIL — edits/withdraw/delete return 200/204; `in_active_event` key missing.

- [ ] **Step 3: Add the model property**

In `backend/copies/models.py`, add a property to the `Copy` class (after `recompute_pending`, before `__str__`):

```python
    @property
    def is_in_active_event(self) -> bool:
        """True while this copy is listed in a non-archived event; such a copy is
        committed and must not be edited or withdrawn from the owner's profile."""
        return self.event_listings.filter(active=True).exclude(
            event__status="ARCHIVED"
        ).exists()
```

- [ ] **Step 4: Expose `in_active_event` on the serializer**

In `backend/copies/serializers.py`, add the field declaration (after `version_name`, ~line 41):

```python
    in_active_event = serializers.BooleanField(source="is_in_active_event", read_only=True)
```

Add `"in_active_event",` to the `fields` list (after `"is_pending",`) and to `read_only_fields`.

- [ ] **Step 5: Add the guards to the view**

In `backend/copies/views.py`, add a helper after `_check_owner` (line 94) and call it from `update` and `destroy`:

```python
    def _assert_not_locked(self, instance):
        """Block edits/withdraw while the copy is committed to an active event."""
        if instance.is_in_active_event:
            raise PermissionDenied(
                "This copy is listed in an active event. Unlist it from the event "
                "before editing or withdrawing it."
            )

    def update(self, request, *args, **kwargs):
        """PATCH only; PUT not supported."""
        kwargs["partial"] = True
        instance = self.get_object()
        self._check_owner(instance)
        self._assert_not_locked(instance)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self._check_owner(instance)
        self._assert_not_locked(instance)
        return super().destroy(request, *args, **kwargs)
```

(`PermissionDenied` is already imported at the top of `copies/views.py`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python manage.py test copies.test_event_lock -v 2`
Expected: PASS (6 tests).

- [ ] **Step 7: Run the full copies + events suites (no regressions)**

Run: `cd backend && python manage.py test copies events -v 1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/copies/models.py backend/copies/serializers.py backend/copies/views.py backend/copies/test_event_lock.py
git commit -m "feat(copies): lock listed copies from edit/withdraw in profile (F2)"
```

---

### Task 5: F1 frontend — event photo field in create + edit forms

**Files:**
- Modify: `frontend/src/features/events/EventsPage.tsx:230-245` (schema), `:266-278` (defaults), `~417` (field), `:313-336` (payload)
- Modify: `frontend/src/features/events/EventDetailPage.tsx:329-344` (schema), `:370-385` (defaults), `~469` (field), `:395-418` (payload)

**Interfaces:**
- Consumes: `EventCreatePayload.image_url` (already exists in `api/events.ts`).

- [ ] **Step 1: Create form — schema + default**

In `EventsPage.tsx`, add to `createEventSchema` (after `trade_policies`, line 235):

```typescript
  image_url: z.string().max(500).optional(),
```

Add to `defaultValues` (after `trade_policies: ''`, line 271):

```typescript
      image_url: '',
```

- [ ] **Step 2: Create form — watch + field**

In `CreateEventModal`, after `const requireLocation = watch('require_location')` (line 281) add:

```typescript
  const imageUrl = watch('image_url')
```

After the Description `</div>` block (line 417), insert:

```tsx
            {/* Cover image URL */}
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Cover image URL</label>
              <input
                {...register('image_url')}
                placeholder="https://example.com/cover.jpg"
                className={inputCls(!!errors.image_url)}
              />
              {errors.image_url && (
                <p className="mt-1 text-xs text-red-600">{errors.image_url.message}</p>
              )}
              {imageUrl ? (
                <img src={imageUrl} alt="" className="mt-2 h-24 w-full rounded-xl border-2 border-ink/10 object-cover" />
              ) : null}
            </div>
```

- [ ] **Step 3: Create form — payload**

In `onSubmit`, add to the `payload` object (after `trade_policies: ...`, line 318):

```typescript
        image_url: values.image_url || undefined,
```

- [ ] **Step 4: Edit form — schema + default + watch + field + payload**

In `EventDetailPage.tsx`:
- Add to `editEventSchema` (after `trade_policies`, line 334): `  image_url: z.string().max(500).optional(),`
- Add to `defaultValues` (after `trade_policies: ...`, line 375): `      image_url: event.image_url ?? '',`
- After `const requireLocation = watch('require_location')` (line 388) add: `  const imageUrl = watch('image_url')`
- After the Description `</div>` block (line 469) insert the same Cover-image `<div>` markup as Step 2.
- In `onSubmit` payload (after `trade_policies: ...`, line 400) add: `          image_url: values.image_url ?? '',`

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: no TS errors, no lint errors.

- [ ] **Step 6: Manual check**

Start the app. Create-event modal: paste an image URL → preview renders → create → the event card shows the image. Edit an existing event: change/clear the URL → save → card updates.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/events/EventsPage.tsx frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): add cover image URL field to create/edit forms (F1)"
```

---

### Task 6: F2 frontend — gate submission UI + disable locked copies

**Files:**
- Modify: `frontend/src/api/events.ts:74` (type), `frontend/src/api/copies.ts:11-39` (type)
- Modify: `frontend/src/features/events/EventDetailPage.tsx` (MyListingsSection ~893-908, MyListingCard ~730-811, MyCombosSection :963)
- Modify: `frontend/src/features/copies/MyCopiesPage.tsx:213-333`

**Interfaces:**
- Consumes: `TradeEvent.submissions_locked` (Task 2) and `Copy.in_active_event` (Task 4).

- [ ] **Step 1: Add the type fields**

In `frontend/src/api/events.ts`, in `interface TradeEvent`, after `inputs_locked: boolean` (line 74) add:

```typescript
  submissions_locked: boolean
```

In `frontend/src/api/copies.ts`, in `interface Copy`, after `is_pending: boolean` (line 35) add:

```typescript
  in_active_event: boolean
```

- [ ] **Step 2: Gate add/remove in MyListingsSection**

In `EventDetailPage.tsx` `MyListingsSection`, after `const myListingCopyIds = ...` (line 881) add:

```typescript
  const locked = event.submissions_locked
```

Replace the "Add form" block (lines 904-908) with:

```tsx
      {/* Add form */}
      {locked ? (
        <p className="mb-4 rounded-xl border-2 border-ink/10 bg-parchment px-3 py-2 text-xs text-moss">
          Listings are locked — want-lists have opened, so copies can no longer be added or removed.
        </p>
      ) : (
        <div className="mb-4">
          <p className="text-xs text-moss mb-2">Add one of your active copies:</p>
          <AddListingForm slug={event.slug} existingCopyIds={myListingCopyIds} />
        </div>
      )}
```

In the `myListings.map` (line 923-932), pass `locked`:

```tsx
              <MyListingCard
                key={listing.id}
                event={event}
                listing={listing}
                myRating={myRatings.get(listing.board_game_id)}
                onRemove={handleRemove}
                removePending={removeListing.isPending}
                locked={locked}
              />
```

- [ ] **Step 3: Hide the Remove button when locked**

In `MyListingCard` props destructuring (lines 730-742), add `locked` to the type and params:

```tsx
function MyListingCard({
  event,
  listing,
  myRating,
  onRemove,
  removePending,
  locked,
}: {
  event: TradeEvent
  listing: EventListing
  myRating?: number
  onRemove: (listingId: number) => void
  removePending: boolean
  locked: boolean
}) {
```

Wrap the Remove button (lines 804-811) so it only renders when not locked:

```tsx
        {!locked && (
          <button
            onClick={() => setConfirmRemove(true)}
            disabled={removePending}
            className="shrink-0 rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            aria-label="Remove listing"
          >
            Remove
          </button>
        )}
```

(Leave the Min. ask input untouched — pricing stays editable during Want-List Open.)

- [ ] **Step 4: Lock combos one phase earlier**

In `MyCombosSection` (line 963), change:

```typescript
  const locked = event.submissions_locked
```

- [ ] **Step 5: Disable Edit/Withdraw on locked copies**

In `MyCopiesPage.tsx` `MyCopyCard`, after `const isPendingCopy = ...` (line 221) add:

```typescript
  const lockedInEvent = copy.in_active_event
```

Replace the Edit/Withdraw buttons (lines 311-322) with a lock-aware branch:

```tsx
              {lockedInEvent ? (
                <span
                  title="Listed in an active event — unlist it from the event before editing or withdrawing."
                  className="rounded-xl border-2 border-ink/10 px-3 py-1.5 text-xs font-semibold text-moss/50 cursor-not-allowed select-none"
                  aria-disabled="true"
                >
                  Locked (in event)
                </span>
              ) : (
                <>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setWithdrawOpen(true)}
                    className="rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Withdraw
                  </button>
                </>
              )}
```

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual check**

- Event at `WANTLIST_OPEN`: "My Listings in This Event" shows the lock note, no Add form, no Remove buttons; "My Combos" controls are hidden/disabled.
- Event at `SUBMISSIONS_OPEN`: add/remove/combo controls work as before.
- A copy listed in an active event: profile card shows "Locked (in event)", no Edit/Withdraw.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/events.ts frontend/src/api/copies.ts frontend/src/features/events/EventDetailPage.tsx frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "feat(frontend): lock submissions at Want-List Open + disable listed copies (F2)"
```

---

### Task 7: F3 frontend — show your own item ask in grid column headers

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` GridMode (1367-1374, 1416-1429, 1437-1440, 1488-1492)

**Interfaces:**
- Consumes: owner-only `EventListing.resolved_ask` (Task 1). `myListings` is the current user's listings, so `resolved_ask` is populated.

- [ ] **Step 1: Remove the spoiler fetch + map**

In `GridMode`, delete these lines (1367-1374):

```tsx
  const { data: listingsData } = useEventListings(slug, { page_size: 500 })
  const askByListing = useMemo(() => {
    const m = new Map<number, number>()
    for (const el of listingsData?.results ?? []) {
      if (el.resolved_ask != null && el.resolved_ask !== '') m.set(el.id, Number(el.resolved_ask))
    }
    return m
  }, [listingsData])
```

- [ ] **Step 2: Remove the per-row ask computation**

In the `rows.map` body, delete the `askValues`/`minAsk` lines (1437-1440):

```tsx
            const askValues = g.copyTargets
              .map((t) => askByListing.get(t.listingId))
              .filter((v): v is number => v != null)
            const minAsk = askValues.length ? Math.min(...askValues) : null
```

- [ ] **Step 3: Remove the per-row ask display**

Delete the second money block in the row header (1488-1492):

```tsx
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
                      <div className="mt-0.5 text-xs text-moss/70">
                        ask: {minAsk != null ? `$${minAsk.toFixed(2)}` : '—'}
                      </div>
                    )}
```

(Keep the "Default bidding price" block immediately above it.)

- [ ] **Step 4: Show each column's own ask in its header**

Replace the `myListings.map` `<th>` in `<thead>` (lines 1416-1429) with:

```tsx
            {myListings.map((l) => (
              <th
                key={l.id}
                className="sticky top-0 z-20 border-b border-r border-ink/15 bg-gray-50 px-1 py-2 align-bottom"
              >
                {moneyEnabled && l.resolved_ask != null && (
                  <div className="mb-1 text-center text-[10px] font-semibold text-emerald-700">
                    ${Number(l.resolved_ask).toFixed(2)}
                  </div>
                )}
                <div className="mx-auto h-28 w-8">
                  <div className="flex h-full -rotate-180 items-center justify-center [writing-mode:vertical-rl]">
                    <span className="truncate text-xs font-medium text-moss" title={l.board_game_name}>
                      {l.board_game_name}
                    </span>
                  </div>
                </div>
              </th>
            ))}
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: no errors (no unused `useMemo`/`useEventListings` — both remain used elsewhere in the file).

- [ ] **Step 6: Manual check**

Money-enabled event, Grid view: each of your item columns shows your ask `$X` at the top; no per-row "ask:" line reveals other traders' prices.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "fix(trades): grid shows your own item ask in column headers, not others' (F3)"
```

---

### Task 8: F4 frontend — start-empty wishing + merged Expand dropdown

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` GameBrowse (`toggleWant` 534-560, Expand block 706-725, offering IIFE 726-768) and GameCopies (`toggleCopy` 852-867, `toggleCombo` 890-903)

**Interfaces:**
- Consumes: `editor.addTarget`, `editor.toggle`, `groupByGame`, `groupIsOn`, `toggleGroup`, `fetchEventListings`, `listingTargetKey` (all already in scope).

- [ ] **Step 1: `toggleWant` stages copies but offers nothing, then opens the dropdown**

Replace `toggleWant` (lines 534-560) with:

```tsx
  async function toggleWant(g: { bgg_id: number; name: string }) {
    const group = groupByGame.get(g.bgg_id)
    if (group && myListings.some((l) => groupIsOn(editor, l.id, group))) {
      // Already wanted — clear every target for this game.
      myListings.forEach((l) => groupKeys(group).forEach((k) => editor.toggle(l.id, k, false)))
      return
    }
    // Stage every other-owned, in-range copy as an accepted target, but offer NO
    // items yet — the user consciously ticks which of their items offer it in the
    // dropdown (auto-opened below).
    let copies: EventListing[]
    try {
      const res = await fetchEventListings(slug, { board_game: g.bgg_id, page_size: 200 })
      copies = res.results
    } catch {
      return
    }
    copies
      .filter((c) => c.copy_owner_username !== username && !c.owner_too_far)
      .forEach((c) => {
        editor.addTarget({
          key: listingTargetKey(c.id), listingId: c.id, label: c.listing_code,
          gameId: c.board_game_id, gameName: c.board_game_name, thumbnail: c.board_game_thumbnail,
        })
      })
    setExpanded(g.bgg_id)
  }
```

- [ ] **Step 2: Add the per-item offer handler (with bootstrap)**

In `GameBrowse`, right after `toggleWant`, add:

```tsx
  // Toggle whether one of my items offers this game. If no copies are staged
  // yet, stage "any copy" for that item so the checklist isn't inert.
  async function toggleItemOffers(listing: EventListing, bggId: number) {
    const group = groupByGame.get(bggId)
    if (group && group.copyTargets.length > 0) {
      toggleGroup(editor, listing.id, group)
      return
    }
    let copies: EventListing[]
    try {
      const res = await fetchEventListings(slug, { board_game: bggId, page_size: 200 })
      copies = res.results
    } catch {
      return
    }
    copies
      .filter((c) => c.copy_owner_username !== username && !c.owner_too_far)
      .forEach((c) => {
        const key = listingTargetKey(c.id)
        editor.addTarget({
          key, listingId: c.id, label: c.listing_code,
          gameId: c.board_game_id, gameName: c.board_game_name, thumbnail: c.board_game_thumbnail,
        })
        editor.toggle(listing.id, key, true)
      })
  }
```

- [ ] **Step 3: Merge the offering checklist into the Expand dropdown**

Replace the Expand block (lines 706-725) with:

```tsx
                {open && (
                  <div className="border-t border-ink/10 bg-gray-50/60">
                    <WantGroupControls
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      customWantGroups={customWantGroups}
                    />
                    {/* Which of my items offer this game (empty by default) */}
                    <div className="border-b border-ink/10 px-3 py-2">
                      <p className="mb-1 text-[11px] font-medium text-moss/70">
                        Your items that offer this game:
                      </p>
                      <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                        {myListings.map((l) => {
                          const grp = groupByGame.get(g.bgg_id)
                          const on = !!grp && groupIsOn(editor, l.id, grp)
                          return (
                            <li key={l.id}>
                              <label className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-white">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => toggleItemOffers(l, g.bgg_id)}
                                  className="h-3 w-3 shrink-0 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="truncate text-ink" title={l.board_game_name}>
                                  {l.board_game_name}
                                </span>
                                <span className="ml-auto shrink-0 font-mono text-moss/70">{l.listing_code}</span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      myListings={myListings}
                      selectable
                      combos={combos}
                      moneyEnabled={moneyEnabled}
                    />
                  </div>
                )}
```

- [ ] **Step 4: Delete the old standalone offering panel**

Delete the entire offering IIFE block (lines 726-768 — the `{(() => { const group = groupByGame.get(g.bgg_id) ... })()}` that renders "Offering N/M of your items").

- [ ] **Step 5: Stop the autocheck-all fallback in GameCopies**

In `GameCopies`, in `toggleCopy` (lines 852-867) change:

```tsx
    const acting = offering.length ? offering : myListings
```

to:

```tsx
    const acting = offering
```

Make the identical change in `toggleCombo` (lines 890-903): `const acting = offering` (drop the `myListings` fallback).

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: no errors. (If lint flags `g.name` unused in `toggleWant`'s param type, that param is still referenced by the signature — leave as is.)

- [ ] **Step 7: Manual check**

Catalog view, money or barter event:
- Click "+ Want any copy" → the card's Expand dropdown opens; "Your items that offer this game" has NO boxes checked (no autocheck-all).
- Tick one of your items → it now offers the game; Save → reload → the offer persists.
- Tick/untick specific copies in "copies you'd accept" to refine.
- Expand a never-wished game and tick an item directly → it offers any copy (bootstrap).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(trades): catalog wishing starts empty with a single merged dropdown (F4)"
```

---

## Self-Review

**Spec coverage:**
- F1 (event photo field) → Task 5. ✓
- F2 submissions lock at Want-List Open → Task 2; combo cascade → Task 3; copy profile lock → Task 4; frontend gates + copy disable → Task 6. ✓
- F3 own-ask in grid + close API leak → Task 1 (API) + Task 7 (UI). ✓
- F4 start-empty wishing + merged dropdown → Task 8. ✓

**Placeholder scan:** none — every step shows concrete code/commands.

**Type consistency:** `submissions_locked` (model property → serializer field → TS `TradeEvent`) consistent across Tasks 2/6. `is_in_active_event` (property) → `in_active_event` (serializer/JSON/TS) consistent across Tasks 4/6. `remove_listing` name consistent across Task 3. `toggleItemOffers(listing, bggId)` signature matches its call site in Task 8.

**Note for executor:** Tasks 1-4 (backend) are independent and can be done in any order. Tasks 5-8 (frontend) depend on the matching backend task for runtime behavior but typecheck/lint independently; Task 6 needs Tasks 2 + 4 merged for the manual check to pass.
