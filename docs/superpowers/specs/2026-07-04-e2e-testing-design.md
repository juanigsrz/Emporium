# End-to-End Testing Suite — Design

**Date:** 2026-07-04
**Status:** Approved

## Goal

Automated browser-level end-to-end coverage of the whole platform: real frontend
(Vite/React) talking to real backend (Django/DRF), exercising every major user
journey. Fills the current gap: the backend has ~30 unit/API test files, the
frontend has zero tests, and nothing tests the two together.

## Approach (chosen)

**Playwright + API-fixture hybrid.** Test setup (users, events, copies, wants)
happens through the REST API — fast and deterministic. The browser exercises
each journey's actual UI interaction once, where that journey is the thing
under test. Rejected alternatives: pure-UI setup (10x slower, brittle,
especially drag-and-drop want-list building) and docker-compose harness
(heavier CI, slower iteration, unnecessary for the SQLite-based v1).

## Architecture

New top-level `e2e/` directory, sibling to `backend/` and `frontend/`, with its
own `package.json` (Playwright + TypeScript only — not added to the frontend's
dependencies).

Playwright's `webServer` array boots both servers:

| Server | Port | Command |
|--------|------|---------|
| Django | 8000 | `E2E_TESTS=1` env → `migrate` + `seed_e2e_catalog` + `runserver` |
| Vite   | 5173 | `npm run dev` with `VITE_API_BASE=http://localhost:8000/api` |

**Backend changes (two, both small):**

1. An `E2E_TESTS` branch in `bgtrade/settings.py` that swaps the database to a
   throwaway `e2e.sqlite3`. Playwright global setup deletes any stale copy
   before the servers start, so every run begins from a clean database.
2. A `seed_e2e_catalog` management command that creates ~20 `BoardGame` rows
   (plus versions) directly. The existing seeds don't fit: `import_games`
   needs the full CSV, and `seed_test_event` assumes the catalog already
   exists.

No broker, no external solver binary needed: Celery already runs in eager mode
and `matching/tasks.py` uses the in-process `FakeMatcher`, so match runs
complete synchronously during a test.

## Layout

```
e2e/
  package.json                # @playwright/test, typescript
  playwright.config.ts        # webServer array, projects, storageState deps
  helpers/api.ts              # REST client: register, token login, create event,
                              #   add copy, add wants, lifecycle transitions
  helpers/fixtures.ts         # Playwright fixtures: role contexts, event factory
                              #   (unique slug per test)
  setup/auth.setup.ts         # create organizer + alice + bob + carol via API,
                              #   log each in through the UI once, save
                              #   storageState per role
  specs/
    auth-profile.spec.ts
    browse-catalog.spec.ts
    trade-loop.spec.ts
    post-match.spec.ts
    organizer-edge.spec.ts
```

## Journey coverage

### auth-profile.spec.ts
- Register through the UI; log out; log in.
- Bad credentials show an error (regression guard for qa/BUG-004).
- Edit profile fields; view public profile at `/u/:username`.
- Switch language and verify translated UI.

### browse-catalog.spec.ts
- Browse events list; open event detail.
- Almanac / game filters on the event page.
- Wishlist and ratings interactions.

### trade-loop.spec.ts — the core journey
- Organizer creates an event through the UI.
- Alice, Bob, Carol join; each adds a copy through the UI.
- Each builds a want-list in the builder (drag-and-drop) forming an exact
  3-cycle: alice wants bob's copy, bob wants carol's, carol wants alice's.
- Organizer runs the match from the manage page.
- All three users see their trade in the results UI.

The forced 3-cycle makes result assertions deterministic regardless of solver
internals.

### post-match.spec.ts
- Payments marking, shipping overview, trade confirmation/fulfillment.
- Setup (event + match run) seeded via API; UI exercised for the post-match
  screens themselves.

### organizer-edge.spec.ts
- Event lifecycle locks and read-only states.
- Participation gates and join rules.
- Listing status guards.
- Combos; caps/budget advanced panel.

## Data flow and isolation

- Every test creates its own event via the API with a unique slug — zero
  cross-test coupling, safe parallelism.
- The four role accounts are created once in `auth.setup.ts`; per-role
  `storageState` files let tests skip repeated logins.
- Multi-user steps within one test use multiple browser contexts, each loading
  a different role's storageState.

## Flakiness policy

- Web-first assertions only; no fixed sleeps.
- Retries: 0 locally, 1 in CI; trace-on-retry uploaded as a CI artifact.
- Selectors prefer roles/labels; where markup is ambiguous, add `data-testid`
  attributes to the frontend (surgical additions, enumerated in the
  implementation plan).

## Out of scope

- Google OAuth (external service; token flow can't run headlessly).
- Live BGG imports (network dependency).
- WebSocket push (optional in v1; the frontend polls regardless).
- Frontend component/unit tests (separate effort if wanted later).

## CI

`.github/workflows/tests.yml` with three jobs, on PRs and pushes to main:

1. **backend** — `python manage.py test`.
2. **frontend-static** — `npm run lint` + `tsc -b`.
3. **e2e** — Playwright suite with cached browsers; failure traces uploaded as
   artifacts.

## Success criteria

- `cd e2e && npx playwright test` passes from a clean checkout with only
  `pip install` / `npm install` done — servers start themselves.
- All five spec files pass locally and in CI.
- Suite is deterministic: two consecutive full runs pass without retries
  locally.
