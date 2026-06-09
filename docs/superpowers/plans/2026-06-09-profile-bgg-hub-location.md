# Profile BGG Hub + Location Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BGG wishlist-sync and ratings-import to the Profile (Wishlist tab + new Ratings tab), and give the Location field a real-place typeahead backed by a Nominatim proxy endpoint.

**Architecture:** One new read-only backend endpoint (`GET /api/geocode/search`) proxying Nominatim; everything else reuses existing hooks/serializers. Profile UI gains a shared `BggImportButton`, a review-only Ratings tab, and a debounced Location typeahead. Save-time geocoding is unchanged — selecting a suggestion just fills the canonical place name.

**Tech Stack:** Django REST Framework + `requests` (backend); React 18 + TanStack Query v5 + react-hook-form (frontend). Backend tests via `python manage.py test`; frontend has no test harness (verify with `npm run build` + `npm run lint`).

**Spec:** `docs/superpowers/specs/2026-06-09-profile-bgg-hub-location-design.md`

---

## File Structure

- Modify: `backend/accounts/geo.py` — add `geocode_search(query, limit)`.
- Modify: `backend/accounts/views.py` — add `GeocodeSearchView`; import `geocode_search`.
- Modify: `backend/accounts/urls.py` — add the `geocode/search/` route.
- Create: `backend/accounts/test_geocode_search.py` — endpoint + function tests.
- Modify: `frontend/src/api/profiles.ts` — add `GeocodeSuggestion` + `searchGeocode`.
- Modify: `frontend/src/features/profile/ProfilePage.tsx` — `BggImportButton`, Wishlist sync button, new `RatingsSection` + tab, Location typeahead.

API base path is `/api` (frontend `apiClient` prepends it; `accounts/urls.py` is mounted at `/api/`). Endpoints use trailing slashes.

---

### Task 1: Backend — geocode search endpoint (TDD)

**Files:**
- Modify: `backend/accounts/geo.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/test_geocode_search.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/accounts/test_geocode_search.py`:

```python
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class GeocodeSearchViewTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(self.u)

    def test_returns_suggestions(self):
        fake = [{"display_name": "Paris, France", "lat": 48.85, "lon": 2.35}]
        with patch("accounts.views.geocode_search", return_value=fake) as g:
            r = self.client.get("/api/geocode/search/", {"q": "Paris"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, fake)
        g.assert_called_once()

    def test_blank_query_returns_empty(self):
        r = self.client.get("/api/geocode/search/", {"q": ""})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, [])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        r = self.client.get("/api/geocode/search/", {"q": "Paris"})
        self.assertIn(r.status_code, (401, 403))


class GeocodeSearchFnTest(APITestCase):
    def test_maps_nominatim_results(self):
        from accounts.geo import geocode_search
        fake_resp = [{"display_name": "Paris, France", "lat": "48.85", "lon": "2.35"}]
        with patch("accounts.geo.requests.get") as mock_get:
            mock_get.return_value.json.return_value = fake_resp
            mock_get.return_value.raise_for_status.return_value = None
            out = geocode_search("Paris")
        self.assertEqual(out, [{"display_name": "Paris, France", "lat": 48.85, "lon": 2.35}])

    def test_short_query_skips_request(self):
        from accounts.geo import geocode_search
        with patch("accounts.geo.requests.get") as mock_get:
            out = geocode_search("Pa")
        self.assertEqual(out, [])
        mock_get.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && python manage.py test accounts.test_geocode_search -v2`
Expected: FAIL — `geocode_search` import error / 404 on the URL.

- [ ] **Step 3: Add `geocode_search` to `accounts/geo.py`**

Append to `backend/accounts/geo.py` (it already imports `requests` and `settings`):

```python
def geocode_search(query: str, limit: int = 5):
    """Return up to `limit` [{display_name, lat, lon}] suggestions, or []. Best-effort."""
    if len(query.strip()) < 3:
        return []
    try:
        resp = requests.get(
            f"{settings.NOMINATIM_BASE_URL}/search",
            params={"q": query, "format": "json", "limit": limit},
            headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:  # noqa: BLE001 — geocoding is best-effort
        return []
    return [
        {"display_name": d["display_name"], "lat": float(d["lat"]), "lon": float(d["lon"])}
        for d in data
    ]
```

