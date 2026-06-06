# MathTrade Platform — Master Design

A modern web platform for board-game **math trades**, inspired by the classic
On-Line Want List Generator (OLWLG) but redesigned for scale, usability,
transparency, and advanced M-to-N trade flexibility.

This document is the **single source of truth** for the build team. The
back-end developer, front-end developer, and QA agent all build against the
contracts defined here and in the sibling docs:

- `DATA_MODEL.md` — database schema (the heart of the system)
- `API_CONTRACT.md` — REST + WebSocket contract shared by FE and BE
- `ROADMAP.md` — feature breakdown F0–F6 + per-feature QA acceptance criteria

---

## 1. Product Summary

Users run large, convention-scale **Trade Events**. In each event, users list
physical **copies** of board games they own and define what they want. The
system computes optimal trade cycles. Browsing happens at the **canonical game
level** (BoardGameGeek game), with individual user copies grouped underneath.

The platform supports two trade styles unified under one representation:

- **Traditional 1-to-1** — give item A, want any of {B, C, D}.
- **Advanced M-to-N** — give up to X items from an *offer group*, receive at
  least Y items from a *want group*.

Both are expressed as `(OFFER GROUP) --X:Y--> (WANT GROUP)` (see §4).

## 2. Core Principles

- **Game-centric browsing.** Discovery starts at the canonical game; copies are
  grouped underneath it.
- **Transparency.** Match results, cycles, and bundle diagrams are visualized so
  users understand *why* a trade happened.
- **Solver-agnostic.** The optimization solver lives elsewhere. We ship a
  `FakeMatcher` placeholder that conforms to the result JSON schema (see
  `DATA_MODEL.md` §Matching) so the real solver can drop in later.
- **Scale-ready, SQLite-first.** v1 runs on SQLite. The architecture (caching,
  async jobs, pagination) is built so a swap to Postgres is a settings change.

## 3. Recommended Tech Stack

### Backend
- **Django 5.2 LTS + Django REST Framework** — core API.
- **dj-rest-auth + django-allauth** — email/password + OAuth (Google) login.
  Token auth for v1 (JWT-ready).
- **django-filter** — declarative filtering. DRF `SearchFilter` /
  `OrderingFilter` for search + sort.
- **drf-spectacular** — OpenAPI 3 schema (auto API docs, FE type generation).
- **django-cors-headers** — CORS for the Vite dev server.
- **Celery + Redis** — async optimization jobs and CSV import. Runs in
  `CELERY_TASK_ALWAYS_EAGER` mode when no broker is present so dev/tests work
  without Redis.
- **Channels + Redis (optional in v1)** — WebSocket push for match progress and
  live listing updates. Falls back to client polling when the channel layer is
  the in-memory layer.
- **SQLite** (v1) → Postgres (prod) via `DATABASE_URL`.

### Frontend
- **React 18 + Vite + TypeScript** — SPA.
- **Tailwind CSS** — responsive, mobile-first styling.
- **React Router v6** — routing.
- **TanStack Query** — server-state cache, optimistic updates, polling.
- **axios** — HTTP client with a shared `apiClient` (token injection, refresh).
- **@dnd-kit** — drag-and-drop want-list / priority builder.
- **react-hook-form + zod** — forms + validation.
- **zustand** — light global UI state (auth session, active event).

### Async & Caching
- Celery workers for: CSV → `BoardGame` import, match runs, heavy aggregations.
- Redis cache for game search results and canonical game pages (high read).
- Per-view DRF throttling; cache-control headers on canonical game endpoints.

## 4. The Unified X-to-Y Trade Model (key innovation)

Every trade intention is a **TradeWish** linking one reusable **OfferGroup** to
one reusable **WantGroup**:

```
(OfferGroup, max_give = X)  --->  (WantGroup, min_receive = Y)
```

- **OfferGroup** — a named set of the *wishing user's own copies* in the event,
  plus `max_give` (X = max number of those copies the user will part with).
- **WantGroup** — a named set of targets the user wants. Each target is either a
  **canonical game** ("any copy of Azul") or a **specific listing**, with a
  `tier` and `rank` for priority. `min_receive` (Y) = minimum the user must get.

### Examples
- **1-to-1 (classic):** OfferGroup `{Catan}` X=1 → WantGroup `{Azul, Pandemic,
  Gloomhaven}` Y=1. "Give Catan for any one of these three."
- **M-to-N:** OfferGroup `{Catan, Azul, Pandemic}` X=2 → WantGroup
  `{Brass, Wingspan, Dune}` Y=2. "Give any 2 of mine, receive any 2 of those."

This single representation removes the artificial 1↔1 constraint and lets the
solver treat all wishes uniformly. The Want List Builder UI (F5) is the primary
surface for constructing these groups via drag-and-drop.

## 5. Trade Event Lifecycle

`DRAFT → SUBMISSIONS_OPEN → WANTLIST_OPEN → MATCHING → MATCH_REVIEW →
FINALIZATION → SHIPPING → ARCHIVED`

