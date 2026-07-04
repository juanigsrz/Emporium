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
| latitude | float null | geocoded latitude |
| longitude | float null | geocoded longitude |
| max_trade_distance_km | posint null | self-imposed distance limit (km) |
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
| board_game_bgg_id | PositiveInteger | BGG id (still an int, not a FK — the F2 FK conversion was deferred; the wishlist sync writes this directly) |
| note | char(200) blank | |
unique_together = (user, board_game_bgg_id).

### GameRating (F2)
| field | type | notes |
|---|---|---|
| user | FK(User, related=game_ratings) | |
| board_game | FK(BoardGame, related=ratings) | |
| value | decimal(3,1) (1–10) | personal rating |
unique_together = (user, board_game). POST is an upsert — re-posting updates `value`.

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
| is_pending | bool default False | True when language or condition is blank; recomputed on PATCH |
| import_source | char(40) blank | tag for import origin: `"BGG_OWNED"` or `"BGG_GEEKLIST"`; empty for manual copies |

`listing_code` generated server-side on create. A copy with `is_pending=True` cannot be entered into an event.

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
| submissions_open_at | datetime null | |
| submissions_close_at | datetime null | |
| wantlist_close_at | datetime null | |
| shipping_rules | text blank | |
| regional_restrictions | text blank | |
| require_location | bool default False | gate: participants must have lat/lng |
| center_latitude | float null | event location center latitude |
| center_longitude | float null | event location center longitude |
| max_distance_km | posint null | max haversine distance from center (null = no gate) |
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
| event_listing | FK(EventListing, related=offer_memberships) null | user's own listing |
| combo | FK(Combo, related=offer_memberships) null | user's own bundle |
Exactly one of event_listing / combo set (check constraint); unique per group per
target. Validate the target belongs to the group's user.

Money moved off the item: sell-side **Q** now lives in the pricing model
(`EventListing.sell_price` per copy, `Combo.sell_price` per bundle, else the
owner's `UserGamePrice` default) — see the `trades` pricing models below. There
is no `OfferGroupItem.money_amount`.

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
| event_listing | FK(EventListing) null | a specific listing target |
| combo | FK(Combo) null | a specific bundle target |
Exactly one of event_listing / combo set (check constraint). A "want any copy of
game X" is expanded to the concrete listing targets at build time by the want
builder / export, not stored as a BOARD_GAME target. Wants are **binary** — you
want a target or you don't; no priority/tier/rank (neither solver consumes
priority). Items keep insertion order.

Money moved off the item: buy-side **P** now lives in the pricing model
(`WantBid` per target override, else the user's `UserGamePrice` default) — see the
`trades` pricing models. There is no `WantGroupItem.money_amount` or
`target_type`/`board_game` column.

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