- [ ] **Step 4: Add the view in `accounts/views.py`**

Add `APIView` to the rest_framework import line and import `geocode_search`. The existing import is:

```python
from rest_framework import generics, permissions, status
from rest_framework.response import Response
```

Add after it:

```python
from rest_framework.views import APIView

from .geo import geocode_search
```

Then add this view (place it after the `GameRating endpoints` block):

```python
class GeocodeSearchView(APIView):
    """GET /api/geocode/search/?q= — Nominatim place suggestions (auth required)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = request.query_params.get("q", "")
        return Response(geocode_search(q))
```

- [ ] **Step 5: Wire the route in `accounts/urls.py`**

Add `GeocodeSearchView` to the `from .views import (...)` block (keep alphabetical-ish order), and add this `path` to `urlpatterns` (e.g. after the Profiles group):

```python
    # Geocoding
    path("geocode/search/", GeocodeSearchView.as_view(), name="geocode-search"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && source venv/bin/activate && python manage.py test accounts.test_geocode_search -v2`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/geo.py backend/accounts/views.py backend/accounts/urls.py backend/accounts/test_geocode_search.py
git commit -m "feat: add /api/geocode/search Nominatim proxy endpoint"
```

---

### Task 2: Frontend API — `searchGeocode`

**Files:**
- Modify: `frontend/src/api/profiles.ts`

- [ ] **Step 1: Add the type and fetcher**

Append to `frontend/src/api/profiles.ts`:

```ts
// Geocode autocomplete
export interface GeocodeSuggestion {
  display_name: string
  lat: number
  lon: number
}

