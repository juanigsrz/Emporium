# Events Browse Polish — Rows, Details, Location Autocomplete

**Date:** 2026-06-14
**Batch:** D (Events browse) — fourth of six platform-polish batches.
**Scope:** Frontend only. `frontend/src/api/events.ts` (type) and
`frontend/src/features/events/EventsPage.tsx` (UI). **No backend change** — the
event list endpoint already serves money + location fields.

## Problem

1. **D1** — The events browse page renders events as a 4-column card grid; each card
   is cramped and can't show much information.
2. **D2** — Cards omit useful event details (whether money trading is allowed, whether
   the event is location-gated).
3. **D3** — Creating an event requires typing raw center latitude/longitude numbers.
   Organizers should be able to type a place name and have coordinates resolved
   automatically, like the Profile page does.

## Goals

- Render each event as a full-width horizontal row that fits more information.
- Show money-trading and location-gate details on each row.
- Add a geocoded "Location" text field to the create-event form that auto-fills the
  center latitude/longitude.

## Non-Goals

- Backend changes. The list endpoint uses the shared `TradeEventSerializer`
  (`events/views.py` `TradeEventViewSet`, `serializer_class = TradeEventSerializer`,
  no `get_serializer_class` override), so `money_enabled`, `max_money_per_user`,
  `require_location`, `center_latitude`, `center_longitude`, and `max_distance_km`
  are already returned on `GET /api/events/`. Only the **frontend type** under-declares
  them.
- Persisting a free-text event location (the `TradeEvent` model has no location string
  field; the typed location is UI-only, used solely to resolve coordinates).
- Changes to the event detail page, filters, pagination, or search.

## D2 — Extend the list item type

In `frontend/src/api/events.ts`, add to `interface TradeEventListItem`:

```ts
  money_enabled: boolean
  max_money_per_user: string | null
  require_location: boolean
  center_latitude: number | null
  center_longitude: number | null
  max_distance_km: number | null
```

No API-function change — these fields already arrive in the response.

## D1 — Horizontal rows

In `EventsPage.tsx`:

- **Containers:** the loading-state grid (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`)
  and the loaded grid become a vertical stack: `space-y-3`. The loaded stack keeps the
  existing `transition-opacity` / `opacity-60` while-fetching behavior.
- **`EventCard`** becomes a horizontal row `<Link>`:
  `group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-3xl border-2 border-ink bg-cream p-4 shadow-card transition-transform hover:-translate-y-0.5`.
  - **Left** (`min-w-0 flex-1`): event name (`font-display text-base font-bold text-ink truncate`),
    optional description (`text-xs text-moss line-clamp-1`), then the meta chip row.
  - **Right** (`flex sm:flex-col items-start sm:items-end gap-2 shrink-0`): `StatusBadge`,
    then the Organizer / Joined badges (existing markup, moved here).
- **`EventCardSkeleton`** becomes a row-shaped skeleton (a `flex` row with a wide left
  block and a narrow right block), so the loading state matches.

## D2 — Meta chips (rendered in the row's left column)

Keep the three existing chips (participants, organizer, date range — same icons/markup).
Add two more, each an icon+text span in the same `flex flex-wrap … text-xs text-moss/70` row:

- **Money:** rendered only when `event.money_enabled` — label `Money allowed`, suffixed
  with ` (max $${event.max_money_per_user})` when `max_money_per_user` is non-null.
- **Location gate:** rendered only when `event.require_location` — label `Location-gated`,
  suffixed with ` (${event.max_distance_km} km)` when `max_distance_km` is non-null.

Use small inline SVG icons consistent with the existing chips (a coin/dollar glyph for
money, a map-pin glyph for location).

## D3 — Geocoded Location field in CreateEventModal

Reuse the Profile page's geocode-autocomplete pattern.

- **Imports:** add `searchGeocode` and `type GeocodeSuggestion` from `../../api/profiles`.
- **`useForm` destructure:** add `setValue` (alongside the existing `register`,
  `handleSubmit`, `watch`, `formState`).
- **Local state:** `locationQuery: string`, `suggestions: GeocodeSuggestion[]`,
  `showSuggestions: boolean`, plus a `skipNextSearch` ref to suppress the search that
  would otherwise fire right after a pick.
- **Debounced search effect:** on `locationQuery` change (skipping when `skipNextSearch`),
  trim; if `< 3` chars clear suggestions; else after 350ms call `searchGeocode(q)`,
  set suggestions, show the list. (Mirror ProfilePage lines ~139–160.)
- **UI:** inside the existing `requireLocation && (...)` block, **above** the lat/lng grid,
  add a labeled "Location (optional)" text input (`type="text"`, `autoComplete="off"`)
  bound to `locationQuery`, with a suggestion dropdown (`absolute z-30 …`) styled like the
  rest of the modal (cream/ink). Each suggestion is a `<button type="button">` using
  `onMouseDown` (preventDefault) that:
  - sets `skipNextSearch.current = true`,
  - `setValue('center_latitude', String(s.lat), { shouldValidate: false })`,
  - `setValue('center_longitude', String(s.lon), { shouldValidate: false })`,
  - `setLocationQuery(s.display_name)`,
  - hides the suggestion list.
  Add a short helper line: "Type a place to fill the center coordinates below."
- The existing Center latitude / Center longitude inputs remain unchanged (now
  auto-filled, still manually editable). No new fields are submitted; `locationQuery`
  is never sent in the create payload.

## Verification

- `cd frontend && npm run build` succeeds.
- `cd frontend && npm run lint` adds no new warnings (the pre-existing `CopyForm.tsx`
  warning is unrelated).
- Manual:
  - Events browse shows full-width rows; rows for money-enabled events show a
    "Money allowed" chip (with cap when set); location-gated events show a
    "Location-gated" chip (with radius when set).
  - Create event → check "Require … location" → the Location field appears; typing a
    place shows suggestions; picking one fills the latitude/longitude inputs; those
    inputs remain editable.

## Risk / Rollback

Low. Presentational + one additive type extension and a UI-only geocode field reusing
an existing endpoint. No backend, API-contract, or persisted-data change. Rollback =
revert the branch.