| State | What users can do |
|---|---|
| DRAFT | Organizer edits event settings; not public. |
| SUBMISSIONS_OPEN | Participants add copies/listings to the event. |
| WANTLIST_OPEN | Participants build offer/want groups + wishes. |
| MATCHING | Locked; a `MatchRun` executes (async). |
| MATCH_REVIEW | Results visible; users review their assigned trades. |
| FINALIZATION | Trades confirmed; non-confirmers handled per policy. |
| SHIPPING | Logistics, tracking, completion marking. |
| ARCHIVED | Read-only history; ratings collected. |

State transitions are organizer-only and validated server-side (no skipping
backwards except organizer-forced re-open).

## 6. Example Workflows

1. **List a copy:** Search "Spirit Island" → open canonical page → "Add my
   copy" → fill condition/language/notes → copy appears grouped under the game.
2. **Join an event & build wants:** Open event → Join → add owned copies as
   event listings → open Want List Builder → drag games into want groups, set
   tiers → create wishes linking offer↔want groups.
3. **Run matching (organizer):** Move event to MATCHING → triggers async
   `MatchRun` → progress streamed via WS/poll → results land in MATCH_REVIEW.
4. **Review & complete:** User sees "You give Catan to Bob; you receive Azul
   from Alice" with a cycle diagram → confirms → SHIPPING → rate partners.

## 7. Matching Scenarios (FakeMatcher must handle)

- **Simple 2-cycle:** A gives Catan→B, B gives Azul→A.
- **3-cycle:** A→B→C→A.
- **M-to-N partial:** OfferGroup X=2 where only 1 of the 2 offered copies is
  matched (respects "up to X").
- **Unmatched:** wishes with no viable cycle stay unmatched and are reported.
- **Blocked users:** never matched to each other (respect `UserBlock`).

The `FakeMatcher` produces a deterministic-ish greedy set of valid assignments
honoring X/Y bounds and blocks, and writes results in the result JSON schema so
the UI/visualizations are exercised before the real solver exists.

## 8. Scalability Considerations

- **Reads dominate** (browsing). Cache canonical game pages + search; paginate
  everything (page size 24, max 100). `select_related` / `prefetch_related` on
  all list endpoints to avoid N+1.
- **177k+ games** imported via chunked Celery task with `bulk_create`. Game
  search backed by DB index on `name` (v1) → Postgres `pg_trgm` / search vector
  later.
- **Async heavy work** (match runs, imports) off the request path via Celery.
- **WebSockets** only for event rooms (match progress, listing deltas), not
  global fan-out. Horizontal scaling via Redis channel layer.
- **Stateless API** + token auth → scale workers horizontally behind a LB.
- **DB swap path:** SQLite → Postgres via `DATABASE_URL`; no raw SQL, ORM only.

## 9. Security Considerations

- Token auth (httpOnly-cookie or Authorization header); HTTPS only in prod.
- Object-level permissions: a user may only edit their own copies/groups/wishes;
  organizers manage their own events.
- `UserBlock` enforced in matching and optionally hides listings.
- Server-side validation of all state transitions and X/Y bounds.
- Rate limiting (DRF throttles) on auth + search.
- CORS locked to the known frontend origin. CSRF for session endpoints.
- Uploaded media (photos) validated by type/size; v1 stores **URLs/paths only**
  (no binary upload) to avoid native image deps — real upload is a later task.
- Secrets via env vars; `DEBUG=False` + `ALLOWED_HOSTS` in prod.

## 10. Migration Strategy from Classic OLWLG

- **Importer** maps OLWLG geeklist/want-list text dumps → our model: each OLWLG
  item line → a `Copy` + `EventListing`; each want line → a `WantGroupItem`
  under a 1-to-1 `TradeWish` (OfferGroup `{that item}` X=1).
- OLWLG "official names" map to BGG IDs via the `boardgames_ranks.csv` name
  index; unmatched names flagged for manual resolution.
- Result format: our result JSON is a superset of OLWLG's "official results", so
  legacy result viewers can be supported with a thin adapter.
- Run alongside legacy: events can be flagged `legacy_import` and remain
  read-only mirrors during transition.

## 11. Repository Layout

```
mathtrade-app/
├── backend/                 # Django project (BE agent owns)
│   ├── bgtrade/             # settings, urls, asgi, celery
│   ├── accounts/            # users, profiles, blocks, wishlists, ratings
│   ├── catalog/             # BoardGame canonical + CSV import
│   ├── copies/              # Copy listings
│   ├── events/              # TradeEvent, participation, listings, lifecycle
│   ├── trades/              # OfferGroup, WantGroup, TradeWish
│   ├── matching/            # MatchRun, assignments, FakeMatcher, Celery task
│   ├── manage.py
│   └── requirements.txt
├── frontend/                # Vite React app (FE agent owns)
│   ├── src/
│   │   ├── api/             # apiClient + typed endpoint hooks
│   │   ├── components/      # shared UI
│   │   ├── features/        # per-domain pages (games, events, wants, ...)
│   │   ├── routes/          # router config
│   │   └── store/           # zustand
│   └── package.json
└── docs/                    # this contract (tech-lead owns)
```

**Path ownership is strict:** BE only edits `backend/`, FE only edits
`frontend/`, tech-lead owns `docs/`. This lets FE and BE work in parallel
without conflicts.
