# Events Browse Polish Implementation Plan

> **For agentic workers:** Frontend presentational + one geocode field. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render events as horizontal rows with money/location details, and add a geocoded Location field to the create-event form.

**Architecture:** `events.ts` extends `TradeEventListItem` with already-served fields. `EventsPage.tsx` swaps the card grid for a row stack, adds two meta chips, and adds a geocode-autocomplete Location input to `CreateEventModal` (reusing `searchGeocode`). No backend change.

**Tech Stack:** React 18 + TypeScript, react-hook-form, Tailwind CSS.

**Testing note:** Presentational; no frontend test runner. Gate = `npm run build` + `npm run lint` (no new warnings) + manual.

---

### Task 1: D2 — extend `TradeEventListItem`

**Files:** Modify `frontend/src/api/events.ts`.

- [ ] **Step 1:** In `interface TradeEventListItem`, after the `status: EventStatus` line, insert:
```ts
  money_enabled: boolean
  max_money_per_user: string | null
  require_location: boolean
  center_latitude: number | null
  center_longitude: number | null
  max_distance_km: number | null
```

---

### Task 2: D1+D2 — row layout, chips, skeleton, containers

**Files:** Modify `frontend/src/features/events/EventsPage.tsx`.

- [ ] **Step 1:** Replace the entire `EventCard` function with:
```tsx
function EventCard({ event }: { event: TradeEventListItem }) {
  const subDate = event.submissions_open_at
    ? new Date(event.submissions_open_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null
  const closeDate = event.submissions_close_at
    ? new Date(event.submissions_close_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <Link
      to={`/events/${event.slug}`}
      className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-3xl border-2 border-ink bg-cream p-4 shadow-card transition-transform hover:-translate-y-0.5"
    >
      {/* Left: title, description, meta */}
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-bold text-ink truncate leading-snug">
          {event.name}
        </h3>
        {event.description && (
          <p className="mt-0.5 text-xs text-moss line-clamp-1">{event.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-moss/70">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {event.participants_count} participant{event.participants_count !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {event.organizer_username}
          </span>
          {subDate && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {closeDate ? `${subDate} – ${closeDate}` : `Opens ${subDate}`}
            </span>
          )}
          {event.money_enabled && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Money allowed{event.max_money_per_user ? ` (max $${event.max_money_per_user})` : ''}
            </span>
          )}
          {event.require_location && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Location-gated{event.max_distance_km ? ` (${event.max_distance_km} km)` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Right: status + role badges */}
      <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
        <StatusBadge status={event.status} />
        {(event.is_organizer || event.is_participant) && (
          <div className="flex gap-1.5">
            {event.is_organizer && (
              <span className="text-xs border border-ink/15 bg-butter/60 text-ink rounded-full px-2.5 py-0.5 font-semibold">
                Organizer
              </span>
            )}
            {event.is_participant && !event.is_organizer && (
              <span className="text-xs border border-ink/15 bg-sage/60 text-ink rounded-full px-2.5 py-0.5 font-semibold">
                Joined
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2:** Replace the entire `EventCardSkeleton` function with:
```tsx
function EventCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-3xl border-2 border-ink/15 bg-cream p-4 animate-pulse">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-1/3 bg-gray-200 rounded-full" />
        <div className="h-3 w-2/3 bg-gray-200 rounded-full" />
        <div className="flex gap-3">
          <div className="h-3 w-16 bg-gray-200 rounded-full" />
          <div className="h-3 w-20 bg-gray-200 rounded-full" />
          <div className="h-3 w-24 bg-gray-200 rounded-full" />
        </div>
      </div>
      <div className="h-6 w-20 bg-gray-200 rounded-full shrink-0" />
    </div>
  )
}
```

- [ ] **Step 3:** Loading container — replace
```tsx
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
```
with
```tsx
        <div className="space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
```

- [ ] **Step 4:** Loaded container — replace
```tsx
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-opacity ${
              isFetching ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {data!.results.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
```
with
```tsx
          <div
            className={`space-y-3 transition-opacity ${
              isFetching ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {data!.results.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
```

---

### Task 3: D3 — geocoded Location field in CreateEventModal

**Files:** Modify `frontend/src/features/events/EventsPage.tsx`.

- [ ] **Step 1:** Add the import (after the `import { StatusBadge } …` line):
```tsx
import { searchGeocode, type GeocodeSuggestion } from '../../api/profiles'
```

- [ ] **Step 2:** Add `setValue` to the `useForm` destructure in `CreateEventModal`. Replace:
```tsx
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateEventFormValues>({
```
with:
```tsx
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateEventFormValues>({
```

- [ ] **Step 3:** After `const requireLocation = watch('require_location')`, add geocode state + effect:
```tsx
  const [locationQuery, setLocationQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = locationQuery.trim()
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
  }, [locationQuery])
```

- [ ] **Step 4:** Insert the Location field at the top of the `requireLocation` block. Replace:
```tsx
              {requireLocation && (
                <div className="space-y-3">
                  <p className="text-xs text-moss/70">
                    Optionally restrict to a geographic radius (leave lat/lng blank to only require location, without radius filtering).
                  </p>
```
with:
```tsx
              {requireLocation && (
                <div className="space-y-3">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-moss mb-1">Location (optional)</label>
                    <input
                      type="text"
                      autoComplete="off"
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      placeholder="Type a place to fill the coordinates…"
                      className={inputCls(false)}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border-2 border-ink/15 bg-cream shadow-card">
                        {suggestions.map((s) => (
                          <li key={`${s.display_name}-${s.lat}-${s.lon}`}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                skipNextSearch.current = true
                                setValue('center_latitude', String(s.lat), { shouldValidate: false })
                                setValue('center_longitude', String(s.lon), { shouldValidate: false })
                                setLocationQuery(s.display_name)
                                setShowSuggestions(false)
                              }}
                              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-sage/30"
                            >
                              {s.display_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-moss/70">Type a place to auto-fill the center coordinates below.</p>
                  </div>
                  <p className="text-xs text-moss/70">
                    Optionally restrict to a geographic radius (leave lat/lng blank to only require location, without radius filtering).
                  </p>
```

---

### Task 4: Build, lint, commit

- [ ] **Step 1:** `cd frontend && npm run build` → succeeds.
- [ ] **Step 2:** `cd frontend && npm run lint` → no new warnings.
- [ ] **Step 3:** Commit:
```bash
git add frontend/src/api/events.ts frontend/src/features/events/EventsPage.tsx
git commit -m "feat(events): horizontal event rows, money/location details, geocoded location field"
```

---

### Task 5: Manual verification

- [ ] Events browse renders full-width rows; money-enabled events show "Money allowed" (+ cap); location-gated events show "Location-gated" (+ radius).
- [ ] Create event → check require-location → Location field appears; typing ≥3 chars shows suggestions; picking one fills lat/lng; lat/lng remain editable.

---

## Self-Review

- **Spec coverage:** D2 type → Task 1. D1 rows + chips + skeleton + containers → Task 2. D3 geocode field → Task 3. ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** new `TradeEventListItem` fields match `TradeEvent` (`money_enabled: boolean`, `max_money_per_user: string|null`, location numerics `|null`). `setValue` targets `center_latitude`/`center_longitude` (string form fields). `GeocodeSuggestion` has `display_name/lat/lon`. ✓
