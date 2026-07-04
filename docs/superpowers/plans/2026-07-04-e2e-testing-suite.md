# E2E Testing Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright browser E2E suite covering all major user journeys against the real Django backend + React frontend, runnable with one command locally and in GitHub Actions.

**Architecture:** New top-level `e2e/` project. Playwright's `webServer` boots Django (`E2E_TESTS=1` → throwaway `e2e.sqlite3`, wiped per run) and Vite. Test setup (users, events, copies, wants) goes through the REST API via `helpers/api.ts`; the browser exercises each journey's UI once. Four role accounts (`e2e_organizer`, `e2e_alice`, `e2e_bob`, `e2e_carol`) get per-role `storageState` from a Playwright setup project.

**Tech Stack:** Playwright `@playwright/test` + TypeScript (e2e), Django 5.2 + DRF (backend), React 18 + Vite (frontend), GitHub Actions (CI).

**Spec:** `docs/superpowers/specs/2026-07-04-e2e-testing-design.md`

## Global Constraints

- Auth token lives in localStorage (zustand `persist` in `frontend/src/store/auth.ts`) — `storageState` captures it; login-once-per-role works.
- API base: `http://localhost:8000/api`. Auth header: `Authorization: Token <key>`. Bad login returns **400**, not 401.
- Event lifecycle chain: `DRAFT → SUBMISSIONS_OPEN → WANTLIST_OPEN → MATCHING → MATCH_REVIEW → FINALIZATION → SHIPPING → ARCHIVED` via `POST /api/events/{slug}/transition/ {"to": ...}`.
- `FakeMatcher` is deterministic (greedy 2-cycle then 3-cycle passes, no randomness) and runs in-process via eager Celery — a `POST /matches/` returns with the run already executed.
- Copy `condition` choices: `NEW, LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR`. A copy missing `language` or `condition` is `is_pending=true` and cannot be listed (400).
- Event slugs are auto-generated from `name`; POST `/api/events/` needs only `{name}`. Tests must use unique names (`Date.now()` suffix).
- UI is i18n'd; tests run with `locale: 'en-US'` and assert English strings from `frontend/src/i18n/locales/en.json` (e.g. `login.usernameLabel` = "Username", `login.submit` = "Sign in", `events.createEvent` = "Create event").
- Selector policy: `getByRole`/`getByLabel` with loose regex first; add `data-testid` to frontend only where markup is ambiguous. Every added testid must be listed in the task that adds it.
- Do not touch existing backend tests or frontend behavior except the enumerated additions.
- Out of scope: Google OAuth, live BGG imports, WebSocket push, frontend component tests.

---

### Task 1: Backend E2E database switch + `seed_e2e_catalog`

**Files:**
- Modify: `backend/bgtrade/settings.py:34-40` (DATABASES block)
- Create: `backend/catalog/management/commands/seed_e2e_catalog.py`
- Test: `backend/catalog/test_seed_e2e.py`
- Modify: `.gitignore` (root)

**Interfaces:**
- Produces: env contract `E2E_TESTS=1` → DB file `backend/e2e.sqlite3`; management command `seed_e2e_catalog` creating BoardGames with `bgg_id` 900001–900020 named "E2E Game 01"…"E2E Game 20", each with one `BoardGameVersion` (language "English"). Later tasks rely on these exact bgg_ids and names.

- [ ] **Step 1: Write the failing test**

```python
# backend/catalog/test_seed_e2e.py
from django.core.management import call_command
from django.test import TestCase

from catalog.models import BoardGame, BoardGameVersion


class SeedE2ECatalogTests(TestCase):
    def test_seeds_twenty_games_idempotently(self):
        call_command("seed_e2e_catalog")
        call_command("seed_e2e_catalog")  # second run must not duplicate
        games = BoardGame.objects.filter(bgg_id__range=(900001, 900020))
        self.assertEqual(games.count(), 20)
        self.assertEqual(
            BoardGameVersion.objects.filter(board_game__in=games).count(), 20
        )
        g = games.get(bgg_id=900001)
        self.assertEqual(g.name, "E2E Game 01")
        self.assertFalse(g.is_expansion)
        self.assertIsNotNone(g.rank)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 manage.py test catalog.test_seed_e2e -v 2`
Expected: ERROR — `Unknown command: 'seed_e2e_catalog'`

- [ ] **Step 3: Write the command**

```python
# backend/catalog/management/commands/seed_e2e_catalog.py
"""Tiny deterministic catalog for the Playwright E2E suite.

import_games needs the full CSV and seed_test_event assumes the catalog
already exists, so the E2E web server seeds this instead.
"""
from django.core.management.base import BaseCommand

from catalog.models import BoardGame, BoardGameVersion


class Command(BaseCommand):
    help = "Seed 20 deterministic BoardGames for E2E tests (idempotent)."

    def handle(self, *args, **options):
        for i in range(1, 21):
            game, _ = BoardGame.objects.update_or_create(
                bgg_id=900000 + i,
                defaults={
                    "name": f"E2E Game {i:02d}",
                    "year_published": 2020,
                    "rank": i,
                    "average": 7.5,
                    "users_rated": 1000,
                    "is_expansion": False,
                },
            )
            BoardGameVersion.objects.update_or_create(
                board_game=game,
                bgg_version_id=900000 + i,
                defaults={"name": f"E2E Edition {i:02d}", "language": "English"},
            )
        self.stdout.write(self.style.SUCCESS("Seeded 20 E2E games"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python3 manage.py test catalog.test_seed_e2e -v 2`
Expected: `OK`, 1 test passed

- [ ] **Step 5: Add the E2E database switch**

In `backend/bgtrade/settings.py`, the current block is:

```python
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}
```

Replace with:

```python
# E2E_TESTS=1 points the dev server at a throwaway DB the Playwright suite
# wipes on every run (see e2e/playwright.config.ts webServer command).
_db_file = "e2e.sqlite3" if os.environ.get("E2E_TESTS") == "1" else "db.sqlite3"
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / _db_file}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}
```

Check the top of `settings.py` for `import os`; add it if missing.

