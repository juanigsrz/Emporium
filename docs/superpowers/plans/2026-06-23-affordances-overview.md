# Affordances + Overview Username Links (#3, #10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make destructive/navigation actions look like the site's standard buttons and gate the genuinely-new destructive/nav ones with a modal confirm; add a back button to the matching page; restyle the grid "Auto-tick by rating" as a real button; and make usernames in the shipping/payments overviews link to profiles.

**Architecture:** Frontend-only. A new shared `ConfirmDialog` modal component backs the two new confirmations (remove-listing, advanced-builder). The rest are surgical restyles / `Link` wraps in existing components.

**Tech Stack:** React 19 + TS + react-query + react-router-dom. No test runner — verify with `npm run build` (tsc + vite) + `npx eslint <file> --ext ts,tsx` (exit 0) + manual checklist.

**Spec:** `docs/superpowers/specs/2026-06-23-affordances-overview-design.md`

## Global Constraints

- Repo root: `/home/juanigsrz/Desktop/Emporium`. Frontend cwd: `frontend/`.
- FE lint baseline: `npm run lint` fails only on pre-existing `CopyForm.tsx:15` — ignore that; gate each changed file with `npx eslint <file> --ext ts,tsx` (exit 0).
- No backend changes. No new dependencies.
- `Edit`-tool curly-quote hazard: if an edit injects U+201C/U+201D smart quotes, fix only the affected line(s); never do a file-wide quote replace.
- Canonical button styles (copy verbatim):
  - Secondary: `rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors`
  - Secondary destructive (red): `rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors`

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/juanigsrz/Desktop/Emporium && git checkout main && git checkout -b feat/affordances-overview
```

Expected: `Switched to a new branch 'feat/affordances-overview'`

---

### Task 1: Shared `ConfirmDialog` + remove-listing button/modal + Leave restyle

**Files:**
- Create: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/features/events/EventDetailPage.tsx`

**Interfaces:**
- Produces: `ConfirmDialog` (default export) with props
  `{ title: string; body: React.ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; destructive?: boolean; pending?: boolean }`.
  Consumed by Task 2 (advanced-builder) and this task (remove-listing).

- [ ] **Step 1: Create the `ConfirmDialog` component**

Create `frontend/src/components/ConfirmDialog.tsx` (mirrors the existing `WithdrawDialog` modal chrome in `MyCopiesPage.tsx`):

```tsx
import type { ReactNode } from 'react'

type ConfirmDialogProps = {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  pending?: boolean
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  pending = false,
}: ConfirmDialogProps) {
  const confirmCls = destructive
    ? 'flex-1 rounded-2xl border-2 border-ink bg-red-300 px-4 py-2.5 text-sm font-bold text-red-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60'
    : 'flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-3xl border-2 border-ink bg-cream p-6 shadow-card">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">{title}</h2>
        <div className="mb-5 text-sm text-moss">{body}</div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            Cancel
          </button>
          <button onClick={onConfirm} disabled={pending} className={confirmCls}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Import `ConfirmDialog` in `EventDetailPage`**

In `frontend/src/features/events/EventDetailPage.tsx`, after the existing local imports near the top (after line 30, the `useMyRatings` import line), add:

```tsx
import ConfirmDialog from '../../components/ConfirmDialog'
```

- [ ] **Step 3: Add confirm state + restyle the remove-listing button in `MyListingCard`**

In `MyListingCard`, add a confirm state. Right after the existing
`const [err, setErr] = useState<string | null>(null)` line (~L746), add:

```tsx
  const [confirmRemove, setConfirmRemove] = useState(false)
```

Then replace the remove button (currently red text, ~L783-790):

```tsx
        <button
          onClick={() => onRemove(listing.id)}
          disabled={removePending}
          className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
          aria-label="Remove listing"
        >
          Remove
        </button>
```

with a proper red **button** that opens the confirm:

```tsx
        <button
          onClick={() => setConfirmRemove(true)}
          disabled={removePending}
          className="shrink-0 rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
          aria-label="Remove listing"
        >
          Remove
        </button>
```

- [ ] **Step 4: Render the confirm modal in `MyListingCard`**

The `MyListingCard` return is a single root `<div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-parchment p-3">`. Immediately after that opening root `<div>` tag (before the `{/* Header */}` comment), insert:

```tsx
      {confirmRemove && (
        <ConfirmDialog
          title="Remove listing?"
          body={
            <>
              This removes <span className="font-semibold text-ink">{listing.board_game_name}</span>{' '}
              (<span className="font-mono">{listing.listing_code}</span>) from the event.
            </>
          }
          confirmLabel={removePending ? 'Removing…' : 'Remove'}
          destructive
          pending={removePending}
          onConfirm={() => {
            onRemove(listing.id)
            setConfirmRemove(false)
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
```

- [ ] **Step 5: Restyle the Leave trigger button in `JoinLeaveButton`**

In `JoinLeaveButton`, the Leave trigger (the button that calls `setConfirmLeave(true)`, ~L182-187) currently is text:

