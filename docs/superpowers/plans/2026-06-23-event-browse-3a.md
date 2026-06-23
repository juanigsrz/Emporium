# Event Browse 3a — Photo, Archived-Hide, Center Place, Joined-Top Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give events a cover photo, hide archived events from the default browse, show the event center as a reverse-geocoded place name, and pin the user's joined events at the top.

**Architecture:** Backend adds `image_url` + cached `center_place` to `TradeEvent` (place resolved via a new `reverse_geocode` helper on save), excludes ARCHIVED by default, and supports `?joined=1`. The `EventsPage` shows the photo + center place and a "Your events" section.

**Tech Stack:** Django/DRF (backend, `manage.py test`); React/TS (frontend, `npm run build` + eslint + manual).

**Spec:** `docs/superpowers/specs/2026-06-23-event-browse-almanac-design.md` (Part 3a).

**Repo for all tasks:** `/home/juanigsrz/Desktop/Emporium`. Backend cwd `backend/` (interpreter `./.venv/bin/python`); frontend cwd `frontend/`. FE lint baseline: ignore the pre-existing `CopyForm.tsx:15` warning; gate on the changed file via `npx eslint <file>`.

**This is Plan 3a of 2** (3b = almanac).

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/event-browse-3a
```

Expected: `Switched to a new branch 'feat/event-browse-3a'`

---

### Task 1: Backend — fields, reverse geocode, archived default, joined filter

**Files:**
- Modify: `backend/accounts/geo.py`
- Modify: `backend/events/models.py`
- Modify: `backend/events/serializers.py`
- Modify: `backend/events/views.py`
- Create: `backend/events/test_event_browse.py`
- Migration: `backend/events/migrations/` (generated)

- [ ] **Step 1: Write the failing tests**

Create `backend/events/test_event_browse.py`:

```python
"""Event browse: image_url, center_place (reverse geocode), archived default, ?joined."""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.geo import reverse_geocode
from events.models import EventParticipation, TradeEvent

User = get_user_model()
EVENTS = "/api/events/"


class EventBrowseTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = User.objects.create_user("eb_org", "ebo@t.test", "pass1234")
        cls.other = User.objects.create_user("eb_other", "ebx@t.test", "pass1234")

    def test_reverse_geocode_returns_display_name(self):
        with patch("accounts.geo.requests.get") as g:
            g.return_value.json.return_value = {"display_name": "Buenos Aires, Argentina"}
            g.return_value.raise_for_status.return_value = None
            self.assertEqual(reverse_geocode(-34.6, -58.4), "Buenos Aires, Argentina")

    def test_reverse_geocode_none_on_error(self):
        with patch("accounts.geo.requests.get", side_effect=Exception("down")):
            self.assertIsNone(reverse_geocode(-34.6, -58.4))

    def test_create_with_center_stores_place_and_image(self):
        self.client.force_authenticate(self.org)
        with patch("events.serializers.reverse_geocode", return_value="Rosario, AR") as rg:
            resp = self.client.post(EVENTS, {
                "name": "Geo Ev", "image_url": "https://x/y.png",
                "center_latitude": -32.95, "center_longitude": -60.66,
            }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["image_url"], "https://x/y.png")
        self.assertEqual(resp.data["center_place"], "Rosario, AR")
        rg.assert_called_once()

    def test_default_list_excludes_archived(self):
        TradeEvent.objects.create(name="Live", organizer=self.org, status="SUBMISSIONS_OPEN")
        TradeEvent.objects.create(name="Done", organizer=self.org, status="ARCHIVED")
        self.client.force_authenticate(self.org)
        names = {e["name"] for e in self.client.get(EVENTS).data["results"]}
        self.assertIn("Live", names)
        self.assertNotIn("Done", names)
        # explicit ?status=ARCHIVED still returns them
        arch = self.client.get(f"{EVENTS}?status=ARCHIVED").data["results"]
        self.assertTrue(any(e["name"] == "Done" for e in arch))

    def test_joined_filter(self):
        ev = TradeEvent.objects.create(name="Joined", organizer=self.other, status="WANTLIST_OPEN")
        TradeEvent.objects.create(name="NotJoined", organizer=self.other, status="WANTLIST_OPEN")
        EventParticipation.objects.create(event=ev, user=self.org)
        self.client.force_authenticate(self.org)
        names = {e["name"] for e in self.client.get(f"{EVENTS}?joined=1").data["results"]}
        self.assertEqual(names, {"Joined"})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_event_browse -v 2`
Expected: FAIL — `ImportError: cannot import name 'reverse_geocode'` (and missing fields/filters).

- [ ] **Step 3: Add `reverse_geocode`**

Append to `backend/accounts/geo.py`:

```python
def reverse_geocode(lat, lng):
    """Return a place display_name for coords, or None. Best-effort (never raises)."""
    try:
        resp = requests.get(
            f"{settings.NOMINATIM_BASE_URL}/reverse",
            params={"lat": lat, "lon": lng, "format": "jsonv2"},
            headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — geocoding is best-effort
        logger.warning("Nominatim reverse_geocode(%s,%s) failed: %s", lat, lng, exc)
        return None
    return data.get("display_name") or None
```

- [ ] **Step 4: Add the model fields**

In `backend/events/models.py`, in `TradeEvent`, after the `trade_policies`
field (`trade_policies = models.TextField(blank=True)`), add:

```python
    # Cover image (URL only; no binary upload) + cached reverse-geocoded center name.
    image_url    = models.CharField(max_length=500, blank=True, default="")
    center_place = models.CharField(max_length=255, blank=True, default="")
```

- [ ] **Step 5: Generate the migration**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py makemigrations events`
Expected: a migration adding `image_url` + `center_place`.

- [ ] **Step 6: Serializer — expose fields + resolve center_place on save**

In `backend/events/serializers.py`, add a module-level import at the top (so the
test's `patch("events.serializers.reverse_geocode")` target exists):

```python
from accounts.geo import reverse_geocode
```

Add `image_url` and `center_place` to `TradeEventSerializer.Meta.fields` (after
`trade_policies`), and add `center_place` to `read_only_fields` (image_url stays
writable). Add the resolve hook to `TradeEventSerializer`:

```python
    @staticmethod
    def _resolve_center_place(validated_data, instance):
        coords_changed = "center_latitude" in validated_data or "center_longitude" in validated_data
        if not coords_changed:
            return
        lat = validated_data.get("center_latitude", getattr(instance, "center_latitude", None))
        lng = validated_data.get("center_longitude", getattr(instance, "center_longitude", None))
        if lat is not None and lng is not None:
            validated_data["center_place"] = reverse_geocode(lat, lng) or ""
        else:
            validated_data["center_place"] = ""

    def create(self, validated_data):
        self._resolve_center_place(validated_data, None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._resolve_center_place(validated_data, instance)
        return super().update(instance, validated_data)
```

(Setting `center_place` into `validated_data` server-side persists it via the
parent create/update even though it's read-only to clients.)

Also add `image_url` to the `EventCreatePayload`/patch acceptance — it is already
covered because `image_url` is a writable serializer field on the same serializer
used for create + patch. No separate payload class exists for the API.

- [ ] **Step 7: get_queryset — archived default + `?joined`**

In `backend/events/views.py` `get_queryset`, the `?status=` block is:

```python
        # ?status=
        status_filter = params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
```

Replace with (default-exclude ARCHIVED; add `?joined=1`):

```python
        # ?status=  (default browse hides archived events)
        status_filter = params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        else:
            qs = qs.exclude(status=TradeEvent.Status.ARCHIVED)

        # ?joined=1 — events the requesting user participates in
        if params.get("joined") in ("1", "true") and self.request.user.is_authenticated:
            qs = qs.filter(participations__user=self.request.user).distinct()
```

- [ ] **Step 8: Run tests — verify they pass**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events.test_event_browse -v 2`
Expected: PASS (5 tests).

- [ ] **Step 9: Regression**

Run: `cd /home/juanigsrz/Desktop/Emporium/backend && ./.venv/bin/python manage.py test events -v 1`
Expected: PASS. (If `test_event_cycle_qa` or other list tests now see archived events excluded by default, that's the intended new behavior — confirm any failure is only an assertion expecting an archived event in the *default* list, and update that assertion to pass `?status=ARCHIVED`. Do not weaken the new default otherwise.)

- [ ] **Step 10: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add backend/accounts/geo.py backend/events/models.py backend/events/serializers.py backend/events/views.py backend/events/test_event_browse.py backend/events/migrations/
git commit -m "feat(events): image_url + reverse-geocoded center_place, hide archived, ?joined filter"
```

---

### Task 2: Frontend — photo, center place, joined-top

**Files:**
- Modify: `frontend/src/api/events.ts`
- Modify: `frontend/src/features/events/EventsPage.tsx`

- [ ] **Step 1: Extend the event API types**

In `frontend/src/api/events.ts`:
- Add `image_url: string` and `center_place: string` to both `TradeEvent` and
  `TradeEventListItem` interfaces.
- Add `image_url?: string` to `EventCreatePayload`.
- Add `joined?: boolean` to `EventsListParams`, and in `fetchEvents` send it:
  in the params-building block (after the `search` handling) add
  `if (params.joined) p.joined = '1'`.

- [ ] **Step 2: Show the cover photo + center place on `EventCard`**

In `frontend/src/features/events/EventsPage.tsx`, `EventCard`, the card is a
`<Link>` whose first child is the `{/* Left: title… */}` div. Insert a photo
thumbnail as the new first child inside the `<Link>` (before that div):

```tsx
      {event.image_url ? (
        <img
          src={event.image_url}
          alt=""
          className="h-20 w-full shrink-0 rounded-2xl object-cover sm:h-16 sm:w-16"
          loading="lazy"
        />
      ) : (
        <div className="hidden h-16 w-16 shrink-0 rounded-2xl bg-parchment sm:block" aria-hidden="true" />
      )}
```

And show the center place: replace the "Location-gated" span (the block guarded
by `event.require_location`):

```tsx
          {event.require_location && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Location-gated{event.max_distance_km ? ` (${event.max_distance_km} km)` : ''}
            </span>
          )}
```

with (append the center place when present):

```tsx
          {event.require_location && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Location-gated{event.max_distance_km ? ` (${event.max_distance_km} km)` : ''}
              {(event.center_place || (event.center_latitude != null && event.center_longitude != null)) && (
                <span className="text-moss/60">
                  · {event.center_place || `${event.center_latitude}, ${event.center_longitude}`}
                </span>
              )}
            </span>
          )}
```

- [ ] **Step 3: Add a "Your events" section at the top of `EventsPage`**

In `EventsPage`, after the existing `const { data, isLoading, isError, isFetching } = useEvents(queryParams)` line, add a joined-events query:

```tsx
  const { data: joinedData } = useEvents({ joined: true })
  const joinedEvents = token ? (joinedData?.results ?? []) : []
  const joinedSlugs = new Set(joinedEvents.map((e) => e.slug))
```

In the results area (where `data.results` is mapped into `<EventCard>`s), render
the joined section above the main list, and exclude joined events from the main
grid to avoid duplication. Wrap the main results map so each card renders only
when `!joinedSlugs.has(event.slug)`, and prepend:

```tsx
      {joinedEvents.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-ink">Your events</h2>
          <div className="grid grid-cols-1 gap-3">
            {joinedEvents.map((event) => (
              <EventCard key={event.slug} event={event} />
            ))}
          </div>
        </div>
      )}
```

(For the main results map, change `data.results.map((event) => <EventCard … />)`
to filter: `data.results.filter((e) => !joinedSlugs.has(e.slug)).map((event) => <EventCard … />)`.)

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/api/events.ts src/features/events/EventsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 5: Manual QA checklist**

- The events list shows a cover photo per event (placeholder when none); archived
  events don't appear by default (the ARCHIVED status filter still shows them).
- A "Your events" section lists the events you've joined, pinned at the top; those
  events don't also appear in the main list.
- A location-gated event shows its center place name (or coords) beside the
  "Location-gated" label.

- [ ] **Step 6: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/api/events.ts frontend/src/features/events/EventsPage.tsx
git commit -m "feat(events-fe): cover photo, center place, Your-events section"
```

---

## Self-Review

**Spec coverage (3a):**
- `reverse_geocode` helper (best-effort, Nominatim /reverse) → Task 1 ✔
- `image_url` + cached `center_place` (resolved on save) + serializers → Task 1 ✔
- Hide ARCHIVED by default; `?status=ARCHIVED` still works; `?joined=1` → Task 1 ✔
- FE: photo, center place beside distance/location, "Your events" pinned top → Task 2 ✔
- Tests (reverse_geocode ok/err, create stores place+image, archived default, joined) + FE manual → both tasks ✔

**Placeholder scan:** none.

**Type/name consistency:** `reverse_geocode(lat,lng)` defined in `accounts/geo.py`, imported in `events/serializers.py` (and patched in tests via `events.serializers.reverse_geocode`); `image_url`/`center_place` model fields + serializer fields + TS interface fields named identically; `?joined` handled in `get_queryset` and sent by `fetchEvents` when `params.joined`; `EventParticipation` related_name `participations` matches the model.

**Notes for the executor:**
- `reverse_geocode` is patched in two ways in tests: at the source (`accounts.geo.requests.get`) for the helper test, and at the import site (`events.serializers.reverse_geocode`) for the create test — make sure the serializer imports it as a name (function-local `from accounts.geo import reverse_geocode`) so the `events.serializers.reverse_geocode` patch target exists. (Use a module-level `from accounts.geo import reverse_geocode` in serializers.py so the patch target is `events.serializers.reverse_geocode`.)
- If a pre-existing events test asserted an archived event appears in the *default* list, update only that assertion to use `?status=ARCHIVED` (the new default-hide is intended).