- [ ] **Step 6: Verify the switch and that the normal DB is untouched**

Run: `cd backend && rm -f e2e.sqlite3 && E2E_TESTS=1 python3 manage.py migrate --no-input && ls e2e.sqlite3 && E2E_TESTS=1 python3 manage.py seed_e2e_catalog`
Expected: migrations apply, `e2e.sqlite3` exists, "Seeded 20 E2E games"

Run: `cd backend && python3 manage.py test catalog -v 1`
Expected: all catalog tests still pass (normal settings path unaffected)

- [ ] **Step 7: Gitignore the throwaway DB**

Append to root `.gitignore`:

```
backend/e2e.sqlite3
e2e/node_modules/
e2e/test-results/
e2e/playwright-report/
e2e/.auth/
```

- [ ] **Step 8: Commit**

```bash
git add backend/catalog/management/commands/seed_e2e_catalog.py backend/catalog/test_seed_e2e.py backend/bgtrade/settings.py .gitignore
git commit -m "feat(e2e): E2E database switch + seed_e2e_catalog command"
```

---

### Task 2: Playwright scaffold + smoke test

**Files:**
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/playwright.config.ts`, `e2e/specs/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1's `E2E_TESTS=1` + `seed_e2e_catalog`.
- Produces: `cd e2e && npx playwright test` boots both servers and runs specs in `e2e/specs/`. `baseURL` = `http://localhost:5173`. Later tasks add specs to `e2e/specs/` and a `setup` project.

- [ ] **Step 1: Create the package**

```json
// e2e/package.json
{
  "name": "emporium-e2e",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

```json
// e2e/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

Run: `cd e2e && npm install && npx playwright install chromium`

- [ ] **Step 2: Write the config**

```ts
// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Fresh DB every run: delete-first here rather than in globalSetup,
      // because Playwright starts webServers before globalSetup runs.
      command:
        'cd ../backend && rm -f e2e.sqlite3 && E2E_TESTS=1 python3 manage.py migrate --no-input && E2E_TESTS=1 python3 manage.py seed_e2e_catalog && E2E_TESTS=1 python3 manage.py runserver 8000 --noreload',
      url: 'http://localhost:8000/api/schema/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'cd ../frontend && npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
```

Note: if the backend venv isn't on PATH, prefix the Django command with the venv activate or use `../backend/venv/bin/python3`. Verify which works in this checkout and keep it consistent.

- [ ] **Step 3: Write the smoke spec**

```ts
// e2e/specs/smoke.spec.ts
import { test, expect } from '@playwright/test'

test('home page renders and API is reachable', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Emporium/)
  const games = await request.get('http://localhost:8000/api/games/?search=E2E Game')
  expect(games.ok()).toBe(true)
  expect((await games.json()).count).toBeGreaterThanOrEqual(20)
})
```

- [ ] **Step 4: Run it**

Run: `cd e2e && npx playwright test`
Expected: both servers boot, 1 test passes. If the title assertion fails, check what `page.title()` actually returns and adjust — `frontend/index.html` sets `<title>Emporium</title>` but the app may update it at runtime.

- [ ] **Step 5: Commit**

```bash
git add e2e/package.json e2e/package-lock.json e2e/tsconfig.json e2e/playwright.config.ts e2e/specs/smoke.spec.ts
git commit -m "feat(e2e): Playwright scaffold with webServer bootstrap + smoke test"
```

---

### Task 3: API helper client

**Files:**
- Create: `e2e/helpers/api.ts`
- Test: `e2e/specs/api-helpers.spec.ts` (thin spec proving the helpers against the live backend)

**Interfaces:**
- Consumes: running backend from Task 2's webServer.
- Produces (exact signatures — all later tasks import these):

```ts
export const API: string                        // 'http://localhost:8000/api'
export const PASSWORD: string                   // shared role password
export function authHeaders(token: string): { Authorization: string }
export async function registerOrLogin(request: APIRequestContext, username: string): Promise<string> // token
export async function createEvent(request, token, name: string, extra?: object): Promise<{ slug: string; name: string }>
export async function advanceEvent(request, token, slug: string, target: string): Promise<void> // walks DRAFT→…→target
export async function joinEvent(request, token, slug: string, body?: object): Promise<void>
export async function createCopy(request, token, bggId: number): Promise<{ id: number }>
export async function addListing(request, token, slug: string, copyId: number): Promise<{ id: number; listing_code: string }>
export async function createOfferGroup(request, token, slug, body: { name: string; item_listing_ids: number[] }): Promise<{ id: number }>
export async function createWantGroup(request, token, slug, body: { name: string; items: { event_listing: number }[] }): Promise<{ id: number }>
export async function createWish(request, token, slug, body: { offer_group: number; want_group: number }): Promise<{ id: number }>
export async function runMatch(request, token, slug): Promise<{ id: number; status: string }> // POST + poll until DONE
```

- [ ] **Step 1: Write the helpers**

