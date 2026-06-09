# Event Page Cleanup & Listing Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "All Listings" section from the event detail page and make the add-copy dropdown exclude un-addable copies, which also fixes the "copies don't update" symptom.

**Architecture:** Pure frontend change in one file (`EventDetailPage.tsx`). The "doesn't update" bug is a failed write (backend rejects pending copies with HTTP 400), not a cache bug — fixed by filtering pending copies out of the dropdown so the failing add can't be triggered. No backend or caching changes.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query v5, Tailwind. No frontend unit-test harness — verification is `tsc` build + ESLint + manual run.

**Spec:** `docs/superpowers/specs/2026-06-09-event-page-cleanup-listing-fixes-design.md`

---

## File Structure

- Modify: `frontend/src/features/events/EventDetailPage.tsx`
  - Remove `AllListingsSection` component + its render site.
  - Tighten the `availableCopies` filter in `AddListingForm`.

No other files change. `Copy.is_pending` already exists in `frontend/src/api/copies.ts`; the backend guard + its test (`backend/events/test_pending_listing_guard.py`) already exist.

---

### Task 1: Exclude pending + already-listed copies from the add dropdown

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx` (inside `AddListingForm`, ≈ lines 655–657)

- [ ] **Step 1: Edit the filter**

Find this block in `AddListingForm`:

```ts
  const availableCopies = (copiesData?.results ?? []).filter(
    (c: Copy) => c.status === 'ACTIVE' && !existingCopyIds.has(c.id)
  )
```

Replace with (adds `!c.is_pending`):

```ts
  const availableCopies = (copiesData?.results ?? []).filter(
    (c: Copy) => c.status === 'ACTIVE' && !c.is_pending && !existingCopyIds.has(c.id)
  )
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: PASS (no TS errors). `is_pending` is already typed on `Copy`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "fix: exclude pending/listed copies from event add-copy dropdown"
```

---

### Task 2: Remove the "All Listings" section

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

- [ ] **Step 1: Delete the render site**

Find and delete these two lines near the end of `EventDetailPage` (≈ line 1059–1060), just before the closing `</div>`:

```tsx
      {/* All listings */}
      <AllListingsSection event={event} />
```

- [ ] **Step 2: Delete the component**

Delete the entire `AllListingsSection` component block (≈ lines 772–816). It begins with:

```tsx
// ---- All listings section (public) ----

function AllListingsSection({ event }: { event: TradeEvent }) {
```

and ends at the component's closing brace (the function returns a `<section>…</section>`). Remove the `// ---- All listings section (public) ----` comment header too. Do **not** remove the `useEventListings`, `Link`, or `TradeEvent` imports — they are still used by `MyListingsSection`, back-links, and other components.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run build`
Expected: PASS. If it reports an unused import or undefined `AllListingsSection`, you missed a reference — fix before continuing.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: PASS with no warnings (`--max-warnings 0` will fail on any orphaned import/variable).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat: remove All Listings section from event detail page"
```

---

### Task 3: Manual verification

No automated UI tests exist, so verify behavior by running the app.

- [ ] **Step 1: Build + lint clean**

Run: `cd frontend && npm run build && npm run lint`
Expected: both PASS.

- [ ] **Step 2: Run the app and check behavior**

Use the run skill (or `cd frontend && npm run dev` with the backend running). On an event you participate in:

- [ ] "All Listings" section no longer appears on the event detail page.
- [ ] A pending/incomplete copy (one missing language/condition) does **not** appear in the "Add one of your active copies" dropdown.
- [ ] Selecting a complete copy and clicking "Add to event" makes it appear under "My Listings in This Event" immediately (no manual refresh).
- [ ] Clicking "Remove" on a listing makes it disappear immediately.
- [ ] A copy already listed in the event is absent from the dropdown; a second, distinct copy of the same game (different condition/language) is still offered.

---

## Self-Review

**Spec coverage:**
- Remove "All Listings" → Task 2. ✓
- Exclude pending + already-listed copies → Task 1. ✓
- My Listings refresh → transitively fixed by Task 1 (no failed pending-add); confirmed in Task 3. ✓
- Build + lint clean → Tasks 1–3. ✓
- Copy-level (not game-level) exclusion → Task 1 keeps `existingCopyIds` (copy id); verified in Task 3 last bullet. ✓

**Placeholder scan:** none — every code step shows exact before/after.

**Type consistency:** `c.is_pending` matches the `Copy` interface field `is_pending: boolean` in `frontend/src/api/copies.ts`. `AllListingsSection`/`MyListingsSection` names match the source.
