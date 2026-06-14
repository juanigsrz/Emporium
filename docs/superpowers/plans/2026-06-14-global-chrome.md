# Global Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen data-dense pages to navbar width and replace all back-navigation links with one shared button-styled component.

**Architecture:** Pure frontend presentational change. (1) Per-file swap of the page-container `max-w-*` token on six pages. (2) New stateless `BackButton` component rendered as `Link` or `button`, swapped into nine back-link sites. No state, API, routing, or data-model changes.

**Tech Stack:** React 18 + TypeScript, react-router-dom, Tailwind CSS, Vite.

**Note on testing:** This batch is presentational only — there is no logic to unit-test. The verification gate for every task is `npm run build` + `npm run lint` (both must stay clean) plus the manual checks listed. No Vitest/RTL tests are added; writing assertions over Tailwind class strings would be brittle and provide no real coverage.

---

### Task 1: Create the BackButton component

**Files:**
- Create: `frontend/src/components/BackButton.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/BackButton.tsx` with exactly:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type BackButtonProps = {
  to?: string
  onClick?: () => void
  children: ReactNode
  className?: string
}

const baseCls =
  'inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink/20 bg-cream px-4 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors'

const Chevron = () => (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
)

export default function BackButton({ to, onClick, children, className = '' }: BackButtonProps) {
  const cls = `${baseCls} ${className}`.trim()
  if (to) {
    return (
      <Link to={to} className={cls}>
        <Chevron />
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <Chevron />
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `BackButton.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BackButton.tsx
git commit -m "feat(ui): add shared BackButton component"
```

---

### Task 2: Swap back links to BackButton

Convert all nine back-navigation sites. For each: import `BackButton`, replace the
`<Link>`/`<button>` (and its inline svg/`←` text) with `<BackButton>`. Do **not**
remove the `Link` import from any file — every one of these files still uses `Link`
elsewhere (lint in Step 11 confirms).

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx`
- Modify: `frontend/src/features/trades/MyWantsPage.tsx`
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx`
- Modify: `frontend/src/features/profile/PublicProfilePage.tsx`
- Modify: `frontend/src/features/events/ManageEventPage.tsx`
- Modify: `frontend/src/features/matching/MatchRunPage.tsx`

- [ ] **Step 1: Add imports**

Add to each of the six files, next to the existing component imports:

```tsx
import BackButton from '../../components/BackButton'
```

- [ ] **Step 2: EventDetailPage — top "All events" link (~line 949)**

Replace:

```tsx
      <Link
        to="/events"
        className="inline-flex items-center gap-1 text-xs font-medium text-moss hover:text-ink transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All events
      </Link>
```

With:

```tsx
      <BackButton to="/events">All events</BackButton>
```

- [ ] **Step 3: EventDetailPage — error-card "Back to events" (~line 929)**

Replace:

```tsx
          <Link to="/events" className="mt-3 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">
            Back to events
          </Link>
```

With:

```tsx
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
```

- [ ] **Step 4: MyWantsPage — error-card link (~line 1551) and top link (~line 1576)**

Replace the error-card link:

```tsx
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
```

With:

```tsx
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
```

Replace the top link:

```tsx
      <Link
        to={`/events/${slug}`}
        className="inline-flex items-center gap-1 text-xs text-moss/70 transition-colors hover:text-indigo-600"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to {event.name}
      </Link>
```

With:

```tsx
      <BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>
```

- [ ] **Step 5: WantListBuilderPage — error-card link (~line 1390) and top link (~line 1426)**

Replace the error-card link:

```tsx
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
```

With:

```tsx
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
```

Replace the top link:

```tsx
      <Link
        to={`/events/${slug}`}
        className="inline-flex items-center gap-1 text-xs text-moss/70 hover:text-indigo-600 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to {event.name}
      </Link>
```

With:

```tsx
      <BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>
```

- [ ] **Step 6: PublicProfilePage — error-card link (~line 29) and bottom navigate(-1) (~line 108)**

Replace the error-card link:

```tsx
        <Link to="/" className="mt-4 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">
          ← Back to home
        </Link>
```

With:

```tsx
        <BackButton to="/" className="mt-4">Back to home</BackButton>
```

Replace the bottom button:

```tsx
      <button
        onClick={() => navigate(-1)}
        className="mt-6 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
      >
        ← Back
      </button>
```

With:

```tsx
      <BackButton onClick={() => navigate(-1)} className="mt-6">Back</BackButton>
```

- [ ] **Step 7: ManageEventPage — "← Back" link (~line 31)**

Replace:

```tsx
        <Link to={`/events/${slug}`} className="text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">← Back</Link>
```

With:

```tsx
        <BackButton to={`/events/${slug}`}>Back</BackButton>
```

- [ ] **Step 8: MatchRunPage — error-card "Back to events" (~line 1352)**

Replace:

```tsx
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
```

With:

```tsx
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
```

- [ ] **Step 9: MatchRunPage — "Back to event" link (~line 1373)**

Replace:

```tsx
          <Link
            to={`/events/${slug}`}
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            Back to event
          </Link>
```

With:

```tsx
          <BackButton to={`/events/${slug}`} className="mt-4">Back to event</BackButton>
```

- [ ] **Step 10: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 11: Lint**

Run: `cd frontend && npm run lint`
Expected: clean. If lint reports `Link` unused in any file, that file no longer
references `Link` elsewhere — remove only that file's now-unused `Link` import and
re-run lint.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/BackButton.tsx \
  frontend/src/features/events/EventDetailPage.tsx \
  frontend/src/features/trades/MyWantsPage.tsx \
  frontend/src/features/trades/WantListBuilderPage.tsx \
  frontend/src/features/profile/PublicProfilePage.tsx \
  frontend/src/features/events/ManageEventPage.tsx \
  frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(ui): use BackButton for all back navigation"
```

---

### Task 3: Widen data-dense page containers

Swap the page-container `max-w-*` token to `max-w-7xl` on six pages. Each token
listed is used **only** on page-container divs in that file; inner element helpers
(`max-w-[12rem]`, `max-w-[60%]`, `sm:max-w-[12rem]`) use different strings and must
stay untouched. Use a file-scoped find/replace of the exact token string.

**Files:**
- Modify: `frontend/src/features/copies/MyCopiesPage.tsx` (`max-w-3xl` → `max-w-7xl`, 1 occurrence)
- Modify: `frontend/src/features/trades/MyWantsPage.tsx` (`max-w-5xl` → `max-w-7xl`, 4 occurrences)
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx` (`max-w-4xl` → `max-w-7xl`, 4 occurrences)
- Modify: `frontend/src/features/events/EventDetailPage.tsx` (`max-w-4xl` → `max-w-7xl`, 3 occurrences)
- Modify: `frontend/src/features/matching/MatchRunPage.tsx` (`max-w-4xl` → `max-w-7xl`, 4 occurrences)
- Modify: `frontend/src/features/events/ManageEventPage.tsx` (`max-w-2xl` and `max-w-3xl` → `max-w-7xl`)

- [ ] **Step 1: MyCopiesPage**

Replace `mx-auto max-w-3xl px-4 sm:px-6 py-8` → `mx-auto max-w-7xl px-4 sm:px-6 py-8` (the one page container, ~line 648).

- [ ] **Step 2: MyWantsPage**

Replace all four occurrences of the token `max-w-5xl` with `max-w-7xl` (lines ~1539, ~1548, ~1561, ~1575). Leave `max-w-[12rem]` untouched.

- [ ] **Step 3: WantListBuilderPage**

Replace all four occurrences of `max-w-4xl` with `max-w-7xl` (lines ~1377, ~1387, ~1400, ~1425).

- [ ] **Step 4: EventDetailPage**

Replace all three occurrences of `max-w-4xl` with `max-w-7xl` (lines ~915, ~926, ~946). Leave `sm:max-w-[12rem]` untouched.

- [ ] **Step 5: MatchRunPage**

Replace all four occurrences of `max-w-4xl` with `max-w-7xl` (lines ~1339, ~1349, ~1362, ~1382). Leave the bare `mx-auto` at ~584 untouched.

- [ ] **Step 6: ManageEventPage**

Replace `max-w-2xl` (~line 29) with `max-w-7xl`, and `max-w-3xl` (~line 51) with `max-w-7xl`.

- [ ] **Step 7: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Lint**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/copies/MyCopiesPage.tsx \
  frontend/src/features/trades/MyWantsPage.tsx \
  frontend/src/features/trades/WantListBuilderPage.tsx \
  frontend/src/features/events/EventDetailPage.tsx \
  frontend/src/features/matching/MatchRunPage.tsx \
  frontend/src/features/events/ManageEventPage.tsx
git commit -m "feat(ui): widen data-dense pages to navbar width"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Run dev server**

Run: `cd frontend && npm run dev` and open the app.

- [ ] **Step 2: Width check**

Visit each widened page and confirm content spans navbar width (no large empty
side gutters): My Copies, My Wants (event want-list), the want-list builder, an
event detail page, a match run page, and the organizer manage page. Confirm Home,
Profile, Login, Register, and a public profile remain narrow.

- [ ] **Step 3: BackButton check**

Confirm every back navigation now renders as a cream bordered button with a left
chevron, and that each navigates correctly — including the PublicProfile bottom
"Back" which must go to the previous page (`navigate(-1)`), and the error-card
"Back to events" buttons (trigger by visiting a bad event slug).

---

## Self-Review

**Spec coverage:**
- A1 widen (6 pages, every state branch) → Task 3 (per-file token swap; MyWants/Builder/EventDetail/MatchRun list every occurrence). ✓
- A1 unchanged pages (EventsPage already 7xl; Home/Profile/Login/Register/PublicProfile narrow) → not in Task 3 file list. ✓
- A4 BackButton component + API (`to` | `onClick`, `children`, `className`) → Task 1. ✓
- A4 nine conversion sites → Task 2 Steps 2–9. ✓
- Verification (build/lint/manual) → Tasks 2/3 build+lint steps and Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full before/after. ✓

**Type consistency:** `BackButtonProps` fields (`to`, `onClick`, `children`, `className`) used consistently across all call sites; `className` optional with `''` default; all call sites pass exactly one of `to`/`onClick`. ✓
