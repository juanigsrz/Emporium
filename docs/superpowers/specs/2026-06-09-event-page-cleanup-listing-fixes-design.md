# Spec A — Event page cleanup & listing fixes

**Date:** 2026-06-09
**Status:** Approved (design)
**Area:** Event detail page (`frontend/src/features/events/EventDetailPage.tsx`)

This is the first of three independent specs carved out of a larger QOL request.
Specs B (Profile BGG hub + location autocomplete) and C (Almanac tab + enriched
dropdown) are out of scope here and get their own cycles. Coupling to remember:
**B before C** (Profile must host the BGG buttons before C strips them from My
Wants). Spec A is fully independent of both.

## Problem

On the event detail page, three issues:

1. **"All Listings" clutter.** The public `AllListingsSection` duplicates browsing
   that now belongs in the wants flow. Users will browse listings via their wants
   instead.
2. **"Copies don't update" on My Listings.** Adding a copy sometimes appears to do
   nothing. Root cause: the add-copy dropdown offers **pending/incomplete copies**
   (`is_pending=True`), but the backend rejects them with HTTP 400
   (`events/views.py:308` — "This copy is incomplete…"). The add fails, so the list
   never changes — it looks like a refresh bug, but it is a failed write.
3. **Dropdown offers things already in the event.** Should not re-offer copies the
   user already listed (this part already works at the copy level via
   `existingCopyIds`), and should not offer un-listable pending copies.

Note on caching: React Query v5 `invalidateQueries({ queryKey: listings(slug) })`
already **fuzzy-matches** the My-Listings query key
(`['events','listings',slug,{}]` partial-matches `['events','listings',slug,{user}]`).
So once invalid copies can no longer be selected, valid add/remove already refresh
the list on their own. No cache/invalidation change is required.

## Goals (success criteria)

- "All Listings" section no longer renders on the event detail page.
- The add-copy dropdown excludes: copies already listed by the user **and** pending/
  incomplete copies the backend would reject.
- Adding a complete copy makes it appear in "My Listings" without a manual refresh;
  removing makes it disappear.
- `npm run build` (tsc) and `npm run lint` (`--max-warnings 0`) are clean.

## Non-goals

- No backend changes (the `is_pending` guard and its test already exist:
  `events/test_pending_listing_guard.py`).
- No optimistic updates or invalidation rework — unnecessary once the real cause
  (failed pending-add) is removed.
- No change to multi-copy behavior: a user may still list a **second, distinct
  copy** of the same game. Exclusion is copy-level, not game-level (per decision).

## Changes — all in `EventDetailPage.tsx`

### 1. Remove the "All Listings" section
- Delete the `AllListingsSection` component (≈ lines 772–816).
- Delete its single render site (`<AllListingsSection event={event} />`, ≈ line 1060).
- Leave `useEventListings` and `Link` imports — both still used elsewhere
  (`MyListingsSection`, back-links, owner links).

### 2. Exclude pending + already-listed copies from the add dropdown
In `AddListingForm`, extend the existing filter with `!c.is_pending`:

```ts
const availableCopies = (copiesData?.results ?? []).filter(
  (c: Copy) => c.status === 'ACTIVE' && !c.is_pending && !existingCopyIds.has(c.id)
)
```

`is_pending` is already declared on the `Copy` type (`frontend/src/api/copies.ts`).
`existingCopyIds` (copy-level) already removes already-listed copies.

### 3. My Listings refresh
No code change. Resolved transitively by change #2 (no more failed pending-adds);
existing invalidation handles the refresh.

## Verification

No frontend test harness exists (only `tsc -b` build + `eslint`). Verify by:

1. `cd frontend && npm run build` — clean (also catches the unused-symbol removal).
2. `cd frontend && npm run lint` — clean.
3. Manual (run skill): open an event you participate in →
   - "All Listings" section is gone.
   - A pending/incomplete copy does **not** appear in the add dropdown.
   - Adding a complete copy → it appears in "My Listings" immediately.
   - Removing it → it disappears immediately.

## Risks

- Low. Single-file frontend change. Main risk is an orphaned import after deleting
  `AllListingsSection`; the lint/build step catches it.