export async function searchGeocode(q: string): Promise<GeocodeSuggestion[]> {
  const { data } = await apiClient.get<GeocodeSuggestion[]>('/geocode/search/', {
    params: { q },
  })
  return data
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/profiles.ts
git commit -m "feat: add searchGeocode API client fn"
```

---

### Task 3: Frontend — BggImportButton, Wishlist sync, Ratings tab

**Files:**
- Modify: `frontend/src/features/profile/ProfilePage.tsx`

- [ ] **Step 1: Add imports**

At the top of `ProfilePage.tsx`, add these imports (alongside the existing ones):

```ts
import { useStartImport, useImportJob, type ImportKind } from '../../api/bgg'
import { useMyProfile } from '../../api/profiles'
import { useMyRatings } from '../../api/ratings'
```

- [ ] **Step 2: Add the shared `BggImportButton` component**

Add this component near the top of the file (after the imports, before `ProfileEdit`):

```tsx
// ---- Shared BGG import button (used by Wishlist + Ratings tabs) ----
function BggImportButton({
  kind,
  label,
  onDone,
}: {
  kind: ImportKind
  label: string
  onDone: () => void
}) {
  const { data: profile } = useMyProfile()
  const start = useStartImport()
  const [jobId, setJobId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const job = useImportJob(jobId)
  const running = ['PENDING', 'RUNNING'].includes(job.data?.status ?? '')

  useEffect(() => {
    if (job.data?.status === 'DONE') {
      const matched = job.data.summary?.matched ?? 0
      const skipped = job.data.summary?.skipped ?? 0
      setMsg(`Done — ${matched} matched, ${skipped} skipped.`)
      setJobId(null)
      onDone()
    } else if (job.data?.status === 'FAILED') {
      setMsg('Failed. Check your BGG username and try again.')
      setJobId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status])

  if (!profile?.bgg_username) {
    return (
      <span className="text-xs text-gray-400">
        Set your BoardGameGeek username in the Profile tab to enable.
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setMsg(null)
          start.mutateAsync({ kind }).then((j) => setJobId(j.id))
        }}
        disabled={running || start.isPending}
        className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
      >
        {running ? 'Working…' : label}
      </button>
      {msg && <span className="text-xs text-green-600">{msg}</span>}
    </div>
  )
}
```

This requires `useState` and `useEffect` — `useEffect` is added to the existing `react` import in Step 3 below if not present (`useState` is already imported).

- [ ] **Step 3: Ensure `useEffect` is imported**

The file currently imports `import { useState, useEffect } from 'react'` (used by `ProfileEdit`). Confirm both are present; if `useEffect` is missing, add it. No change if already there.

- [ ] **Step 4: Add the Wishlist sync button**

In `WishlistSection` (which already has `const qc = useQueryClient()`), add the button just inside the returned `<section>`, right after the `<h2>Wishlist</h2>` heading:

```tsx
      <div className="mb-4">
        <BggImportButton
          kind="WISHLIST"
          label="Sync BGG wishlist"
          onDone={() => qc.invalidateQueries({ queryKey: ['wishlists'] })}
        />
      </div>
```

- [ ] **Step 5: Add the `RatingsSection` component**

Add this component (after `WishlistSection`, before `ProfilePage`):

```tsx
// ---- Ratings Section (review-only) ----
function RatingsSection() {
  const qc = useQueryClient()
  const { data: ratings = [], isLoading } = useMyRatings()
  const [filter, setFilter] = useState('')

  const shown = ratings
    .filter((r) => r.board_game_name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.board_game_name.localeCompare(b.board_game_name))

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Game Ratings</h2>

      <div className="mb-4">
        <BggImportButton
          kind="RATINGS"
          label="Import ratings from BGG"
          onDone={() => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] })}
        />
      </div>

      <input
        type="text"
        placeholder="Filter your rated games…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-sm mb-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">
          {ratings.length === 0
            ? 'No ratings yet. Import from BGG or rate games in the want builder.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-w-sm">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2 gap-2">
              <span className="text-sm text-gray-800 truncate">{r.board_game_name}</span>
              <span className="text-sm font-semibold text-indigo-600">{Number(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

(`useMyRatings` returns `GameRating[]` with `{ id, board_game, board_game_name, value }` where `value` is a string — hence `Number(r.value)`.)

- [ ] **Step 6: Add the Ratings tab to `ProfilePage`**

In `ProfilePage`, widen the tab state and list, and render the section. Change:

```tsx
  const [tab, setTab] = useState<'profile' | 'blocks' | 'wishlist'>('profile')

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'blocks', label: 'Blocked Users' },
    { key: 'wishlist', label: 'Wishlist' },
  ]
```

to:

```tsx
  const [tab, setTab] = useState<'profile' | 'blocks' | 'wishlist' | 'ratings'>('profile')

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'blocks', label: 'Blocked Users' },
    { key: 'wishlist', label: 'Wishlist' },
    { key: 'ratings', label: 'Ratings' },
  ]
```

And add the render line after `{tab === 'wishlist' && <WishlistSection />}`:

```tsx
      {tab === 'ratings' && <RatingsSection />}
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/profile/ProfilePage.tsx
git commit -m "feat: profile BGG wishlist sync + ratings review tab"
```

---

### Task 4: Frontend — Location typeahead

**Files:**
- Modify: `frontend/src/features/profile/ProfilePage.tsx` (the `ProfileEdit` component)

- [ ] **Step 1: Import the geocode API + extend the form hook**

Add to the `profiles` import in `ProfilePage.tsx`:

```ts
  searchGeocode,
  type GeocodeSuggestion,
```

(so the import from `'../../api/profiles'` includes `searchGeocode` and `GeocodeSuggestion` alongside the existing names).

In `ProfileEdit`, extend the `useForm` destructure to add `setValue` and `watch`:

```tsx
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
```

- [ ] **Step 2: Add typeahead state + debounced search effect**

Inside `ProfileEdit`, after the `useForm(...)` call and before the existing `useEffect` that resets the form, add:

```tsx
  const locationValue = watch('location')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = (locationValue ?? '').trim()
    if (q.length < 3) {
      setSuggestions([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await searchGeocode(q)
        setSuggestions(res)
        setShowSuggestions(true)
      } catch {
        setSuggestions([])
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [locationValue])
```

Add `useRef` to the `react` import: change `import { useState, useEffect } from 'react'` to `import { useState, useEffect, useRef } from 'react'`.

- [ ] **Step 3: Render the Location field with its dropdown**

The fields are rendered by `textFields.map(...)`. Special-case `location` inside that callback so the dropdown attaches without reordering fields. Replace the body of the map callback so it begins with a `location` branch. The current callback starts:

```tsx
        {textFields.map(({ name, label, multiline }) => (
          <div key={name}>
            <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
              {label}
            </label>
```

Change the callback to branch on `name === 'location'` at the top:

```tsx
        {textFields.map(({ name, label, multiline }) => {
          if (name === 'location') {
            return (
              <div key={name} className="relative">
                <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                </label>
                <input
                  id="location"
                  type="text"
                  autoComplete="off"
                  {...register('location')}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    errors.location ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {suggestions.map((s) => (
                      <li key={`${s.display_name}-${s.lat}-${s.lon}`}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            skipNextSearch.current = true
                            setValue('location', s.display_name, { shouldDirty: true })
                            setShowSuggestions(false)
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-indigo-50"
                        >
                          {s.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {errors.location && (
                  <p className="mt-1 text-xs text-red-600">{errors.location?.message}</p>
                )}
              </div>
            )
          }
          return (
            <div key={name}>
              <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
                {label}
              </label>
```

Then leave the rest of the existing callback (the `multiline ? <textarea/> : <input/>` block and closing `</div>`) unchanged, and update the map's closing from `))}` to `)
        })}` to match the new arrow-function-with-body form.

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS. (Watch for the map callback brace/paren change — a mismatched `})}` vs `))}` will fail the build.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/profile/ProfilePage.tsx
git commit -m "feat: location typeahead with Nominatim suggestions"
```

