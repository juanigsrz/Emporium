# Auth Cache Invalidation

**Date:** 2026-06-14
**Batch:** B1 (Auth) — cache invalidation half. Google OAuth (B2) is split into its
own future batch (pending Google Cloud credentials) and is out of scope here.
**Scope:** Frontend only (`frontend/src/main.tsx`).

## Problem

The TanStack Query `QueryClient` is created once at module load in `main.tsx`. Login
(`LoginPage`), register (`RegisterPage`), and logout (`NavBar`) all mutate the
zustand auth store but never touch the query cache. So when a user logs out and a
different user logs in (e.g. organizer → trader), the previous user's cached queries
remain and role-gated sections render that should not — until a hard reload
(Ctrl+Shift+R) resets the JS module and creates a fresh empty `QueryClient`.

## Goal

Clear the React Query cache on every auth transition, from one place, so no current
or future login path can forget to do it.

## Non-Goals

- Google OAuth (separate batch).
- Refactoring the login/register temp-token flow or the pre-existing
  "token set without user if `fetchCurrentUser` fails" quirk.
- Adding a frontend test runner (the repo has none; QA is manual per `docs/ROADMAP.md`).

## Design

Single change in `frontend/src/main.tsx`. After the `queryClient` is constructed and
before `createRoot`, subscribe once to the auth store and clear the cache whenever
`token` changes:

```ts
import { useAuthStore } from './store/auth'

// ...existing queryClient creation...

let prevToken = useAuthStore.getState().token
useAuthStore.subscribe((state) => {
  if (state.token !== prevToken) {
    prevToken = state.token
    queryClient.clear()
  }
})
```

**Why a manual prev-token compare:** the store uses only the `persist` middleware,
not `subscribeWithSelector`, so the selector form of `subscribe` is unavailable.
Subscribing to the whole state and comparing `token` against a captured previous
value avoids adding middleware.

**Transitions covered:**
- Logout: `token` key → `null` → clear.
- Login / register: `null` → key (via the existing temporary
  `useAuthStore.setState({ token: key })`) → clear.
- Any future login path (e.g. Google OAuth) inherits this automatically.

**Edge behavior (acceptable):**
- `prevToken` initializes from the persisted token, so a normal page reload with an
  existing session does **not** trigger a spurious clear.
- A login whose `fetchCurrentUser` fails after the temp-token set will trigger one
  harmless `clear()` of an already-empty cache.

No edits to `LoginPage`, `RegisterPage`, or `NavBar`.

## Verification

- `cd frontend && npm run build` succeeds.
- `cd frontend && npm run lint` clean.
- Manual repro: log in as an organizer (note organizer-only sections), log out, log
  in as a trader account — the organizer-only sections are gone without a hard
  reload.

## Risk / Rollback

Very low. One additive subscription in a single file; no API, routing, or store-shape
change. Rollback = revert the branch.