```tsx
              <button
                onClick={() => setConfirmLeave(true)}
                className="text-xs font-medium text-moss hover:text-red-500 transition-colors"
              >
                Leave
              </button>
```

Restyle to the secondary destructive button (keep the inline confirm-swap that follows — do not change `handleLeave`/`confirmLeave`):

```tsx
              <button
                onClick={() => setConfirmLeave(true)}
                className="rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                Leave
              </button>
```

- [ ] **Step 6: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/components/ConfirmDialog.tsx src/features/events/EventDetailPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 7: Manual QA**

- The "Remove" control on an owned listing is now a red **button**; clicking it opens a centered modal naming the game; Cancel closes it without removing; Confirm removes the listing.
- "Leave" is now a red **button**; clicking it still shows the inline "Leave this event?" confirm; Confirm leave / Cancel still work.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/components/ConfirmDialog.tsx frontend/src/features/events/EventDetailPage.tsx
git commit -m "feat(events): ConfirmDialog + remove-listing button/modal, restyle Leave button (#3)"
```

---

### Task 2: My Wants — advanced-builder button + modal, auto-tick restyle

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` from `../../components/ConfirmDialog` (Task 1).

- [ ] **Step 1: Import `useNavigate` + `ConfirmDialog`**

In `frontend/src/features/trades/MyWantsPage.tsx`, change the react-router import (L3):

```tsx
import { useParams, Link } from 'react-router-dom'
```

to:

```tsx
import { useParams, Link, useNavigate } from 'react-router-dom'
```

`Link` may become unused after Step 3 — if `npm run build` flags it as unused, remove `Link` from this import then (it is only used by the advanced-builder anchor being replaced; check with `npx eslint`).

Then add, after the other component imports near the top (after the `ratings` import on L11):

```tsx
import ConfirmDialog from '../../components/ConfirmDialog'
```

- [ ] **Step 2: Add navigate + confirm state in `MyWantsPage`**

In `export default function MyWantsPage()` (L1491), right after
`const { slug } = useParams<{ slug: string }>()` (L1492), add:

```tsx
  const navigate = useNavigate()
  const [confirmAdvanced, setConfirmAdvanced] = useState(false)
```

(`useState` is already imported.)

- [ ] **Step 3: Replace the advanced-builder text link with a button**

Replace the advanced-builder anchor (~L1610-1615):

```tsx
          <Link
            to={`/events/${slug}/builder`}
            className="text-xs text-moss/70 underline hover:text-indigo-600"
          >
            Advanced (X-to-Y) builder
          </Link>
```

with a secondary **button** that opens the confirm:

```tsx
          <button
            type="button"
            onClick={() => setConfirmAdvanced(true)}
            className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            Advanced (X-to-Y) builder
          </button>
```

- [ ] **Step 4: Render the confirm modal**

Immediately after the opening `<div className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6">` (L1597, the main return root, right before the `<BackButton …>` line), insert:

```tsx
      {confirmAdvanced && (
        <ConfirmDialog
          title="Open advanced builder?"
          body="The advanced X-to-Y builder is a manual editor for power users. Your current wants are saved; you can come back any time."
          confirmLabel="Open builder"
          onConfirm={() => {
            setConfirmAdvanced(false)
            navigate(`/events/${slug}/builder`)
          }}
          onCancel={() => setConfirmAdvanced(false)}
        />
      )}
```

- [ ] **Step 5: Restyle the Auto-tick button**

Replace the Auto-tick button's className (~L1266):

```tsx
          className="rounded-xl border px-2 py-1 text-xs"
```

with the secondary button style:

```tsx
          className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
```