---

### Task 5: Full verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && source venv/bin/activate && python manage.py test`
Expected: all pass (≥ 277 + the new geocode tests).

- [ ] **Step 2: Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both clean.

- [ ] **Step 3: Manual (run skill / `npm run dev` + backend up)**

- [ ] Profile → Wishlist tab: "Sync BGG wishlist" button present; with a BGG username set, clicking it shows "Working…", then a summary, and the wishlist list populates.
- [ ] Profile → new "Ratings" tab: "Import ratings from BGG" populates the list; the filter box narrows it; values render as numbers.
- [ ] Without a BGG username: both buttons show the "Set your BoardGameGeek username in the Profile tab" hint.
- [ ] Profile tab → Location: typing ≥3 chars (e.g. "Buen") shows real-place suggestions; clicking one fills the field and does not immediately reopen the dropdown; Save → the grey box shows "Geocoded: …" instead of "Location not geocoded yet".

---

## Self-Review

**Spec coverage:**
- Sync BGG wishlist in Wishlist tab → Task 3 Step 4. ✓
- New Ratings tab (import + review-only filterable list, no price) → Task 3 Steps 5–6. ✓
- Location typeahead via `/api/geocode/search` + save-time geocode → Tasks 1, 2, 4. ✓
- Backend test for the endpoint → Task 1. ✓
- Build/lint/suite green → Task 5. ✓
- BGG buttons NOT removed from My Wants (Spec C) → not in plan. ✓

**Placeholder scan:** none — every code step shows full code and exact commands.

**Type consistency:** `GeocodeSuggestion { display_name, lat, lon }` defined in Task 2 and consumed in Task 4. `searchGeocode(q)` signature matches. `ImportKind` ('WISHLIST'|'RATINGS') from `bgg.ts` used in Task 3. `GameRating.value` is a string → `Number(r.value)` in Task 3. Backend `geocode_search(query, limit=5)` defined in Task 1 Step 3, patched as `accounts.views.geocode_search` (imported there in Step 4) and `accounts.geo.requests.get` in the tests — consistent with the import structure.