```ts
// e2e/helpers/api.ts
import { APIRequestContext, expect } from '@playwright/test'

export const API = 'http://localhost:8000/api'
export const PASSWORD = 'e2e-Sup3r-secret!'

export function authHeaders(token: string) {
  return { Authorization: `Token ${token}` }
}

async function post(
  request: APIRequestContext,
  path: string,
  data: object,
  token?: string,
) {
  return request.post(`${API}${path}`, {
    data,
    headers: token ? authHeaders(token) : {},
  })
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: object,
  token?: string,
) {
  const res = await post(request, path, data, token)
  expect(res.ok(), `POST ${path} → ${res.status()}: ${await res.text()}`).toBe(true)
  return res.json()
}

export async function registerOrLogin(
  request: APIRequestContext,
  username: string,
): Promise<string> {
  const reg = await post(request, '/auth/registration/', {
    username,
    email: `${username}@e2e.local`,
    password1: PASSWORD,
    password2: PASSWORD,
  })
  if (reg.ok()) return (await reg.json()).key
  // Locally the server may be reused across runs (reuseExistingServer),
  // so the account can already exist — fall back to login.
  const body = await postOk(request, '/auth/login/', { username, password: PASSWORD })
  return body.key
}

export async function createEvent(
  request: APIRequestContext,
  token: string,
  name: string,
  extra: object = {},
): Promise<{ slug: string; name: string }> {
  return postOk(request, '/events/', { name, ...extra }, token)
}

const CHAIN = [
  'SUBMISSIONS_OPEN',
  'WANTLIST_OPEN',
  'MATCHING',
  'MATCH_REVIEW',
  'FINALIZATION',
  'SHIPPING',
  'ARCHIVED',
]

/** Walk a fresh DRAFT event forward to `target`. */
export async function advanceEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
  target: string,
): Promise<void> {
  for (const to of CHAIN) {
    await postOk(request, `/events/${slug}/transition/`, { to }, token)
    if (to === target) return
  }
  throw new Error(`unknown target status ${target}`)
}

export async function joinEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: object = {},
): Promise<void> {
  await postOk(request, `/events/${slug}/join/`, body, token)
}

export async function createCopy(
  request: APIRequestContext,
  token: string,
  bggId: number,
): Promise<{ id: number }> {
  return postOk(
    request,
    '/copies/',
    { board_game: bggId, condition: 'GOOD', language: 'English' },
    token,
  )
}

export async function addListing(
  request: APIRequestContext,
  token: string,
  slug: string,
  copyId: number,
): Promise<{ id: number; listing_code: string }> {
  return postOk(request, `/events/${slug}/listings/`, { copy: copyId }, token)
}

export async function createOfferGroup(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { name: string; item_listing_ids: number[] },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/offer-groups/`, body, token)
}

export async function createWantGroup(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { name: string; items: { event_listing: number }[] },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/want-groups/`, body, token)
}

export async function createWish(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { offer_group: number; want_group: number },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/wishes/`, body, token)
}

export async function runMatch(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<{ id: number; status: string }> {
  const run = await postOk(request, `/events/${slug}/matches/`, {}, token)
  // Celery is eager, so the run is usually DONE already; poll to be safe.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/events/${slug}/matches/${run.id}/`, {
          headers: authHeaders(token),
        })
        return (await res.json()).status
      },
      { timeout: 30_000 },
    )
    .toMatch(/DONE|FAILED/)
  const final = await request.get(`${API}/events/${slug}/matches/${run.id}/`, {
    headers: authHeaders(token),
  })
  const body = await final.json()
  expect(body.status, `match run failed: ${body.log}`).toBe('DONE')
  return body
}
```

- [ ] **Step 2: Write the proving spec**

```ts
// e2e/specs/api-helpers.spec.ts
import { test, expect } from '@playwright/test'
import {
  registerOrLogin, createEvent, advanceEvent, joinEvent,
  createCopy, addListing, createOfferGroup, createWantGroup,
  createWish, runMatch,
} from '../helpers/api'

