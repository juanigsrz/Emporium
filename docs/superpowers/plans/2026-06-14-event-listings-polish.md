# Event Listings Polish Implementation Plan

> **For agentic workers:** Single-file refactor of `MyListingsSection`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render a user's event listings as a card grid, replace per-field auto-save with an explicit Save button, and show copy condition/language/rating.

**Architecture:** All changes in `frontend/src/features/events/EventDetailPage.tsx`. A new `MyListingCard` child component holds per-listing controlled price state + Save; `MyListingsSection` switches to a grid and drops the inline auto-save input, its `sellPriceError` state, and its now-unused `qc`.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Tailwind CSS.

**Testing note:** No frontend test runner. Gate = `npm run build` + `npm run lint` (no new warnings) + manual.

---

### Task 1: Add `MyListingCard`

**Files:** Modify `frontend/src/features/events/EventDetailPage.tsx`.

- [ ] **Step 1:** Insert this component immediately above `function MyListingsSection`:
```tsx
function MyListingCard({
  event,
  listing,
  myRating,
  onRemove,
  removePending,
}: {
  event: TradeEvent
  listing: EventListing
  myRating?: number
  onRemove: (listingId: number) => void
  removePending: boolean
}) {
  const qc = useQueryClient()
  const savedValue = listing.ask_is_override ? (listing.resolved_ask ?? '') : ''
  const [draft, setDraft] = useState(savedValue)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = draft.trim() !== savedValue

  async function handleSave() {
    setErr(null)
    setSaving(true)
    try {
      const v = draft.trim()
      const updated = await setListingSellPrice(event.slug, listing.id, v === '' ? null : v)
      setDraft(updated.ask_is_override ? (updated.resolved_ask ?? '') : '')
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(event.slug) })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? 'Failed to save price.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-parchment p-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-cream">
          {listing.board_game_thumbnail ? (
            <img src={listing.board_game_thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{listing.board_game_name}</span>
          <span className="font-mono text-xs text-moss/70">{listing.listing_code}</span>
        </div>
        <button
          onClick={() => onRemove(listing.id)}
          disabled={removePending}
          className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
          aria-label="Remove listing"
        >
          Remove
        </button>
      </div>

      {/* Detail chips */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {listing.copy_condition && (
          <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">{listing.copy_condition}</span>
        )}
        {listing.copy_language && (
          <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">{listing.copy_language}</span>
        )}
        <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">
          Rating {myRating != null ? myRating : '—'}
        </span>
      </div>

      {/* Minimum ask + Save (money only) */}
      {event.money_enabled && (
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-moss/60">Min. ask</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-moss/60">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  listing.resolved_ask && !listing.ask_is_override
                    ? `default ${listing.resolved_ask}`
                    : 'price'
                }
                className="w-20 rounded-lg border-2 border-ink/15 bg-cream px-2 py-1 text-xs text-ink placeholder-moss/40 focus:outline-none focus:ring-2 focus:ring-sage"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="rounded-lg border-2 border-ink bg-butter px-3 py-1 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
```

---

### Task 2: Simplify `MyListingsSection` state

**Files:** Modify `frontend/src/features/events/EventDetailPage.tsx`.

- [ ] **Step 1:** Remove the now-unused query client. Delete this line from `MyListingsSection`:
```tsx
  const qc = useQueryClient()
```

- [ ] **Step 2:** Remove the section-level sell-price error state. Delete:
```tsx
  const [sellPriceError, setSellPriceError] = useState<string | null>(null)
```

---

### Task 3: Grid + `MyListingCard` rendering

**Files:** Modify `frontend/src/features/events/EventDetailPage.tsx`.

