# Spec B — Profile: BGG hub + Location autocomplete

**Date:** 2026-06-09
**Status:** Approved (design)
**Area:** Profile page (`frontend/src/features/profile/ProfilePage.tsx`) + `accounts` backend (`geo.py`, `views.py`, `urls.py`).

Second of three specs from a larger QOL request. **Spec A** (event page) is done.
**Spec C** (catalog tab + enriched dropdown) follows. Coupling: **B before C** —
Profile must host the BGG buttons before C strips them from My Wants.

## Problem

1. **BGG actions live in the wrong place.** "Sync BGG wishlist" and "Import ratings
   from BGG" currently sit on the My Wants page. They are account-level actions and
   belong in the Profile.
2. **No place to review ratings.** Users can't see the game ratings they've set
   without opening the want builder.
3. **Location field gives no suggestions.** The Location input is free text,
   geocoded only on save. When the free text doesn't resolve, lat/lng stay null and
   "Location not geocoded yet…" persists. There is no typeahead of real places.

## Decisions (from brainstorming)

- Ratings tab is **review-only**: list + client-side filter of ratings you've
  already set, plus the BGG ratings-import button. No inline editing, no global
  catalog search. (Setting ratings happens via BGG import and, later, the catalog in
  Spec C.)
- **No buy-price in the Profile.** Buy-price is per-event (lives on `WantGroupItem`);
  it is not shown or aggregated here. Ratings are global and shown as-is.
- **Location:** backend Nominatim proxy + debounced typeahead; selecting a suggestion
  fills the canonical place name; the existing save-time `geocode()` resolves coords.
  No new writable lat/lng plumbing.

## Goals (success criteria)

- Profile **Wishlist tab** has a working "Sync BGG wishlist" button that populates
  the wishlist list.
- Profile has a new **Ratings tab**: "Import ratings from BGG" button + a filterable,
  read-only list of the user's game ratings (name + value).
- Typing in the **Location** field shows real-place suggestions; picking one and
  saving resolves coordinates (the "not geocoded" message clears).
- `GET /api/geocode/search?q=` returns suggestions; backend suite green.
- `npm run build` and `npm run lint` (`--max-warnings 0`) clean.

## Non-goals

- Do **not** remove the BGG buttons from My Wants — that is Spec C. They will exist
  in both places until C lands.
- No editing of ratings in the Profile; no global-catalog game search there.
- No new model or writable coordinate fields. Save-time geocoding is unchanged.

## Architecture & data flow

### Backend — geocode search proxy

`accounts/geo.py`: add `geocode_search(query, limit=5) -> list[dict]`, mirroring the
existing `geocode()`. Calls Nominatim `/search` with the configured
`NOMINATIM_USER_AGENT`; returns `[{ "display_name": str, "lat": float, "lon": float }]`.
Blank/whitespace query → `[]`. Network/parse errors → `[]` (best-effort, like
`geocode`).

`accounts/views.py`: add `GeocodeSearchView` (auth required, `IsAuthenticated`).
`GET /api/geocode/search?q=<text>` → `200 [ {display_name, lat, lon}, … ]`.
Short/blank `q` (e.g. `len(q.strip()) < 3`) → `200 []`. Wire the route in
`accounts/urls.py` as `geocode/search/`.

This is the only backend change. The existing save-time geocode flow in
`ProfileSerializer.update` is untouched — a canonical Nominatim `display_name`
re-resolves reliably on save.

### Frontend — Profile page

`frontend/src/features/profile/ProfilePage.tsx`:

- **`BggImportButton`** — small local component (used twice in this file):
  props `{ kind: 'WISHLIST' | 'RATINGS', label, onDone }`. Wraps
  `useStartImport` + `useImportJob` polling + a status line, gated on
  `profile.bgg_username` (else a "Set BGG username" link, matching My Wants).
  Calls `onDone()` when the job reaches `DONE`.
- **WishlistSection**: render `<BggImportButton kind="WISHLIST" label="Sync BGG wishlist"
  onDone={() => qc.invalidateQueries({ queryKey: ['wishlists'] })} />`.
  (`import_wishlist` writes `accounts.Wishlist` rows — confirmed.)
- **RatingsSection (new)** + a `'ratings'` tab:
  - `<BggImportButton kind="RATINGS" label="Import ratings from BGG"
    onDone={() => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] })} />`.
  - `useMyRatings()` → list of `{ board_game_name, value }`, sorted by name; a
    controlled text box filters the list client-side.
- **Location typeahead** in `ProfileEdit`: a `geocode/search` query (new API fn
  `searchGeocode(q)` in `frontend/src/api/profiles.ts`) debounced ~350ms on the
  Location value; a suggestions dropdown; clicking a suggestion sets the form's `location`
  value (via react-hook-form `setValue(..., { shouldDirty: true })`) and closes the
  dropdown. Save uses the existing PATCH path.

New tab wiring: extend the `tab` union and `tabs` array with
`{ key: 'ratings', label: 'Ratings' }`; render `<RatingsSection />` when active.

## Error handling

- `geocode_search` swallows network/JSON errors and returns `[]` (best-effort);
  the field simply shows no suggestions.
- BGG import failures surface via the job `status === 'FAILED'` → a "Sync failed.
  Check your BGG username." message (same pattern as My Wants).
- Debounced search ignores responses for stale queries (guard on current input).

## Testing

- **Backend:** `accounts/test_geocode_search.py` (mirror `test_geo.py` /
  `test_profile_geocode.py`): patch `requests.get`, assert
  `/api/geocode/search?q=Paris` returns mapped results; `q=''` and short `q` return
  `[]`; unauthenticated → 401. Run `python manage.py test`.
- **Frontend:** no test harness — `npm run build` + `npm run lint` clean, plus manual:
  - Wishlist "Sync" populates the list (with a real BGG username).
  - Ratings import populates the new Ratings tab; the filter box narrows the list.
  - Typing a city shows real suggestions; picking one + Save shows resolved
    coordinates instead of "not geocoded".

## Risks

- Nominatim rate/availability: best-effort `[]` on failure keeps the field usable.
- Debounce/race on the typeahead: guard against stale responses.
- Low overall — additive Profile UI + one read-only backend endpoint; the working
  geocode-on-save path is unchanged.
