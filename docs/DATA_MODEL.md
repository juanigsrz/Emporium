# Data Model

Django models grouped by app. Field types are guidance; BE may refine but must
keep names/relations stable since the API contract and FE depend on them.

Conventions: all models have `created`/`updated` (`auto_now_add`/`auto_now`)
unless noted. PKs are auto `BigAutoField` unless stated. Enums use
`models.TextChoices`.

---

## accounts

### Profile (1-1 with `auth.User`)
| field | type | notes |
|---|---|---|
| user | OneToOne(User) | PK link |
| display_name | char(80) | |
| bgg_username | char(64) blank | linked BGG account |
| bio | text blank | |
| location | char(120) blank | free text |
| region | char(64) blank | for regional restrictions |
| avatar_url | url blank | v1: URL only |

### UserBlock
| field | type | notes |
|---|---|---|
| blocker | FK(User, related=blocks_made) | |
| blocked | FK(User, related=blocks_against) | |
unique_together = (blocker, blocked). A blocked pair is never matched together.

### Wishlist (general, event-independent)
| field | type | notes |
|---|---|---|
| user | FK(User) | |
| board_game | FK(BoardGame) | |
| note | char(200) blank | |
unique_together = (user, board_game).

### TradeRating
| field | type | notes |
|---|---|---|
| event | FK(TradeEvent) | |
| rater | FK(User, related=ratings_given) | |
| ratee | FK(User, related=ratings_received) | |
| score | int (1–5) | |
| comment | text blank | |
unique_together = (event, rater, ratee).

---

## catalog

### BoardGame (canonical, indexed by BGG id)
| field | type | notes |
|---|---|---|
| bgg_id | int **PK** | from CSV `id` |
| name | char(300) **db_index** | |
| year_published | int null | |
| rank | int null db_index | overall rank |
| bayes_average | float null | |
| average | float null | raw avg rating |
| users_rated | int default 0 | |
| is_expansion | bool default False | |
| category_ranks | JSON default dict | {abstracts, family, strategy, ...} from CSV |
| image_url | url blank | future BGG sync |
| year_synced | bool default False | future-sync marker |

Future-sync fields (designers, publishers, mechanics, categories, player
counts, playtime, expansions) are **deferred**; expose them as empty/null in the
API now so the FE can render placeholders. Add a `metadata` JSON field
(default dict) to hold them when BGG API sync lands.

CSV import (Celery task `import_boardgames_csv`): read `boardgames_ranks.csv`
(177k rows), `bulk_create` in chunks of 2000, map columns:
`id→bgg_id, name, yearpublished→year_published, rank, bayesaverage,
average, usersrated→users_rated, is_expansion`, and the `*_rank` columns into
`category_ranks`. Idempotent (`update_or_create` by bgg_id or a guarded
`ignore_conflicts`).

---

## copies

### Copy (a physical listing; unique id independent from BGG id)
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| listing_code | char(12) unique db_index | short human code, e.g. `C-4F2A9` |
| owner | FK(User, related=copies) | |
| board_game | FK(BoardGame, related=copies) | groups under canonical game |
| condition | choice | NEW, LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR |
| language | char(64) blank | |
| edition | char(120) blank | |
| sleeved | choice | UNKNOWN, NONE, SLEEVED |
| includes_expansions | text blank | what's bundled |
| missing_components | text blank | |
| upgraded_components | text blank | |
| component_notes | text blank | |
| owner_notes | text blank | |
| trade_value_hint | char(120) blank | |
| shipping_constraints | text blank | |
| pickup_available | bool default False | |
| photo_urls | JSON default list | v1: list of URLs, no binary upload |
| status | choice | ACTIVE, RESERVED, TRADED, WITHDRAWN |

`listing_code` generated server-side on create.

---

## events

### TradeEvent
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| name | char(200) | |
| slug | slug unique db_index | URL key |
| description | text blank | |
| organizer | FK(User, related=events_organized) | |
| status | choice | DRAFT, SUBMISSIONS_OPEN, WANTLIST_OPEN, MATCHING, MATCH_REVIEW, FINALIZATION, SHIPPING, ARCHIVED |
| matching_mode | choice default ONETOONE | ONETOONE (online ftm solver) / XTOY (local solver, upload). Selects solver + export/run flow; frozen once MATCHING. |
| submissions_open_at | datetime null | |
| submissions_close_at | datetime null | |
| wantlist_close_at | datetime null | |
| shipping_rules | text blank | |
| regional_restrictions | text blank | |
| trade_policies | text blank | |
| algorithm_settings | JSON default dict | solver knobs |
| money_enabled | bool default False | organizer allows money in trades |
| max_money_per_user | decimal(10,2) null | per-user spend cap (null = no cap) |

Allowed transitions enforced server-side (see DESIGN §5). Expose
`allowed_transitions` in the serializer for the FE.