- [ ] **Step 1:** Replace the loading + list block. Replace:
```tsx
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : myListings.length === 0 ? (
        <p className="text-xs text-moss py-2">No copies added yet.</p>
      ) : (
        <div className="space-y-2">
          {removeError && <p className="text-xs text-red-600">{removeError}</p>}
          {sellPriceError && <p className="text-xs text-red-600">{sellPriceError}</p>}
          {myListings.map((listing) => {
            const myRating = myRatings.get(listing.board_game_id)
            return (
              <div
                key={listing.id}
                className="flex items-center gap-3 rounded-xl border-2 border-ink/10 bg-parchment px-3 py-2"
              >
                {/* Game */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-cream">
                    {listing.board_game_thumbnail ? (
                      <img src={listing.board_game_thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-ink truncate block">
                      {listing.board_game_name}
                    </span>
                    <span className="text-xs text-moss/70 font-mono">{listing.listing_code}</span>
                  </div>
                </div>

                {/* My rating — read-only, set in your profile */}
                <div className="w-14 shrink-0 text-center" title="Your rating for this game (set in your profile)">
                  <p className="text-[10px] uppercase tracking-wide text-moss/60">My rating</p>
                  <p className="text-sm font-semibold text-ink">{myRating != null ? myRating : '—'}</p>
                </div>

                {/* Minimum asking price */}
                {event.money_enabled && (
                  <div className="w-28 shrink-0">
                    <label className="block text-[10px] uppercase tracking-wide text-moss/60">Min. ask</label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-moss/60">$</span>
                      <input
                        key={`sp-${listing.id}-${listing.ask_is_override ? (listing.resolved_ask ?? '') : 'def'}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={listing.ask_is_override ? (listing.resolved_ask ?? '') : ''}
                        placeholder={
                          listing.resolved_ask && !listing.ask_is_override
                            ? `default ${listing.resolved_ask}`
                            : 'price'
                        }
                        onBlur={async (e) => {
                          setSellPriceError(null)
                          const v = e.target.value.trim()
                          try {
                            await setListingSellPrice(event.slug, listing.id, v === '' ? null : v)
                            qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(event.slug) })
                          } catch (err: unknown) {
                            setSellPriceError(extractErrorMsg(err) ?? 'Failed to save price.')
                          }
                        }}
                        className="w-20 rounded-lg border-2 border-ink/15 bg-cream px-2 py-1 text-xs text-ink placeholder-moss/40 focus:outline-none focus:ring-2 focus:ring-sage"
                      />
                    </div>
                  </div>
                )}

                {/* Remove */}
                <button
                  onClick={() => handleRemove(listing.id)}
                  disabled={removeListing.isPending}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                  aria-label="Remove listing"
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}
```
with:
```tsx
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl border-2 border-ink/10 bg-parchment animate-pulse" />
          ))}
        </div>
      ) : myListings.length === 0 ? (
        <p className="text-xs text-moss py-2">No copies added yet.</p>
      ) : (
        <div className="space-y-2">
          {removeError && <p className="text-xs text-red-600">{removeError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {myListings.map((listing) => (
              <MyListingCard
                key={listing.id}
                event={event}
                listing={listing}
                myRating={myRatings.get(listing.board_game_id)}
                onRemove={handleRemove}
                removePending={removeListing.isPending}
              />
            ))}
          </div>
        </div>
      )}
```

---

### Task 4: Build, lint, commit

- [ ] **Step 1:** `cd frontend && npm run build` → succeeds.
- [ ] **Step 2:** `cd frontend && npm run lint` → no new warnings (in particular no "unused `useQueryClient`" — it's still used by `MyListingCard`).
- [ ] **Step 3:** Commit:
```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): listings card grid, explicit ask-price save, copy details"
```

---

### Task 5: Manual verification

- [ ] My Listings renders as a 2-col (sm) / 3-col (xl) card grid with condition/language/rating chips.
- [ ] Editing Min. ask enables Save; clicking Save persists and the button returns to disabled (no false-dirty after save).
- [ ] Non-money event: no price/Save shown. Remove still works.

---

## Self-Review

- **Spec coverage:** E1 grid (skeleton + list) → Tasks 3. E2 explicit Save → Task 1 (`MyListingCard`) + Task 2 (drop `qc`/`sellPriceError`). E3 chips → Task 1. ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `MyListingCard` props match call site (`event`, `listing`, `myRating?`, `onRemove`, `removePending`). `setListingSellPrice` returns `EventListing` (has `ask_is_override`/`resolved_ask`). `useQueryClient`/`useState`/`setListingSellPrice`/`EVENTS_KEYS`/`extractErrorMsg` already imported/in-file. ✓
