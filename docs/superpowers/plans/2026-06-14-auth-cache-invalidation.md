# Auth Cache Invalidation Implementation Plan

> **For agentic workers:** Single-file presentational/state-wiring fix. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the React Query cache on every auth-token change so role-gated sections don't leak across logins.

**Architecture:** One subscription in `frontend/src/main.tsx` watching the zustand auth store's `token`; calls `queryClient.clear()` on change.

**Tech Stack:** React 18 + TypeScript, TanStack Query, zustand.

**Testing note:** No frontend test runner exists in the repo (QA is manual). Gate = `npm run build` + `npm run lint` + manual login-switch repro.

---

### Task 1: Subscribe to token changes and clear the cache

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add the auth-store import**

Add to the import block:

```tsx
import { useAuthStore } from './store/auth'
```

- [ ] **Step 2: Add the subscription between queryClient creation and createRoot**

After the `const queryClient = new QueryClient({ ... })` block and before
`createRoot(...)`, insert:

```tsx
// Clear cached queries whenever the auth token changes so role-gated data
// from a previous session never leaks into the next login.
let prevToken = useAuthStore.getState().token
useAuthStore.subscribe((state) => {
  if (state.token !== prevToken) {
    prevToken = state.token
    queryClient.clear()
  }
})
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: succeeds, no TypeScript errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: clean (one pre-existing `react-refresh/only-export-components` warning in
`CopyForm.tsx` is acceptable; nothing new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.tsx
git commit -m "fix(auth): clear query cache on auth token change"
```

---

### Task 2: Manual verification

- [ ] **Step 1:** `cd frontend && npm run dev`, with the backend running.
- [ ] **Step 2:** Log in as an organizer; confirm organizer-only sections appear.
- [ ] **Step 3:** Log out, then log in as a non-organizer (trader) account.
- [ ] **Step 4:** Confirm the organizer-only sections are gone **without** a hard
  reload (no Ctrl+Shift+R needed).

---

## Self-Review

- **Spec coverage:** Single design change (subscription in `main.tsx`) → Task 1. Manual repro → Task 2. ✓
- **Placeholder scan:** None. ✓
- **Type consistency:** `useAuthStore.getState().token` / `state.token` match the store's `token: string | null`. ✓