### EventParticipation
| field | type | notes |
|---|---|---|
| event | FK(TradeEvent, related=participations) | |
| user | FK(User, related=event_participations) | |
| region | char(64) blank | |
| shipping_pref | char(120) blank | |
| max_spend | decimal(10,2) default 0 | user's money budget for the event (set via join; capped by max_money_per_user) |
unique_together = (event, user).

### EventListing (a Copy entered into an event = the matchable unit)
| field | type | notes |
|---|---|---|
| event | FK(TradeEvent, related=listings) | |
| copy | FK(Copy, related=event_listings) | |
| active | bool default True | |
unique_together = (event, copy). Matching operates on `EventListing`s.

---

## trades

### OfferGroup (reusable; the user's own copies)
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| event | FK(TradeEvent, related=offer_groups) | |
| user | FK(User, related=offer_groups) | |
| name | char(120) | |
| max_give | int default 1 | **X** — max copies user will give |
| rules | JSON default dict | optional internal rules |

### OfferGroupItem
| field | type | notes |
|---|---|---|
| offer_group | FK(OfferGroup, related=items) | |
| event_listing | FK(EventListing, related=offer_memberships) | user's own listing |
| money_amount | decimal(10,2) null | sell-side **Q**: min money the owner accepts to give this listing for money (null = not for sale). Money trade feasible only when a buyer's `WantGroupItem.money_amount` (P) ≥ this Q. Placeholder for MIP. |
unique_together = (offer_group, event_listing). Validate listing.copy.owner == group.user.

### WantGroup (reusable; targets the user wants)
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| event | FK(TradeEvent, related=want_groups) | |
| user | FK(User, related=want_groups) | |
| name | char(120) | |
| min_receive | int default 1 | **Y** — min copies user must receive |
| duplicate_protection | bool default False | solver must not award >1 copy of the same canonical game; set True by the normal "My Wants" builder, left False by the advanced X-to-Y builder |

### WantGroupItem (a binary want target)
| field | type | notes |
|---|---|---|
| want_group | FK(WantGroup, related=items) | |
| target_type | choice | BOARD_GAME, LISTING |
| board_game | FK(BoardGame) null | when target_type=BOARD_GAME (any copy) |
| event_listing | FK(EventListing) null | when target_type=LISTING (specific) |
| money_amount | decimal(10,2) null | buy-side **P**: max money the user pays to receive this game (not a priority sweetener — needs a seller accepting money, see OfferGroupItem.money_amount). Placeholder for MIP. |
Exactly one of board_game / event_listing set (validate). Wants are **binary** —
you want a target or you don't; no priority/tier/rank (neither solver consumes
priority). Items keep insertion order.

### TradeWish (ties one OfferGroup → one WantGroup)
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| event | FK(TradeEvent, related=wishes) | |
| user | FK(User, related=wishes) | |
| offer_group | FK(OfferGroup, related=wishes) | |
| want_group | FK(WantGroup, related=wishes) | |
| active | bool default True | |
Effective bounds: X = offer_group.max_give, Y = want_group.min_receive.

---

## matching

### MatchRun
| field | type | notes |
|---|---|---|
| id | BigAuto PK | |
| event | FK(TradeEvent, related=match_runs) | |
| status | choice | PENDING, RUNNING, DONE, FAILED |
| algorithm | char(40) default "fake" | |
| started_at | datetime null | |
| finished_at | datetime null | |
| summary | JSON default dict | counts: matched_wishes, cycles, unmatched |
| result | JSON default dict | full result blob (see schema below) |
| log | text blank | human-readable progress log |

### TradeAssignment (normalized result row, for queries + viz)
| field | type | notes |
|---|---|---|
| match_run | FK(MatchRun, related=assignments) | |
| event_listing | FK(EventListing) | the copy being moved |
| giver | FK(User, related=assignments_given) | current owner |
| receiver | FK(User, related=assignments_received) | new owner |
| wish | FK(TradeWish) null | which wish it satisfied |
| cycle_id | int | groups assignments into a trade cycle |

### Result JSON schema (`MatchRun.result`) — the solver contract
```json
{
  "algorithm": "fake",
  "generated_at": "ISO8601",
  "cycles": [
    {
      "id": 1,
      "length": 3,
      "steps": [
        {"listing_code": "C-4F2A9", "board_game": "Catan",
         "from_user": "alice", "to_user": "bob", "wish_id": 12}
      ]
    }
  ],
  "unmatched": [{"wish_id": 7, "reason": "no viable cycle"}],
  "stats": {"users": 10, "listings": 40, "matched": 18, "cycles": 6}
}
```
The real solver must emit this shape. `FakeMatcher` emits it from random/greedy
valid cycles honoring X/Y bounds and `UserBlock`.
