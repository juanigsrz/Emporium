# Math Trade — Frontend

Next.js (App Router) + TypeScript frontend for the board-game math-trade platform.
It consumes the Django + DRF REST API described in the repo-root `PLAN.md` (§9), and
ships with an in-browser **MSW mock backend** so the whole app is runnable before the
real backend exists.

## Quick start

```bash
npm install

# Run against the in-browser mock backend (no Django needed):
npm run dev:mock        # http://localhost:3000  — log in as alice / password (organizer)

# Run against a real backend:
cp .env.example .env.local   # set DJANGO_API_URL, leave NEXT_PUBLIC_USE_MOCKS=0
npm run dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev:mock` | Dev server with the MSW mock backend (`NEXT_PUBLIC_USE_MOCKS=1`). |
| `npm run dev` | Dev server against the real `DJANGO_API_URL`. |
| `npm run build` | Production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run test` | Vitest unit tests (lifecycle + statement validation). |

## Architecture

- **BFF proxy** (`app/api/dj/[...path]`) forwards requests to Django and attaches the
  DRF token from an **httpOnly cookie**, so the token never reaches client JS and there
  is no CORS surface. Auth route handlers (`app/api/auth/*`) set/clear that cookie.
- **API layer** (`lib/api`) — typed client + resource modules mapping 1:1 to PLAN §9,
  with types mirroring the §5 data model and Appendix A enums.
- **Lifecycle** (`lib/lifecycle.ts`) — single source of truth for what each event status
  allows (PLAN §7), consumed by every event screen.
- **Mocks** (`mocks/`) — a stateful in-memory backend implementing §9, including a
  `FakeMatcher` (§8.4) that produces valid assignments; enabled in mock mode only.

## Mock walkthrough

Log in as `alice` / `password`, then: link + import a BGG collection → add a copy →
create an event → enter copies → move to *Open for want list* → author a classic want
list and an M-to-N bundle → move to *Matching* → **Run match** → move to *Match review*
to see assignments → *Finalization* → *Shipping* → mark shipped/received.
