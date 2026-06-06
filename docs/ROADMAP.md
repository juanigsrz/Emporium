# Roadmap & Acceptance Criteria

The team builds in vertical slices F0–F6. For each feature: **BE + FE build in
parallel** against the contract, then **QA verifies** the acceptance criteria
and files bugs. A feature is "done" only when QA passes.

Each agent must read `DESIGN.md`, `DATA_MODEL.md`, `API_CONTRACT.md` before
working, and stay inside its path (`backend/` or `frontend/`).

---

## F0 — Foundation / Scaffolding
**BE:** Django project `bgtrade` + apps (accounts, catalog, copies, events,
trades, matching). DRF, dj-rest-auth+allauth, django-filter, drf-spectacular,
corsheaders, Celery (eager). SQLite. `requirements.txt`. `python manage.py
migrate` clean. Health endpoint `GET /api/health/ → {"status":"ok"}`. CORS for
:5173. Settings read env (`DATABASE_URL`, `DEBUG`, `SECRET_KEY`).
**FE:** Vite + React + TS + Tailwind + Router + TanStack Query + axios
`apiClient` (token from store) + zustand auth store. App shell: top nav,
responsive layout, routes for Home/Games/Events/Login. Home calls `/api/health/`
and shows status. `.env` with `VITE_API_BASE`.
**QA acceptance:**
- `pip install -r requirements.txt` + `migrate` succeed; `manage.py check` clean.
- `GET /api/health/` returns 200 `{"status":"ok"}`.
- `npm install` + `npm run build` succeed; `npm run lint` clean.
- FE dev server renders shell; Home shows backend health (CORS works).

## F1 — User Accounts
**BE:** Profile (auto-created on register), `/api/auth/*`, `/api/profiles/me`,
`/api/profiles/{username}`, blocks, wishlists, ratings endpoints. Token auth.
OAuth Google route present (stub fine).
**FE:** Register/Login pages, auth store persists token, logout, Profile page
(view/edit), block button, wishlist add/remove, "my account" menu.
**QA acceptance:**
- Register → returns token; login works; bad creds → 401.
- `GET /api/profiles/me` reflects edits via PATCH.
- Block create/list/delete; wishlist add/list/delete; ratings create/list.
- FE: register→redirected authed; refresh keeps session; logout clears it.
- Object perms: cannot edit another user's profile (403).

## F2 — Canonical Games + Browsing
**BE:** BoardGame model + Celery CSV import (`import_boardgames_csv`, idempotent,
chunked). `/api/games/` list (search/filter/order/paginate), detail, copies
sub-route. Cache game detail + search.
**FE:** Games browse page (search box, condition/language/name filters,
pagination/infinite scroll, responsive grid), canonical game page (header:
title/year/rank/rating placeholders + copies list grouped underneath).
**QA acceptance:**
- Import a sample (≥1000 rows) → games queryable; re-run idempotent (no dupes).
- `/api/games/?search=Brass` returns Brass: Birmingham; ordering by rank works;
  pagination shape correct (count/next/results).
- `/api/games/{bgg_id}/` detail + `copies_count`.
- FE: search returns results <300ms cached; game page lists copies; filters work;
  layout works at 375px width.

## F3 — Individual Copies
**BE:** Copy CRUD, `listing_code` autogen, owner-only writes, filters
(`owner/board_game/status/mine`). Photo as URL list.
**FE:** "Add my copy" form on game page (condition/language/edition/notes/
photo-URL), my-copies management page, edit/withdraw.
**QA acceptance:**
- POST copy → unique `listing_code`; appears under its game.
- Non-owner PATCH/DELETE → 403. `?mine=true` filters correctly.
- FE: create copy from game page → shows in list + on game page; edit persists;
  validation errors shown.

## F4 — Trade Events + Lifecycle
**BE:** TradeEvent CRUD (slug), participation join/leave, EventListing add/remove,
`transition` action with server-side state-machine validation +
`allowed_transitions` in serializer.
**FE:** Events list, event detail (status badge, deadlines, policies), create
event (organizer), Join/Leave, "add my copies to event" (EventListings),
organizer lifecycle controls (transition buttons gated by allowed_transitions).
**QA acceptance:**
- Create event (DRAFT); only organizer edits/transitions; invalid transition →
  400; valid transition advances status.
- Join/leave; add/remove own EventListing; cannot add others' copies.
- FE: lifecycle buttons reflect `allowed_transitions`; non-organizer can't see
  organizer controls.

## F5 — X-to-Y Trades + Want List Builder (major feature)
**BE:** OfferGroup/WantGroup/WantGroupItem/TradeWish CRUD, event-scoped,
owner-only, X/Y validation, bulk want-item replace for reorder, validate
offer items are owned by user & want items reference valid targets.
**FE:** Want List Builder — drag-and-drop (@dnd-kit) to build want groups with
tiers/ranks, create offer groups from own listings, link them into wishes
(X:Y shown), bulk edit, duplicate handling. Mobile-friendly bundle management.
**QA acceptance:**
- 1-to-1 wish (Offer{Catan}X=1 → Want{Azul,Pandemic,Gloomhaven}Y=1) creates ok.
- M-to-N wish (Offer X=2 → Want Y=2) creates ok; X/Y persisted.
- Offer item not owned by user → 400; want item with neither target → 400.
- Drag-drop reorder persists tier/rank via bulk PATCH.
- FE: builder works on desktop + 375px; wishes list shows X:Y; delete/duplicate.

## F6 — Matching + Visualization + Review
**BE:** MatchRun (async Celery), FakeMatcher producing result JSON (cycles,
unmatched, stats) honoring X/Y + blocks, TradeAssignment rows, `result` +
`mine` endpoints, WS `match.progress`/`match.done` (or poll-friendly status).
**FE:** Organizer "Run matching" (in MATCHING state) with progress (WS or poll),
Match Review page: my assignments ("give X to A / receive Y from B"), cycle
visualization (graph/diagram), bundle diagrams, event-wide stats.
**QA acceptance:**
- Trigger run → MatchRun PENDING→RUNNING→DONE; result JSON matches schema;
  assignments created; blocked users never paired; X/Y bounds respected.
- `/matches/{id}/mine/` returns only requester's assignments.
- FE: run shows progress then results; cycle diagram renders; "my trades" clear;
  unmatched wishes listed. Works on mobile.

---

## Definition of Done (every feature)
1. BE: migrations apply clean; `manage.py check` clean; unit/API tests pass
   (`manage.py test`); endpoints match `API_CONTRACT.md`.
2. FE: `npm run build` + `npm run lint` clean; feature reachable in UI;
   responsive at 375 / 768 / 1280px.
3. QA: acceptance criteria above verified; bugs filed in the shared task list as
   new tasks blocking the feature task. Feature task closed only when green.
