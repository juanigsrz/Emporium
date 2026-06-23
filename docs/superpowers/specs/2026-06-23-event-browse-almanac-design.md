# Event Browse + Almanac (#7, #9) — Design

## Summary

- **#7 Event browsing:** event cover photo (URL), hide archived events from the
  default list, show the event's center as a place name (reverse-geocoded) next to
  the distance, and pin the user's joined events at the top.
- **#9 Almanac:** fix the min-rating filter to use the user's **personal** rating,
  and add top-of-list pagination (next-page button + jump-to-page).

**Repo:** Emporium. **Implementation:** two plans — 3a (event browse), 3b (almanac).

## Background

- `TradeEvent` has `center_latitude`/`center_longitude` (+ `max_distance_km`) but
  **no image and no place-name field**. `accounts/geo.py` already provides
  `haversine_km`, `geocode(address)` (forward), `geocode_search`, all using
  `settings.NOMINATIM_BASE_URL` + `NOMINATIM_USER_AGENT`. `ProfileSerializer`
  geocodes on location set (the pattern to mirror). There is **no** reverse
  geocode (coords → name) yet.
- The events list `TradeEventViewSet.get_queryset` filters by `?status=`; nothing
  excludes archived by default. `TradeEventListItem`/`TradeEvent` serializers
  expose `center_latitude`/`center_longitude`/`is_participant`.
- The almanac (`GameBrowse` in `MyWantsPage`) calls the event `games` endpoint;
  its `min_rating` currently filters `average__gte` — `average` is the **BGG**
  rating, not the user's. Personal ratings are `accounts.GameRating(user,
  board_game, value)`.

## Part 3a — Event browsing (#7)

### Backend

- **`reverse_geocode(lat, lng) -> str | None`** in `accounts/geo.py`: GET
  `{NOMINATIM_BASE_URL}/reverse?lat=&lon=&format=jsonv2` with the
  `NOMINATIM_USER_AGENT` header and a timeout; return the response's
  `display_name` (or `None` on any error/empty). Mirrors `geocode`'s style
  (best-effort, never raises out).
- **`TradeEvent.image_url`** = `CharField(max_length=500, blank=True, default="")`;
  **`TradeEvent.center_place`** = `CharField(max_length=255, blank=True,
  default="")` (the cached reverse-geocoded name). Migration.
- **Populate `center_place` on save**: in `TradeEventSerializer.create`/`update`,
  when both `center_latitude` and `center_longitude` are present and changed (or
  on first set), call `reverse_geocode` and store the result in `center_place`
  (best-effort: leave `""` on failure, never block the save). Reuse the
  Profile-geocode pattern.
- **Hide archived by default**: in `get_queryset`, when no `?status` filter is
  given, exclude `ARCHIVED`. `?status=ARCHIVED` still returns archived events.
- **Serializers**: add `image_url` (writable by organizer) and `center_place`
  (read-only) to `TradeEventSerializer` and `TradeEventListItem` serializer; allow
  `image_url` on `EventCreatePayload`/patch.

### Frontend (`EventsPage`)

- Show the event cover photo (`image_url`) on each card (fallback: a neutral
  placeholder when empty).
- Split the list: a **"Your events"** section (cards where `is_participant`) at
  the top, then the rest. (Archived already excluded by the backend default.)
- Where a card shows the distance to the event center, also show `center_place`
  (fall back to `lat, lng` coords when `center_place` is empty).
- `api/events.ts`: add `image_url` + `center_place` to the event types and the
  create/patch payload.

## Part 3b — Almanac (#9)

### Backend (`games` endpoint, `events/views.py`)

Replace the `min_rating` filter body:

```python
min_rating = request.query_params.get("min_rating")
if min_rating:
    qs = qs.filter(average__gte=float(min_rating))   # BGG average — the bug
```

with a personal-rating filter: collect the requesting user's rated board-game ids
with `value >= min_rating` (`GameRating.objects.filter(user=request.user,
value__gte=float(min_rating)).values_list("board_game_id", flat=True)`) and
restrict the game queryset to those ids. (A user with no qualifying ratings gets
an empty result — correct.)

### Frontend (`GameBrowse` pagination)

The almanac grid already paginates with controls at the bottom. Add, **above the
results**: a "Next page" button (disabled on the last page) and a **jump-to-page**
number input (1..totalPages) that sets `page`. Reuse the existing `page` /
`totalPages` state. The existing min-rating filter input is unchanged (only its
backend meaning changes).

## Testing

**3a backend:** `reverse_geocode` returns `display_name` (mock the HTTP) and
`None` on error; event create with center coords stores `center_place` (mock
`reverse_geocode`); the default events list excludes ARCHIVED while
`?status=ARCHIVED` includes them; `image_url` round-trips on create/patch.
**3a frontend:** typecheck + lint + manual (photo shows; joined section on top;
center place name beside distance).

**3b backend:** the `games` endpoint with `min_rating=8` returns only games the
user personally rated ≥ 8 (not by BGG average); no qualifying ratings → empty.
**3b frontend:** typecheck + lint + manual (top next-page + jump-to-page work).

## Files

**3a:** `backend/accounts/geo.py` (`reverse_geocode`), `backend/events/models.py`
(+`image_url`,`center_place`), `backend/events/serializers.py`,
`backend/events/views.py` (archived default), migration,
`backend/events/test_event_browse.py`; `frontend/src/api/events.ts`,
`frontend/src/features/events/EventsPage.tsx`.

**3b:** `backend/events/views.py` (`games` min_rating),
`backend/events/test_personal_rating_filter.py`;
`frontend/src/features/trades/MyWantsPage.tsx` (`GameBrowse` top pagination).

## Out of scope

- Image upload (URL only).
- Reverse-geocoding on read / for every list item (resolved once on save and
  cached in `center_place`).
- Re-resolving `center_place` in a background job if a Nominatim call failed at
  save time (best-effort; organizer can re-save to retry).