test('helpers drive a full 2-cycle through the API', async ({ request }) => {
  const t1 = await registerOrLogin(request, 'e2e_api_u1')
  const t2 = await registerOrLogin(request, 'e2e_api_u2')

  const event = await createEvent(request, t1, `API Helper Event ${Date.now()}`)
  await advanceEvent(request, t1, event.slug, 'SUBMISSIONS_OPEN')
  await joinEvent(request, t1, event.slug)
  await joinEvent(request, t2, event.slug)

  const c1 = await createCopy(request, t1, 900001)
  const c2 = await createCopy(request, t2, 900002)
  const l1 = await addListing(request, t1, event.slug, c1.id)
  const l2 = await addListing(request, t2, event.slug, c2.id)

  await advanceEvent(request, t1, event.slug, 'WANTLIST_OPEN')
  // u1 offers l1, wants l2; u2 offers l2, wants l1 → forced 2-cycle
  const og1 = await createOfferGroup(request, t1, event.slug, { name: 'og1', item_listing_ids: [l1.id] })
  const wg1 = await createWantGroup(request, t1, event.slug, { name: 'wg1', items: [{ event_listing: l2.id }] })
  await createWish(request, t1, event.slug, { offer_group: og1.id, want_group: wg1.id })
  const og2 = await createOfferGroup(request, t2, event.slug, { name: 'og2', item_listing_ids: [l2.id] })
  const wg2 = await createWantGroup(request, t2, event.slug, { name: 'wg2', items: [{ event_listing: l1.id }] })
  await createWish(request, t2, event.slug, { offer_group: og2.id, want_group: wg2.id })

  await advanceEvent(request, t1, event.slug, 'MATCHING')
  const run = await runMatch(request, t1, event.slug)
  expect(run.status).toBe('DONE')
})
```

- [ ] **Step 3: Run it, fix payload mismatches**

Run: `cd e2e && npx playwright test specs/api-helpers.spec.ts`
Expected: PASS. The `postOk` assertion messages include response bodies — if a payload shape is off (field names come from `docs/API_CONTRACT.md`), the message says exactly which field. Fix the helper, not the contract.

Note: `advanceEvent` twice on the same event continues from where the chain left off only because `CHAIN` restarts at `SUBMISSIONS_OPEN` — the second call will 400 on the already-done transition. **Fix during this task:** make `advanceEvent` first GET `/events/{slug}/` to read current `status` and skip chain entries at or before it:

```ts
export async function advanceEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
  target: string,
): Promise<void> {
  const cur = await request.get(`${API}/events/${slug}/`, { headers: authHeaders(token) })
  const status = (await cur.json()).status
  const start = CHAIN.indexOf(status) + 1 // -1+1 = 0 for DRAFT
  const end = CHAIN.indexOf(target)
  if (end < 0) throw new Error(`unknown target status ${target}`)
  for (const to of CHAIN.slice(start, end + 1)) {
    await postOk(request, `/events/${slug}/transition/`, { to }, token)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/api.ts e2e/specs/api-helpers.spec.ts
git commit -m "feat(e2e): API helper client + proving spec"
```

---

### Task 4: Auth setup project + role fixtures

**Files:**
- Create: `e2e/setup/auth.setup.ts`, `e2e/helpers/fixtures.ts`
- Modify: `e2e/playwright.config.ts` (add setup project + dependency)

**Interfaces:**
- Consumes: `registerOrLogin`, `PASSWORD` from `helpers/api.ts`.
- Produces: storageState files `e2e/.auth/e2e_organizer.json`, `e2e_alice.json`, `e2e_bob.json`, `e2e_carol.json`; and from `helpers/fixtures.ts`:

```ts
export const ROLES: { organizer: 'e2e_organizer'; alice: 'e2e_alice'; bob: 'e2e_bob'; carol: 'e2e_carol' }
export type Role = keyof typeof ROLES
export const test: TestType<...>   // base.extend with:
//   pageAs(role: Role): Promise<Page>   — new context w/ that role's storageState
//   tokens: Record<Role, string>        — API tokens for all four roles
export { expect } from '@playwright/test'
```

- [ ] **Step 1: Write auth.setup.ts**

```ts
// e2e/setup/auth.setup.ts
import fs from 'fs'
import { test as setup, expect } from '@playwright/test'
import { registerOrLogin, PASSWORD } from '../helpers/api'

const ROLES = ['e2e_organizer', 'e2e_alice', 'e2e_bob', 'e2e_carol']

setup('create role accounts + storage states', async ({ request, browser }) => {
  fs.mkdirSync('.auth', { recursive: true })
  for (const username of ROLES) {
    await registerOrLogin(request, username)
    const page = await browser.newPage()
    await page.goto('/login')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).not.toHaveURL(/\/login/)
    await page.context().storageState({ path: `.auth/${username}.json` })
    await page.close()
  }
})
```

Label/button strings come from `en.json`: `login.usernameLabel` = "Username", `login.passwordLabel` = "Password", `login.submit` = "Sign in". If `getByLabel` finds nothing, check `LoginPage.tsx` — labels use `htmlFor`, so it should resolve; adjust only if the DOM disagrees.

- [ ] **Step 2: Write fixtures**

```ts
// e2e/helpers/fixtures.ts
import { test as base, Page } from '@playwright/test'
import { registerOrLogin } from './api'

export const ROLES = {
  organizer: 'e2e_organizer',
  alice: 'e2e_alice',
  bob: 'e2e_bob',
  carol: 'e2e_carol',
} as const
export type Role = keyof typeof ROLES

type Fixtures = {
  pageAs: (role: Role) => Promise<Page>
  tokens: Record<Role, string>
}

export const test = base.extend<Fixtures>({
  pageAs: async ({ browser }, use) => {
    const pages: Page[] = []
    await use(async (role: Role) => {
      const context = await browser.newContext({
        storageState: `.auth/${ROLES[role]}.json`,
      })
      const page = await context.newPage()
      pages.push(page)
      return page
    })
    for (const p of pages) await p.context().close()
  },
  tokens: async ({ request }, use) => {
    const entries = await Promise.all(
      (Object.keys(ROLES) as Role[]).map(async (r) => [
        r,
        await registerOrLogin(request, ROLES[r]),
      ]),
    )
    await use(Object.fromEntries(entries) as Record<Role, string>)
  },
})

export { expect } from '@playwright/test'
```

- [ ] **Step 3: Wire the setup project into the config**

In `e2e/playwright.config.ts`, replace the `projects` array with:

```ts
  projects: [
    { name: 'setup', testDir: './setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
```

- [ ] **Step 4: Verify**

Run: `cd e2e && npx playwright test`
Expected: setup project runs first and passes; smoke + api-helpers still pass; `.auth/` contains 4 JSON files with a non-empty `origins[0].localStorage` entry (the zustand-persisted token).

- [ ] **Step 5: Commit**

```bash
git add e2e/setup/auth.setup.ts e2e/helpers/fixtures.ts e2e/playwright.config.ts
git commit -m "feat(e2e): role auth setup project + pageAs/tokens fixtures"
```

---

### Task 5: auth-profile.spec.ts

**Files:**
- Create: `e2e/specs/auth-profile.spec.ts`
- Possibly modify: `frontend/src/features/auth/RegisterPage.tsx`, `frontend/src/features/profile/*` (data-testids only if role/label selectors fail — list any added testid in the commit message)

**Interfaces:**
- Consumes: `test`/`expect` from `helpers/fixtures.ts`, `PASSWORD` from `helpers/api.ts`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/auth-profile.spec.ts
import { test, expect, ROLES } from '../helpers/fixtures'
import { PASSWORD } from '../helpers/api'

test('register a brand-new user through the UI', async ({ page }) => {
  const username = `e2e_reg_${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel(/email/i).fill(`${username}@e2e.local`)
  // Register form has two password fields; fill both.
  const pw = page.getByLabel(/password/i)
  await pw.first().fill(PASSWORD)
  await pw.last().fill(PASSWORD)
  await page.getByRole('button', { name: /register|sign up|create/i }).click()
  await expect(page).not.toHaveURL(/\/register/)
})

test('bad credentials show an error and stay on /login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('e2e_alice')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Regression guard for qa/BUG-004: backend returns 400, UI must show
  // "Invalid credentials. Please try again." (login.errors.invalidCredentials)
  await expect(page.getByText(/invalid credentials/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('logged-in user edits profile and sees public profile', async ({ pageAs }) => {
  const page = await pageAs('alice')
  await page.goto('/profile')
  const bio = page.getByLabel(/bio|about/i)
  await bio.fill('E2E bio text')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved|updated/i)).toBeVisible()

  await page.goto(`/u/${ROLES.alice}`)
  await expect(page.getByText(ROLES.alice)).toBeVisible()
  await expect(page.getByText('E2E bio text')).toBeVisible()
})

test('language switch changes visible UI strings', async ({ pageAs }) => {
  const page = await pageAs('alice')
  await page.goto('/')
  // The language switcher lives in the global chrome; en.json/es.json both exist.
  await page.getByRole('button', { name: /language|idioma|EN|ES/i }).click()
  await page.getByRole('option', { name: /español|ES/i }).click()
  await expect(page.getByRole('link', { name: /eventos/i })).toBeVisible()
})
```

- [ ] **Step 2: Run headed, adapt selectors to the real DOM**

Run: `cd e2e && npx playwright test specs/auth-profile.spec.ts --headed`

For each failure: inspect the actual markup (`npx playwright codegen http://localhost:5173` helps), prefer fixing the selector to a role/label; only if the element has no accessible handle, add `data-testid` to the frontend component and note it. The profile-edit field names and the language-switcher control are the two most likely to need adjustment — check `frontend/src/features/profile/` and the header component for actual labels/keys before guessing twice.

- [ ] **Step 3: Verify green**

Run: `cd e2e && npx playwright test specs/auth-profile.spec.ts`
Expected: 4 passed

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/auth-profile.spec.ts frontend/src
git commit -m "feat(e2e): auth + profile journey spec"
```

---

### Task 6: browse-catalog.spec.ts

**Files:**
- Create: `e2e/specs/browse-catalog.spec.ts`

**Interfaces:**
- Consumes: fixtures (`pageAs`, `tokens`), API helpers (`createEvent`, `advanceEvent`, `joinEvent`, `createCopy`, `addListing`).

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/browse-catalog.spec.ts
import { test, expect } from '../helpers/fixtures'
import {
  createEvent, advanceEvent, joinEvent, createCopy, addListing,
} from '../helpers/api'

test.describe('event browse + event-scoped catalog', () => {
  let slug: string
  let eventName: string

  test.beforeAll(async ({ request, tokens }) => {
    eventName = `Browse Event ${Date.now()}`
    const event = await createEvent(request, tokens.organizer, eventName)
    slug = event.slug
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')
    await joinEvent(request, tokens.alice, slug)
    // Two listed games so filters/ordering have something to bite on.
    for (const bgg of [900001, 900002]) {
      const copy = await createCopy(request, tokens.alice, bgg)
      await addListing(request, tokens.alice, slug, copy.id)
    }
  })

  test('events list shows the event; search finds it', async ({ pageAs }) => {
    const page = await pageAs('bob')
    await page.goto('/events')
    await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill(eventName)
    await expect(page.getByText(eventName)).toBeVisible()
  })

  test('event detail lists the games with copies', async ({ pageAs }) => {
    const page = await pageAs('bob')
    await page.goto(`/events/${slug}`)
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).toBeVisible()
  })

  test('game search filter narrows the event catalog', async ({ pageAs }) => {
    const page = await pageAs('bob')
    await page.goto(`/events/${slug}`)
    await page.getByPlaceholder(/search/i).first().fill('E2E Game 01')
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })

  test('wishlist a game, then filter by wishlisted', async ({ pageAs, request, tokens }) => {
    const page = await pageAs('bob')
    await request.post('http://localhost:8000/api/wishlists/', {
      data: { board_game_bgg_id: 900001 },
      headers: { Authorization: `Token ${tokens.bob}` },
    })
    await page.goto(`/events/${slug}`)
    await page.getByRole('checkbox', { name: /wishlist/i })
      .or(page.getByRole('button', { name: /wishlist/i })).first().click()
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })

  test('personal rating powers the min-rating filter', async ({ pageAs, request, tokens }) => {
    // Rate Game 01 a 9.0 via the API, then use the UI's min-rating filter.
    await request.post('http://localhost:8000/api/game-ratings/', {
      data: { board_game: 900001, value: '9.0' },
      headers: { Authorization: `Token ${tokens.bob}` },
    })
    const page = await pageAs('bob')
    await page.goto(`/events/${slug}`)
    await page.getByLabel(/min.*rating|rating/i)
      .or(page.getByPlaceholder(/rating/i)).first().fill('8')
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })
})
```

- [ ] **Step 2: Run headed, adapt selectors**

Run: `cd e2e && npx playwright test specs/browse-catalog.spec.ts --headed`
The wishlist-filter control's real markup lives in `frontend/src/features/events/EventDetailPage.tsx` — read it before adjusting. Same escalation rule: roles/labels first, `data-testid` last resort.

- [ ] **Step 3: Verify green, commit**

Run: `cd e2e && npx playwright test specs/browse-catalog.spec.ts`
Expected: 5 passed

```bash
git add e2e/specs/browse-catalog.spec.ts frontend/src
git commit -m "feat(e2e): event browse + catalog filter spec"
```

---

### Task 7: trade-loop.spec.ts — the core journey

**Files:**
- Create: `e2e/specs/trade-loop.spec.ts`
- Possibly modify: `frontend/src/features/events/EventsPage.tsx`, `ManageEventPage.tsx`, `frontend/src/features/copies/*`, `frontend/src/features/trades/*` (data-testids only where needed)

**Interfaces:**
- Consumes: fixtures + all API helpers.

This is the one journey where *every* step goes through the UI. Before writing, map the actual affordances:

- [ ] **Step 1: Recon the four UI surfaces**

Run and read:
```bash
grep -n "createEvent\|onSubmit\|Dialog\|Modal" frontend/src/features/events/EventsPage.tsx | head -20
ls frontend/src/features/copies frontend/src/features/trades
grep -rn "t('" frontend/src/features/trades/*.tsx | grep -iE "add|want" | head -20
grep -n "transition\|runMatch\|matches" frontend/src/features/events/ManageEventPage.tsx | head -20
```
Note the exact button names / labels for: create-event form, add-copy form (`/my-copies`), the My Wants builder (`/events/:slug/wants`) add-want affordance, and the manage page's transition + run-match controls. Use those names in Step 2; the spec below uses the en.json strings found during planning (`events.createEvent` = "Create event") plus loose regexes for the rest — tighten them to what recon finds.

- [ ] **Step 2: Write the spec**

```ts
// e2e/specs/trade-loop.spec.ts
import { test, expect, Role } from '../helpers/fixtures'

test('full trade loop: create → join → list → want → match → results', async ({ pageAs }) => {
  test.setTimeout(180_000) // multi-user journey, generous budget

  const eventName = `Trade Loop ${Date.now()}`

  // --- Organizer creates the event through the UI ---
  const org = await pageAs('organizer')
  await org.goto('/events')
  await org.getByRole('button', { name: 'Create event' }).click()
  await org.getByLabel(/name/i).fill(eventName)
  await org.getByRole('button', { name: /create|save/i }).click()
  await expect(org.getByText(eventName)).toBeVisible()

  // Read the slug from the URL after clicking through to the event.
  await org.getByText(eventName).click()
  await org.waitForURL(/\/events\/[^/]+/)
  const slug = new URL(org.url()).pathname.split('/')[2]

  // Organizer opens submissions from the manage page.
  await org.goto(`/events/${slug}/manage`)
  await org.getByRole('button', { name: /open submissions|submissions/i }).click()

  // --- Alice, Bob, Carol: join, add a copy, list it ---
  const players: { role: Role; game: RegExp; bggName: string }[] = [
    { role: 'alice', game: /E2E Game 01/, bggName: 'E2E Game 01' },
    { role: 'bob', game: /E2E Game 02/, bggName: 'E2E Game 02' },
    { role: 'carol', game: /E2E Game 03/, bggName: 'E2E Game 03' },
  ]
  const pages: Record<string, Awaited<ReturnType<typeof pageAs>>> = {}

  for (const p of players) {
    const page = await pageAs(p.role)
    pages[p.role] = page

    // Join the event.
    await page.goto(`/events/${slug}`)
    await page.getByRole('button', { name: /join/i }).click()

    // Add a copy on My Copies.
    await page.goto('/my-copies')
    await page.getByRole('button', { name: /add/i }).first().click()
    await page.getByPlaceholder(/search/i).first().fill(p.bggName)
    await page.getByText(p.game).first().click()
    await page.getByLabel(/condition/i).selectOption('GOOD')
    await page.getByLabel(/language/i).fill('English')
    await page.getByRole('button', { name: /save|add|create/i }).click()
    await expect(page.getByText(p.game)).toBeVisible()

    // List the copy in the event.
    await page.goto(`/events/${slug}`)
    await page.getByRole('button', { name: /list|add.*event/i }).first().click()
    await expect(page.getByText(p.game)).toBeVisible()
  }

  // --- Organizer opens the want-list phase ---
  await org.getByRole('button', { name: /open want|want-?list/i }).click()

  // --- Forced 3-cycle wants via the My Wants UI ---
  // alice wants bob's game (02), bob wants carol's (03), carol wants alice's (01)
  const wants: { role: Role; target: RegExp }[] = [
    { role: 'alice', target: /E2E Game 02/ },
    { role: 'bob', target: /E2E Game 03/ },
    { role: 'carol', target: /E2E Game 01/ },
  ]
  for (const w of wants) {
    const page = pages[w.role]
    await page.goto(`/events/${slug}/wants`)
    await page.getByText(w.target).first().click()
    await page.getByRole('button', { name: /add|want/i }).first().click()
    await page.getByRole('button', { name: /save/i }).click()
  }

  // --- Organizer moves to MATCHING and runs the match from the manage UI ---
  await org.goto(`/events/${slug}/manage`)
  await org.getByRole('button', { name: /matching/i }).click()
  await org.getByRole('button', { name: /run match|run/i }).click()
  await expect(org.getByText(/done/i)).toBeVisible({ timeout: 30_000 })

  // --- All three users see their trade in the results UI ---
  const receives: Record<Role, RegExp> = {
    alice: /E2E Game 02/,
    bob: /E2E Game 03/,
    carol: /E2E Game 01/,
    organizer: /never/,
  }
  for (const p of players) {
    const page = pages[p.role]
    await page.goto(`/events/${slug}/matches`)
    await expect(page.getByText(receives[p.role]).first()).toBeVisible()
  }
})
```

- [ ] **Step 3: Iterate headed until green**

Run: `cd e2e && npx playwright test specs/trade-loop.spec.ts --headed --workers=1`

Expect several selector fixes from Step 1's recon. Two known risk points:
1. **My Wants builder**: if adding a want is drag-and-drop only (@dnd-kit), replace click-add with `await source.dragTo(target)`; if `dragTo` is flaky with @dnd-kit's sensors, fall back to manual `locator.hover()` + `page.mouse.down()` / `page.mouse.move(x, y, { steps: 10 })` / `page.mouse.up()` per Playwright's dnd guidance. Do not add a new button to the frontend just for the test.
2. **Manage page transitions**: the button names come from `allowed_transitions`; read `ManageEventPage.tsx` for the actual labels.

If a control genuinely has no accessible handle, add `data-testid` (candidates: `data-testid="run-match"`, `data-testid="want-add-<bgg_id>"`) and list them in the commit message.

- [ ] **Step 4: Determinism check**

Run twice: `cd e2e && npx playwright test specs/trade-loop.spec.ts --repeat-each=2 --workers=1`
Expected: 2/2 pass, no retries.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/trade-loop.spec.ts frontend/src
git commit -m "feat(e2e): full trade-loop journey spec (create→join→list→want→match→results)"
```

---

### Task 8: post-match.spec.ts

**Files:**
- Create: `e2e/specs/post-match.spec.ts`, `e2e/helpers/seed.ts`

**Interfaces:**
- Consumes: fixtures + API helpers.
- Produces: `seedMatchedEvent(request, tokens, opts?: { money?: boolean }): Promise<{ slug: string; runId: number }>` in `e2e/helpers/seed.ts` — creates event, 3 players, forced 3-cycle, advances to MATCHING, runs match. Task 9 reuses it.

- [ ] **Step 1: Write the seed helper**

```ts
// e2e/helpers/seed.ts
import { APIRequestContext } from '@playwright/test'
import {
  API, authHeaders, createEvent, advanceEvent, joinEvent, createCopy,
  addListing, createOfferGroup, createWantGroup, createWish, runMatch,
} from './api'
import { Role } from './fixtures'

/** Event with alice/bob/carol in a forced 3-cycle, matched and DONE. */
export async function seedMatchedEvent(
  request: APIRequestContext,
  tokens: Record<Role, string>,
  opts: { money?: boolean } = {},
): Promise<{ slug: string; runId: number }> {
  const event = await createEvent(
    request,
    tokens.organizer,
    `Seeded Match ${Date.now()}`,
    opts.money ? { money_enabled: true } : {},
  )
  const slug = event.slug
  await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')

  const players: Role[] = ['alice', 'bob', 'carol']
  const listings: Record<Role, { id: number }> = {} as never
  for (const [i, role] of players.entries()) {
    await joinEvent(request, tokens[role], slug)
    const copy = await createCopy(request, tokens[role], 900001 + i)
    listings[role] = await addListing(request, tokens[role], slug, copy.id)
    if (opts.money) {
      // Price the listing so payments have amounts to show.
      await request.patch(`${API}/events/${slug}/listings/${listings[role].id}/`, {
        data: { sell_price: '10.00' },
        headers: authHeaders(tokens[role]),
      })
    }
  }

  await advanceEvent(request, tokens.organizer, slug, 'WANTLIST_OPEN')
  // alice→bob's, bob→carol's, carol→alice's
  const cycle: [Role, Role][] = [
    ['alice', 'bob'],
    ['bob', 'carol'],
    ['carol', 'alice'],
  ]
  for (const [wanter, owner] of cycle) {
    const og = await createOfferGroup(request, tokens[wanter], slug, {
      name: `og-${wanter}`,
      item_listing_ids: [listings[wanter].id],
    })
    const wg = await createWantGroup(request, tokens[wanter], slug, {
      name: `wg-${wanter}`,
      items: [{ event_listing: listings[owner].id }],
    })
    await createWish(request, tokens[wanter], slug, {
      offer_group: og.id,
      want_group: wg.id,
    })
  }

  await advanceEvent(request, tokens.organizer, slug, 'MATCHING')
  const run = await runMatch(request, tokens.organizer, slug)
  return { slug, runId: run.id }
}
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/specs/post-match.spec.ts
import { test, expect } from '../helpers/fixtures'
import { seedMatchedEvent } from '../helpers/seed'

test('results page shows my assignments (give and receive)', async ({ pageAs, request, tokens }) => {
  const { slug } = await seedMatchedEvent(request, tokens)
  const page = await pageAs('alice')
  await page.goto(`/events/${slug}/matches`)
  await expect(page.getByText(/E2E Game 02/).first()).toBeVisible() // receives bob's
  await expect(page.getByText(/E2E Game 01/).first()).toBeVisible() // gives her own
})

test('payments tab: payer marks paid, receiver confirms', async ({ pageAs, request, tokens }) => {
  const { slug } = await seedMatchedEvent(request, tokens, { money: true })

  const alice = await pageAs('alice')
  await alice.goto(`/events/${slug}/matches`)
  await alice.getByRole('tab', { name: /payments/i })
    .or(alice.getByRole('button', { name: /payments/i })).first().click()
  await alice.getByRole('button', { name: /mark.*paid|paid/i }).first().click()

  const bob = await pageAs('bob')
  await bob.goto(`/events/${slug}/matches`)
  await bob.getByRole('tab', { name: /payments/i })
    .or(bob.getByRole('button', { name: /payments/i })).first().click()
  // en key matching.payments.confirmReceived
  await bob.getByRole('button', { name: /confirm/i }).first().click()
  await expect(bob.getByText(/confirmed|received/i).first()).toBeVisible()
})

test('shipping overview lists who ships to whom', async ({ pageAs, request, tokens }) => {
  const { slug } = await seedMatchedEvent(request, tokens)
  const page = await pageAs('alice')
  await page.goto(`/events/${slug}/matches`)
  await page.getByRole('tab', { name: /shipping/i })
    .or(page.getByRole('button', { name: /shipping/i })).first().click()
  // Alice gives Game 01 to carol (carol wanted alice's copy).
  await expect(page.getByText(/e2e_carol/).first()).toBeVisible()
})
```

- [ ] **Step 3: Iterate headed until green**

Run: `cd e2e && npx playwright test specs/post-match.spec.ts --headed --workers=1`
The payments flow's direction (who owes whom, which button appears for which side) is defined in `frontend/src/features/matching/MatchRunPage.tsx` + `PaymentsOverviewTab.tsx` — read those before flipping alice/bob in the test. If payments require a later lifecycle status (e.g. `MATCH_REVIEW`), extend `seedMatchedEvent` with an `advanceEvent(..., 'MATCH_REVIEW')` after the run and note it in the helper's doc comment.

- [ ] **Step 4: Verify green, commit**

Run: `cd e2e && npx playwright test specs/post-match.spec.ts`
Expected: 3 passed

```bash
git add e2e/helpers/seed.ts e2e/specs/post-match.spec.ts frontend/src
git commit -m "feat(e2e): post-match payments + shipping spec with seed helper"
```

---

### Task 9: organizer-edge.spec.ts

**Files:**
- Create: `e2e/specs/organizer-edge.spec.ts`

**Interfaces:**
- Consumes: fixtures, API helpers, `seedMatchedEvent`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/organizer-edge.spec.ts
import { test, expect } from '../helpers/fixtures'
import {
  API, authHeaders, createEvent, advanceEvent, joinEvent, createCopy, addListing,
} from '../helpers/api'

test('wantlist is read-only once event reaches MATCHING', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `Lock Event ${Date.now()}`)
  await advanceEvent(request, tokens.organizer, event.slug, 'SUBMISSIONS_OPEN')
  await joinEvent(request, tokens.alice, event.slug)
  const copy = await createCopy(request, tokens.alice, 900001)
  await addListing(request, tokens.alice, event.slug, copy.id)
  await advanceEvent(request, tokens.organizer, event.slug, 'MATCHING')

  const page = await pageAs('alice')
  await page.goto(`/events/${event.slug}/wants`)
  // Builder must render read-only: no save affordance in locked states.
  await expect(page.getByText(/locked|read.?only|closed/i).first()).toBeVisible()
})

test('join gate: require_location blocks a user without a location', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `Gated Event ${Date.now()}`, {
    require_location: true,
  })
  await advanceEvent(request, tokens.organizer, event.slug, 'SUBMISSIONS_OPEN')
  const page = await pageAs('bob') // bob has no profile location
  await page.goto(`/events/${event.slug}`)
  await page.getByRole('button', { name: /join/i }).click()
  await expect(page.getByText(/location/i).first()).toBeVisible() // error surfaced
})

test('pending copy cannot be listed (400 surfaced in UI)', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `Pending Event ${Date.now()}`)
  await advanceEvent(request, tokens.organizer, event.slug, 'SUBMISSIONS_OPEN')
  await joinEvent(request, tokens.alice, event.slug)
  // Copy with no condition/language → is_pending
  const res = await request.post(`${API}/copies/`, {
    data: { board_game: 900005 },
    headers: authHeaders(tokens.alice),
  })
  const pending = await res.json()
  expect(pending.is_pending).toBe(true)

  const listing = await request.post(`${API}/events/${event.slug}/listings/`, {
    data: { copy: pending.id },
    headers: authHeaders(tokens.alice),
  })
  expect(listing.status()).toBe(400)
})

test('organizer manage page shows only allowed transitions', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `Transitions ${Date.now()}`)
  const page = await pageAs('organizer')
  await page.goto(`/events/${event.slug}/manage`)
  // DRAFT allows only SUBMISSIONS_OPEN.
  await expect(page.getByRole('button', { name: /submissions/i }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /finalization/i })).toHaveCount(0)
})

test('non-organizer cannot see manage controls', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `NoManage ${Date.now()}`)
  const page = await pageAs('alice')
  await page.goto(`/events/${event.slug}/manage`)
  // Route guard should bounce or render an unauthorized state.
  await expect(page.getByRole('button', { name: /run match/i })).toHaveCount(0)
})

test('builder advanced panel exposes caps and combos', async ({ pageAs, request, tokens }) => {
  const event = await createEvent(request, tokens.organizer, `Caps ${Date.now()}`)
  await advanceEvent(request, tokens.organizer, event.slug, 'SUBMISSIONS_OPEN')
  await joinEvent(request, tokens.alice, event.slug)
  const copy = await createCopy(request, tokens.alice, 900001)
  await addListing(request, tokens.alice, event.slug, copy.id)
  await advanceEvent(request, tokens.organizer, event.slug, 'WANTLIST_OPEN')

  const page = await pageAs('alice')
  await page.goto(`/events/${event.slug}/builder`)
  await page.getByRole('button', { name: /advanced/i }).first().click()
  // Caps map to OfferGroup.max_give / WantGroup.min_receive.
  await expect(page.getByText(/max give|give cap/i).first()).toBeVisible()
  await expect(page.getByText(/combo/i).first()).toBeVisible()
})
```

- [ ] **Step 2: Iterate headed until green**

Run: `cd e2e && npx playwright test specs/organizer-edge.spec.ts --headed --workers=1`
The locked-wantlist banner text lives in `frontend/src/features/trades/` — grep for the i18n key (`grep -rn "locked" frontend/src/i18n/locales/en.json`) and use the exact string.

- [ ] **Step 3: Verify green, commit**

Run: `cd e2e && npx playwright test specs/organizer-edge.spec.ts`
Expected: 6 passed

```bash
git add e2e/specs/organizer-edge.spec.ts frontend/src
git commit -m "feat(e2e): organizer edge-case spec (locks, gates, guards, transitions)"
```

---

### Task 10: Full-suite determinism pass + GitHub Actions

**Files:**
- Create: `.github/workflows/tests.yml`
- Modify: `README.md` (short E2E section)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full local determinism check**

Run: `cd e2e && npx playwright test && npx playwright test`
Expected: two consecutive full-suite runs, all green, zero retries (spec's success criterion). Fix any flake found before proceeding — web-first assertion or tighter setup, never a sleep.

- [ ] **Step 2: Write the workflow**

```yaml
# .github/workflows/tests.yml
name: tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - run: pip install -r backend/requirements.txt
      - run: python manage.py test
        working-directory: backend

  frontend-static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run lint
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            frontend/package-lock.json
            e2e/package-lock.json
      - run: pip install -r backend/requirements.txt
      - run: npm ci
        working-directory: frontend
      - run: npm ci
        working-directory: e2e
      - run: npx playwright install --with-deps chromium
        working-directory: e2e
      - run: npx playwright test
        working-directory: e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            e2e/playwright-report/
            e2e/test-results/
          retention-days: 7
```

Note: in CI `python3` in the webServer command resolves to setup-python's interpreter and `reuseExistingServer` is off — no venv concerns.

- [ ] **Step 3: Add README section**

Append to `README.md` under the test instructions:

```markdown
### End-to-end tests

Browser E2E suite (Playwright) covering full user journeys. It boots both
servers itself against a throwaway `backend/e2e.sqlite3`:

​```bash
cd e2e
npm install && npx playwright install chromium   # first time
npx playwright test                              # full suite
npx playwright test --headed                     # watch it run
​```
```

(Remove the zero-width characters around the inner fence when writing the file — they exist only to nest the block here.)

- [ ] **Step 4: Verify CI**

```bash
git add .github/workflows/tests.yml README.md
git commit -m "ci: backend + frontend-static + e2e workflow"
git push origin HEAD
gh run watch
```

Expected: all three jobs green. If the e2e job fails on server boot, check the uploaded artifact's stderr — the most common cause is a missing dependency in `backend/requirements.txt` that the local venv had informally.

---

## Verification (whole plan)

1. `cd backend && python3 manage.py test` — all backend tests pass (including new `catalog.test_seed_e2e`).
2. `cd e2e && npx playwright test` from a clean checkout (after `pip install -r backend/requirements.txt`, `npm install` in `frontend/` and `e2e/`) — servers self-start, all 5 spec files + smoke + api-helpers pass.
3. Second consecutive run also green with zero retries (determinism criterion from the spec).
4. GitHub Actions: three jobs green on the PR.
