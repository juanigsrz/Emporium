# API Contract (REST + WebSocket)

Base URL: `/api/`. All JSON. Auth via `Authorization: Token <key>` header.
This is the binding handshake between FE and BE — neither side changes a
path/shape without updating this file.

## Conventions
- **Pagination:** `PageNumberPagination`, `?page=`, `page_size=24` (max 100).
  Responses: `{count, next, previous, results: [...]}`.
- **Filtering:** django-filter via `?field=value`. **Search:** `?search=`.
  **Ordering:** `?ordering=field` / `-field`.
- **Errors:** DRF default — `400 {field: [msg]}`, `401`, `403`, `404`.
- **Timestamps:** ISO 8601 UTC.
- **Slugs/ids:** events by `slug`, games by `bgg_id`, copies by `id`.

## CORS / Dev
- FE dev server `http://localhost:5173`; API `http://localhost:8000`.
- `VITE_API_BASE` env on FE → defaults `http://localhost:8000/api`.

---

## Auth (dj-rest-auth + allauth)
| method | path | body / notes |
|---|---|---|
| POST | `/api/auth/registration/` | `{username,email,password1,password2}` → `{key}` |
| POST | `/api/auth/login/` | `{username|email,password}` → `{key}`. Bad creds → **400** (dj-rest-auth default, not 401) |
| POST | `/api/auth/logout/` | invalidates token |
| GET/PATCH | `/api/auth/user/` | current user `{pk,username,email}` |
| GET | `/api/auth/oauth/google/` | OAuth start (stub ok in v1) |

## Profiles / social (accounts)
| method | path | notes |
|---|---|---|
| GET/PATCH | `/api/profiles/me/` | current user's Profile |
| GET | `/api/profiles/{username}/` | public profile + ratings summary |
| GET/POST/DELETE | `/api/blocks/` | list/create/delete `UserBlock` (mine). POST body `{"blocked": "<username>"}`; item shape `{id, blocker, blocked, created}` |
| GET/POST/DELETE | `/api/wishlists/` | general wishlist (mine), body/filter `board_game_bgg_id` (int; becomes FK `board_game` in F2), `note` |
| GET/POST | `/api/ratings/` | trade ratings; body/filter `event_id` (int; becomes FK `event` in F4), `ratee` (username), `score`, `comment` |

## Catalog (games)
| method | path | notes |
|---|---|---|
| GET | `/api/games/` | list. `?search=` (name), `?is_expansion=`, `?ordering=rank|-users_rated|name`. Paginated. |
| GET | `/api/games/{bgg_id}/` | canonical detail (+ `copies_count`) |
| GET | `/api/games/{bgg_id}/copies/` | copies grouped under game. `?condition=&language=&event=` |

Game list item:
```json
{"bgg_id":224517,"name":"Brass: Birmingham","year_published":2018,
 "rank":1,"average":8.56,"users_rated":58687,"is_expansion":false,
 "image_url":"","copies_count":3}
```

## Copies
| method | path | notes |
|---|---|---|
| GET | `/api/copies/` | `?owner=<user_id>&board_game=<bgg_id>&status=&mine=true`. Paginated. |
| POST | `/api/copies/` | create with `board_game=<bgg_id>` (owner = request.user). Returns full copy + `listing_code`. |
| GET/PATCH/DELETE | `/api/copies/{id}/` | owner-only write. |

Copy object shape (key display fields): `owner` = user **id** (int), `owner_username` = username **string** (use this for display/links); `board_game` = **bgg_id** (int), `board_game_name` = name string; `listing_code` = `C-XXXXXX`.

## Events
| method | path | notes |
|---|---|---|
| GET | `/api/events/` | `?status=&organizer=`, `?search=name` |
| POST | `/api/events/` | create (organizer = request.user) |
| GET/PATCH/DELETE | `/api/events/{slug}/` | organizer-only write; serializer includes `allowed_transitions` |
| POST | `/api/events/{slug}/transition/` | `{to: "WANTLIST_OPEN"}` organizer-only, validated |
| GET | `/api/events/{slug}/participants/` | list participations |
| POST | `/api/events/{slug}/join/` | join (creates EventParticipation) |
| DELETE | `/api/events/{slug}/leave/` | leave |
| GET/POST | `/api/events/{slug}/listings/` | EventListings; POST `{copy}` adds own copy. `?user=&board_game=` |
| DELETE | `/api/events/{slug}/listings/{id}/` | remove own listing |
| GET | `/api/events/{slug}/games/` | **event-scoped catalog**: distinct games with active copies in this event. `?search=` (name), `?ordering=name\|rank\|-copies_count` (default `-copies_count`). Paginated. Powers the want-list builder (global catalog browsing was removed — only games tradeable here matter). |
| GET | `/api/events/{slug}/wants-export/` | organizer-only; `text/plain` wants file for the external solver. Format follows `matching_mode`: `ONETOONE` → OLWLG (`(user) CODE : wishlist`); `XTOY` → `(NforM) give -> take`. Item token = `listing_code`. |

