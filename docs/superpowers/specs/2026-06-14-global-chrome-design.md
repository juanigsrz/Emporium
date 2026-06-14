# Global Chrome — Wider Layout + Back-Button Styling

**Date:** 2026-06-14
**Batch:** A (Global chrome) — first of six batches from the platform polish list.
**Scope:** Frontend only (`frontend/src`). No backend, no API, no data-model changes.

## Problem

1. **Wasted horizontal space.** Content pages use inconsistent `max-w` caps
   (`max-w-2xl`/`3xl`/`4xl`/`5xl`) while the NavBar is `max-w-7xl` (80rem). Content
   sits in a narrow column inside a wide nav, leaving large empty side gutters on
   data-dense pages.
2. **Back links don't look like buttons.** Six+ back navigations use divergent,
   faint text-link / underline styles (`text-xs text-moss`, `← Back` underline,
   indigo hover). They read as incidental text, not navigation controls, and none
   match the site's button language.

## Goals

- Standardize data-dense pages to navbar width so later batches (cards, grids) can
  consume the space.
- Replace all back navigations with a single shared button-styled component.

## Non-Goals

- Reflowing inner content to fill the new width (that is batches C/E/F). Batch A
  only lifts the artificial cap.
- Touching forms / reading pages that read better narrow.
- Any backend or routing change.

## A1 — Wider content

Inline width-token swap only. Keep the established per-page pattern
(`mx-auto max-w-Nxl px-… py-…`); change the `max-w-*` token on **every state
branch** of each widened page (loading skeleton, error, empty, loaded). No new
layout abstraction — surgical, matches existing style.

| Page | Current | Target |
|------|---------|--------|
| `features/copies/MyCopiesPage.tsx` | `max-w-3xl` | `max-w-7xl` |
| `features/trades/MyWantsPage.tsx` | `max-w-5xl` | `max-w-7xl` |
| `features/trades/WantListBuilderPage.tsx` | `max-w-4xl` | `max-w-7xl` |
| `features/events/EventDetailPage.tsx` | `max-w-4xl` | `max-w-7xl` |
| `features/matching/MatchRunPage.tsx` | `max-w-4xl` | `max-w-7xl` |
| `features/events/ManageEventPage.tsx` | `max-w-2xl` / `max-w-3xl` | `max-w-7xl` |

**Unchanged:**

- `features/events/EventsPage.tsx` — already `max-w-7xl`.
- Narrow by design: `features/home/HomePage.tsx`, `features/profile/ProfilePage.tsx`,
  `features/login/LoginPage.tsx`, `features/auth/RegisterPage.tsx`,
  `features/profile/PublicProfilePage.tsx`.

Only the `max-w-*` token changes. Padding (`px-*`, `py-*`), `mx-auto`, and inner
markup stay as-is. Inner `max-w-[12rem]` / `max-w-3xl` style helpers on individual
elements (filters, truncation) are out of scope and untouched.

## A4 — BackButton component

New file `frontend/src/components/BackButton.tsx`.

**API:**

```tsx
type BackButtonProps = {
  to?: string          // renders react-router <Link to={to}>
  onClick?: () => void // renders <button onClick> (for navigate(-1))
  children: ReactNode  // label, e.g. "All events"
  className?: string   // optional extra classes appended
}
```

Exactly one of `to` / `onClick` is provided. `to` → `<Link>`; otherwise `<button type="button">`.

**Style (matches existing secondary button):**

```
inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink/20 bg-cream
px-4 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors
```

Left chevron svg (`M15 19l-7-7 7-7`, `h-3.5 w-3.5`) before `children`.

**Conversion sites (9 links across 6 files):**

| File | Current | New |
|------|---------|-----|
| `features/events/EventDetailPage.tsx` (~949) | "All events" text link | `<BackButton to="/events">All events</BackButton>` |
| `features/trades/MyWantsPage.tsx` (~1551) | "Back to events" (error) | `<BackButton to="/events">Back to events</BackButton>` |
| `features/trades/MyWantsPage.tsx` (~1576) | "Back to {event.name}" | `<BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>` |
| `features/trades/WantListBuilderPage.tsx` (~1390) | "Back to events" (error) | `<BackButton to="/events">Back to events</BackButton>` |
| `features/trades/WantListBuilderPage.tsx` (~1426) | "Back to {event.name}" | `<BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>` |
| `features/profile/PublicProfilePage.tsx` (~29) | "← Back to home" | `<BackButton to="/">Back to home</BackButton>` |
| `features/profile/PublicProfilePage.tsx` (~108) | "← Back" (navigate(-1)) | `<BackButton onClick={() => navigate(-1)}>Back</BackButton>` |
| `features/events/ManageEventPage.tsx` (~31) | "← Back" | `<BackButton to={`/events/${slug}`}>Back</BackButton>` |
| `features/matching/MatchRunPage.tsx` (~1352, ~1373) | "Back to events" / "Back to event" | `<BackButton to=…>…</BackButton>` |

The literal `←`/chevron text and old inline classes are removed from each site (the
component supplies the chevron). Remove now-unused per-site svg markup. Leave any
other surrounding markup intact (surgical).

## Verification

- `cd frontend && npm run build` succeeds.
- `npm run lint` clean (no new warnings; removed-import check for any site that no
  longer needs `Link`).
- Manual: each widened page visibly uses navbar width; each converted back link
  renders as a cream bordered button with chevron and navigates correctly
  (including `navigate(-1)` on PublicProfile).

## Risk / Rollback

Low. Pure presentational CSS-class changes plus one additive component. No state,
API, or routing logic altered. Rollback = revert the branch.