(Leave the button's `onClick` bulk-toggle logic and label unchanged.)

- [ ] **Step 6: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors. (If `Link` is now unused, remove it from the L3 import and rebuild.)
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/trades/MyWantsPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 7: Manual QA**

- "Advanced (X-to-Y) builder" is now a **button**; clicking it opens a confirm modal; Confirm navigates to `/events/<slug>/builder`; Cancel stays on My Wants.
- In the grid view, "Auto-tick by rating" looks like a standard button and still bulk-toggles wants by rating.

- [ ] **Step 8: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "feat(mywants): advanced-builder button + confirm modal, restyle auto-tick (#3)"
```

---

### Task 3: Back button in the matching section

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: Add a back button to the matching main-view header**

In `frontend/src/features/matching/MatchRunPage.tsx` (`BackButton` already imported on L3), the main return has a breadcrumb block followed by `{/* Page header */}` (L1388). Insert a back button on its own line directly **before** the `{/* Page header */}` comment:

```tsx
      <BackButton to={`/events/${slug}`}>Back to event</BackButton>

```

(`slug` is the same value already used as `slug!` elsewhere in this view.)

- [ ] **Step 2: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/matching/MatchRunPage.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 3: Manual QA**

- The matching page (main/success view) shows a "Back to event" button; clicking it navigates to `/events/<slug>`.

- [ ] **Step 4: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(matching): back-to-event button in matching view (#3)"
```

---

### Task 4: Overview username → profile links (#10)

**Files:**
- Modify: `frontend/src/features/matching/PaymentsOverviewTab.tsx`
- Modify: `frontend/src/features/matching/ShippingOverviewTab.tsx`

- [ ] **Step 1: PaymentsOverviewTab — import `Link`**

In `frontend/src/features/matching/PaymentsOverviewTab.tsx`, add at the top (after the existing `import { useState } from 'react'` line):

```tsx
import { Link } from 'react-router-dom'
```

- [ ] **Step 2: PaymentsOverviewTab — link the rollup username**

Replace the rollup username cell (~L52):

```tsx
                  <span className="w-28 truncate font-semibold text-ink">{u.username}</span>
```

with:

```tsx
                  <Link to={`/u/${u.username}`} className="w-28 truncate font-semibold text-indigo-500 hover:underline">{u.username}</Link>
```

- [ ] **Step 3: PaymentsOverviewTab — link the row usernames**

Replace the row from/to line (~L88-90):

```tsx
                  <p className="truncate text-sm text-ink">
                    {p.from_username} → {p.to_username}
                  </p>
```

with linked usernames:

```tsx
                  <p className="truncate text-sm text-ink">
                    <Link to={`/u/${p.from_username}`} className="text-indigo-500 hover:underline">{p.from_username}</Link>
                    {' → '}
                    <Link to={`/u/${p.to_username}`} className="text-indigo-500 hover:underline">{p.to_username}</Link>
                  </p>
```

- [ ] **Step 4: ShippingOverviewTab — import `Link`**

In `frontend/src/features/matching/ShippingOverviewTab.tsx`, add at the top (after `import { useState } from 'react'`):

```tsx
import { Link } from 'react-router-dom'
```

- [ ] **Step 5: ShippingOverviewTab — link the rollup username**

Replace the rollup username cell (~L53):

```tsx
                  <span className="w-28 truncate font-semibold text-ink">{t.username}</span>
```

with:

```tsx
                  <Link to={`/u/${t.username}`} className="w-28 truncate font-semibold text-indigo-500 hover:underline">{t.username}</Link>
```

- [ ] **Step 6: ShippingOverviewTab — link the row usernames**

Replace the row giver/receiver line (~L92):

```tsx
                  <p className="text-xs text-moss">{s.giver_username} → {s.receiver_username}</p>
```

with linked usernames:

```tsx
                  <p className="text-xs text-moss">
                    <Link to={`/u/${s.giver_username}`} className="text-indigo-500 hover:underline">{s.giver_username}</Link>
                    {' → '}
                    <Link to={`/u/${s.receiver_username}`} className="text-indigo-500 hover:underline">{s.receiver_username}</Link>
                  </p>
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npm run build`
Expected: no TypeScript errors.
Run: `cd /home/juanigsrz/Desktop/Emporium/frontend && npx eslint src/features/matching/PaymentsOverviewTab.tsx src/features/matching/ShippingOverviewTab.tsx --ext ts,tsx`
Expected: exit 0.

- [ ] **Step 8: Manual QA**

- In the payments overview (per-user rollup + the All-payments rows) every username is a link that opens `/u/<username>`; the table still paginates; truncation/layout intact.
- Same for the shipping overview (per-trader rollup + All-shipments rows).

- [ ] **Step 9: Commit**

```bash
cd /home/juanigsrz/Desktop/Emporium && git add frontend/src/features/matching/PaymentsOverviewTab.tsx frontend/src/features/matching/ShippingOverviewTab.tsx
git commit -m "feat(overview): link usernames to profiles in shipping/payments tabs (#10)"
```

---

## Self-Review

**Spec coverage:**
- #3 A — remove-listing button + modal → Task 1; Leave restyle → Task 1; advanced-builder button + modal → Task 2; auto-tick restyle → Task 2; Withdraw unchanged (spec: no change) ✔
- #3 B — back button in matching → Task 3 ✔
- #3 C — organizer manage back already text → no task (spec: already satisfied) ✔
- #3 shared ConfirmDialog → Task 1 ✔
- #10 — username links both tabs (rollup + rows); pagination already exists → Task 4 ✔

**Placeholder scan:** none.

**Type/name consistency:** `ConfirmDialog` prop names (`title`/`body`/`confirmLabel`/`onConfirm`/`onCancel`/`destructive`/`pending`) are identical in Task 1 (definition + remove-listing use) and Task 2 (advanced-builder use). `useNavigate`/`navigate` and `confirmAdvanced`/`setConfirmAdvanced` are introduced and used within Task 2. `slug` in Tasks 2/3 is the existing `useParams` value.

**Notes for the executor:**
- No backend, no migrations, no new deps.
- `Link` in `MyWantsPage` may become unused after Task 2 Step 3 — only drop it if the build/eslint flags it (it is still imported elsewhere in many files, but in this file the advanced anchor was its consumer; verify before removing).
- Modal components use `fixed inset-0 z-50`, so they render correctly placed anywhere inside the card/page root.