EventGame item: `{bgg_id, name, year_published, rank, image_url, copies_count}` where `copies_count` = active EventListings of that game **in this event**.

Shapes (pinned from BE):
- **TradeEvent**: `organizer` = user **id** (int), `organizer_username` = string (use for display/links). Date fields are only `submissions_open_at`, `submissions_close_at`, `wantlist_close_at` (no `wantlist_open_at`/`matching_at`/`results_at`). Plus `allowed_transitions: string[]`, `participants_count`, `is_organizer`, `is_participant`. `matching_mode`: `"ONETOONE"` (default, online ftm solver) | `"XTOY"` (local solver, upload) — organizer-writable, frozen once status reaches `MATCHING`. `money_enabled: bool` + `max_money_per_user` (decimal string or `null` = no cap) — organizer-writable money config.
- **EventListing**: `{id, listing_code, board_game_name, board_game_id, copy_id, copy_owner_id, copy_owner_username, copy_condition, copy_language, active, created}`. (Write: POST `{copy: <copy_id>}`.) `copy_condition`/`copy_language` are lightweight distinguishers; full copy detail is on `GET /copies/{id}/`.
- **EventParticipant**: `{user: <id>, username, region, shipping_pref, max_spend, created}`. `max_spend` (decimal string) is the user's money budget; set it by POSTing `{max_spend}` to `/join/` (ignored unless `money_enabled`; rejected if it exceeds `max_money_per_user`).

## Trades (offer/want groups + wishes) — all event-scoped, mine by default
| method | path | notes |
|---|---|---|
| GET/POST | `/api/events/{slug}/offer-groups/` | `{name,max_give,item_listing_ids:[...],item_money?}`. `item_money` is the sell side: `{"<listing_id>": Q}` — min money the owner accepts to give that listing (null = not for sale). Items echo `money_amount` on read. |
| GET/PATCH/DELETE | `/api/events/{slug}/offer-groups/{id}/` | owner-only |
| GET/POST | `/api/events/{slug}/want-groups/` | `{name,min_receive,duplicate_protection?,items:[{target_type,board_game?,event_listing?,money_amount?}]}`. Wants are **binary** — no tier/rank. `duplicate_protection` (default false) is set true by the normal "My Wants" builder. Each item also returns `board_game_id` (canonical bgg id for BOTH types — use to group LISTING items under their game). `money_amount` is an optional money bid (decimal string / null). |
| GET/PATCH/DELETE | `/api/events/{slug}/want-groups/{id}/` | owner-only; PATCH bulk-replaces the item set (insertion order) |
| GET/POST | `/api/events/{slug}/wishes/` | `{offer_group, want_group, active}` |
| GET/PATCH/DELETE | `/api/events/{slug}/wishes/{id}/` | owner-only |

WantGroup item payload supports bulk replace: PATCH with a new `items` list
swaps the whole set in one call. Wants are binary (no priority/tier/rank).

## Matching
| method | path | notes |
|---|---|---|
| GET | `/api/events/{slug}/matches/` | list MatchRuns (newest first) |
| POST | `/api/events/{slug}/matches/` | organizer triggers a run (async). `ONETOONE` only — calls the hosted ftm solver (or offline FakeMatcher when `MATCHING_USE_ONLINE_SOLVER` is off). `XTOY` → **400** (use `/upload/`). Returns `{id,status:"PENDING"}`. Event must be `MATCHING`. |
| POST | `/api/events/{slug}/matches/upload/` | organizer uploads a locally-solved result. Body = raw solver stdout (`text/plain`) or `{"output": "..."}`. Parser follows `matching_mode` (`XTOY`→gurobi, `ONETOONE`→ftm). Creates a DONE run + assignments. `400` on unknown listing code; `403` non-organizer; `400` if not `MATCHING`. |
| GET | `/api/events/{slug}/matches/{id}/` | run detail incl. `summary`, `log`, `status` |
| GET | `/api/events/{slug}/matches/{id}/result/` | full result JSON (see DATA_MODEL) |
| GET | `/api/events/{slug}/matches/{id}/mine/` | current user's assignments only (**paginated**, like all list endpoints). Includes both give-side (`giver_username`==me) and receive-side (`receiver_username`==me) rows. |

## WebSocket (optional v1; FE polls if WS absent)
- `ws://localhost:8000/ws/events/{slug}/`
- Server → client messages:
```json
{"type":"match.progress","run_id":3,"status":"RUNNING","pct":40,"msg":"building graph"}
{"type":"match.done","run_id":3}
{"type":"listing.update","action":"created","listing_id":55}
```
- FE: subscribe on event page; on `match.*` invalidate TanStack Query keys.
  If WS connection fails, fall back to polling `/matches/{id}/` every 2s while a
  run is PENDING/RUNNING.

## OpenAPI
- `/api/schema/` (drf-spectacular) + `/api/docs/` (Swagger UI). FE may generate
  types from `/api/schema/` but hand-written types are fine for v1.
