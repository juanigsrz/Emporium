# Event Listings Polish — Card Grid, Explicit Save, More Details

**Date:** 2026-06-14
**Batch:** E (My Listings in This Event) — fifth of six platform-polish batches.
**Scope:** Frontend only, single file
`frontend/src/features/events/EventDetailPage.tsx` (the `MyListingsSection`).
No backend, API, or data-model changes.

## Problem

1. **E1** — A user's listings in an event render as a long single-column list,
   wasting the now-wide page.
2. **E2** — The Min. ask price field auto-saves on `onBlur`, whereas the want-list
   builder requires an explicit Save click. The behaviors are inconsistent.
3. **E3** — Each listing row shows little: thumbnail, name, code, rating, price. It
   omits copy condition and language already available on the listing.

## Goals

- Render listings as a responsive card grid.
- Replace per-field auto-save with an explicit Save button per listing, matching the
  want-list builder's save semantics.
- Show copy condition and language on each card.

## Non-Goals

- Backend / serializer changes (`copy_condition`, `copy_language`, `resolved_ask`,
  `ask_is_override` are already on `EventListing`).
- Changes outside `MyListingsSection` (header, budget card, add-listing form,
  matching link, deadlines).
- Want-list builder changes (batch F).

## E1 — Card grid

In `MyListingsSection`:

- Loading skeleton: `space-y-2` of `h-10` bars → `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3`
  of card-shaped skeletons (`h-28 rounded-2xl border-2 border-ink/10 bg-parchment animate-pulse`).
- Loaded list: the `space-y-2` map of row `<div>`s → a
  `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3` rendering `<MyListingCard>`
  per listing (grid density consistent with My Copies, batch C). The `removeError`
  message stays above the grid.

## E2 — Explicit Save (new `MyListingCard` component)

Per-listing controlled price state requires a child component (hooks can't run inside
a `.map`). Add `MyListingCard` (defined above `MyListingsSection`):

**Props:** `{ event: TradeEvent; listing: EventListing; myRating?: number; onRemove: (listingId: number) => void; removePending: boolean }`.

**Behavior:**
- `savedValue = listing.ask_is_override ? (listing.resolved_ask ?? '') : ''`.
- Controlled `draft` state initialized to `savedValue`; `dirty = draft.trim() !== savedValue`.
- A **Save** button, `disabled={!dirty || saving}`. On click:
  `setListingSellPrice(event.slug, listing.id, draft.trim() === '' ? null : draft.trim())`,
  then `setDraft(updated.ask_is_override ? (updated.resolved_ask ?? '') : '')` from the
  returned listing (resyncs to the server-normalized value, e.g. `"50"` → `"50.00"`,
  so the field doesn't read as dirty after a successful save), then invalidate
  `EVENTS_KEYS.listings(event.slug)`.
- Price save errors are shown inside the card (`err` state), not at section level.

The Min. ask block (input + `$` prefix + Save) renders only when `event.money_enabled`,
preserving the existing default-price placeholder
(`default ${listing.resolved_ask}` when not overridden).

The old inline `onBlur` auto-save input, the section-level `sellPriceError` state, and
the section-level `qc = useQueryClient()` (used only by that input) are removed.

## E3 — More details per card

In `MyListingCard`, a chip row (`flex flex-wrap gap-1.5 text-xs`) shows:
- condition — `listing.copy_condition` (when present),
- language — `listing.copy_language` (when present),
- rating — `Rating {myRating ?? '—'}` (moved from its own column into the chip row).

Each chip: `rounded-full border border-ink/15 px-2 py-0.5 text-moss`. The card also
keeps the thumbnail, name, `listing_code`, and Remove button (Remove moves to the
card header's top-right).

## Card structure

```
<div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-parchment p-3">
  header: thumbnail · (name + listing_code) · Remove
  chips:  condition · language · rating
  money:  Min. ask input ($ prefix) + Save     // only when money_enabled
  err:    price error (when present)
</div>
```

## Verification

- `cd frontend && npm run build` succeeds.
- `cd frontend && npm run lint` adds no new warnings (pre-existing `CopyForm.tsx`
  warning unrelated).
- Manual: listings render as a 2-col (sm) / 3-col (xl) card grid showing
  condition/language/rating. Editing Min. ask enables Save; clicking Save persists
  and the button returns to disabled; non-money events show no price/Save; Remove
  still works.

## Risk / Rollback

Low–moderate. Single-file refactor that changes one save interaction (auto-save →
explicit Save) and extracts one component. No API or data-shape change. Rollback =
revert the branch.
