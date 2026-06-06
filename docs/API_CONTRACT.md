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

Shapes (pinned from BE):
- **TradeEvent**: `organizer` = user **id** (int), `organizer_username` = string (use for display/links). Date fields are only `submissions_open_at`, `submissions_close_at`, `wantlist_close_at` (no `wantlist_open_at`/`matching_at`/`results_at`). Plus `allowed_transitions: string[]`, `participants_count`, `is_organizer`, `is_participant`.
- **EventListing**: `{id, listing_code, board_game_name, board_game_id, copy_id, copy_owner_id, copy_owner_username, active, created}`. (Write: POST `{copy: <copy_id>}`.)
- **EventParticipant**: `{user: <id>, username, region, shipping_pref, created}`.

## Trades (offer/want groups + wishes) — all event-scoped, mine by default
| method | path | notes |
|---|---|---|
| GET/POST | `/api/events/{slug}/offer-groups/` | `{name,max_give,item_listing_ids:[...]}` |
| GET/PATCH/DELETE | `/api/events/{slug}/offer-groups/{id}/` | owner-only |
| GET/POST | `/api/events/{slug}/want-groups/` | `{name,min_receive,items:[{target_type,board_game?,event_listing?,tier,rank}]}` |
| GET/PATCH/DELETE | `/api/events/{slug}/want-groups/{id}/` | owner-only; PATCH replaces items for drag-drop reorder |
| GET/POST | `/api/events/{slug}/wishes/` | `{offer_group, want_group, active}` |
| GET/PATCH/DELETE | `/api/events/{slug}/wishes/{id}/` | owner-only |

WantGroup item create/reorder payload supports bulk replace so the drag-drop
builder can PATCH the whole ordered list in one call.

## Matching
| method | path | notes |
|---|---|---|
| GET | `/api/events/{slug}/matches/` | list MatchRuns (newest first) |
| POST | `/api/events/{slug}/matches/` | organizer triggers a run (async). Returns `{id,status:"PENDING"}` |
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
