# Solver Integration Plan

Status: **IMPLEMENTED** (backend `matching/external_solver.py`, export + upload
endpoints, mode routing, 209 tests green, live round-trip vs the hosted ftm
solver; frontend mode picker + download/upload UI, build/lint/tsc clean, live
HTTP smoke green). The sections below are the design of record; deviations from
the original plan are noted inline.

Goal: let an organizer pick how an event is matched, export a `wants.txt` the
external [FastTradeMaximizer](../../FastTradeMaximizer) solver understands, run
the solve, and load the solution back as a normal `MatchRun` so the existing
result UI (`/matches/{id}/`, `/result/`, `/mine/`) works unchanged.

Two modes, two solvers, two file formats, two run locations:

| Mode | Solver | Input format | Output | Runs where |
|---|---|---|---|---|
| `ONETOONE` (old-school) | modal C++ `ftm` | OLWLG: `(user) ITEM : wish wish` | `TRADE LOOPS` text | hosted → **backend calls `/solve` server-side** |
| `XTOY` | gurobi `main.py` | `(NforM) give… -> take…` | `give -> take` lines | **organizer's machine** (Gurobi license) → uploads stdout |

Decisions locked (from review): 1-to-1 runs by the **server calling modal**;
X-to-Y solution is uploaded as **raw solver stdout**; this doc is **plan-only**.

---

## 1. Data model

Add one field to `TradeEvent` (`backend/events/models.py`):

```python
class MatchingMode(models.TextChoices):
    ONETOONE = "ONETOONE", "Old-school 1-to-1 (online solver)"
    XTOY     = "XTOY",     "X-to-Y (local solver)"

matching_mode = models.CharField(
    max_length=10, choices=MatchingMode.choices, default=MatchingMode.ONETOONE
)
```

- Default `ONETOONE` — preserves current/expected behavior for plain events.
- One migration. Expose on the event serializer (read + organizer-writable);
  freeze edits once `status` reaches `MATCHING` (organizer shouldn't swap the
  mode mid-run). Not stuffed into `algorithm_settings` — a real field reads
  cleaner and is filterable.
- `MatchRun.algorithm` records which solver ran: `"ftm-online"` / `"gurobi-xy"`
  (field already exists, default `"fake"`).

The token that identifies an item in every export **and** the uploaded result is
the `Copy.listing_code` (`C-XXXXXX`) — unique, stable, human-readable, no spaces.
Round-trips cleanly through both solvers.

---

## 1b. Simplification: remove priorities/tiers

Wants are binary (wish or not). `WantGroupItem.tier` and `.rank` have no
meaning and are removed — neither solver consumes priority, and keeping them
implies a ranking the system doesn't honor.

Blast radius (own step, plan-only here):
- `trades/models.py`: drop `tier`, `rank` from `WantGroupItem`; `Meta.ordering`
  → `["id"]`. Migration.
- `trades/serializers.py`: want-item payload becomes
  `{target_type, board_game?, event_listing?}`. `min_receive`/`max_give` stay —
  those are the X/Y bounds, not priorities.
- `matching/fake_matcher.py`: no logic uses tier/rank; only the queryset order
  changes — harmless.
- FE: `api/trades.ts` types, `features/trades/MyWantsPage.tsx` (cells are already
  binary on/off — drops cleanly), `features/trades/WantListBuilderPage.tsx` (its
  @dnd-kit drag-to-rank loses its purpose → deprecate or strip to plain add/remove;
  flag for decision, don't auto-delete).
- Docs: `API_CONTRACT.md` want-group payload, `DATA_MODEL.md`.
- The want-group PATCH still bulk-replaces the item set; "reorder" semantics drop.

## 2. Export — `GET /api/events/{slug}/wants-export/`

Organizer-only. Returns `text/plain` (`Content-Disposition: attachment;
filename="{slug}-wants.txt"`). Body format depends on `matching_mode`. Built
from **active** `TradeWish`es of the event (`active=True`, event-scoped), same
source the `FakeMatcher` reads.

Shared want-expansion (canonical → concrete), per want group:
- `LISTING` target → that listing's `listing_code` (if active).
- `BOARD_GAME` target → every active `EventListing` of that game **owned by
  someone else**, ordered by listing_code.
- Drop any listing owned by a user the wisher has blocked, and any owned by the
  wisher. (See §6 — this is the only place blocks can be enforced for `XTOY`.)
- Wants are **binary** — you wish for something or you don't. No priority, no
  ordering. Emit each want set de-duplicated in stable `listing_code` order
  purely for determinism. (See §1b — `tier`/`rank` are removed from the model.)

### 2a. `ONETOONE` → OLWLG format (consumed by modal `ftm`)

```
#! ALLOW-DUMMIES REQUIRE-COLONS REQUIRE-USERNAMES
(trader01) C-000001 : C-000042 C-000099
(trader02) C-000042 : C-000001
```

- One line **per active EventListing** that the owner is offering, not per wish:
  `(username) <listing_code> : <wishlist>`. ftm's model is per-item.
- The wishlist for a listing = expansion of the want group(s) reachable from the
  offer group(s) that contain this listing, de-duplicated (binary wants — no
  order; stable `listing_code` order for determinism).
- A listing with no wants → `(user) C-XXXXXX :` (empty list) — legal, just won't
  trade.
- Every token referenced in a wishlist is itself another active listing, so it
  gets its own line; no `!BEGIN-OFFICIAL-NAMES` block needed. (Optional nicety:
  emit an official-names block mapping `C-XXXXXX → game name` for readability.)
- ftm uppercases tags/usernames unless `CASE-SENSITIVE`; `C-XXXXXX` is already
  upper, fine.

### 2b. `XTOY` → gurobi format (consumed by `main.py`)

```
(1for1) C-000001 -> C-000042
(2for1) C-000003 C-000004 -> C-000077
(1for2) C-000005 -> C-000088 C-000099
```

- One line **per active TradeWish**: `(NforM) <give codes> -> <take codes>`
  where `N = offer_group.max_give`, `M = want_group.min_receive`.
- give = the offer group's listing codes; take = expanded want codes.
- No usernames in this format — blocks must be applied during take-expansion
  (§6). Sharing an offer listing across wishes is safe: `main.py` constrains
  every real item node to `in == out` and `in <= 1`, so a listing trades at
  most once globally.

---

## 3. Run flows

### 3a. `ONETOONE` — server calls modal

Reuse `POST /api/events/{slug}/matches/` (organizer-only, `status==MATCHING`).
When `matching_mode == ONETOONE`:
1. Create `MatchRun(status=PENDING, algorithm="ftm-online")`.
2. Celery task (`matching/tasks.py`) builds the OLWLG body (§2a) and POSTs it to
   the solver endpoint with `--data-binary` semantics (raw text body):
   `POST {SOLVER_URL}/solve`, read JSON `{ok, ms, output, log}`.
3. Parse `output` (§4a) → cycles → `result`/`summary`/`TradeAssignment` rows,
   mark `DONE`. On `422`/`504`/network error → `FAILED`, stash the solver's
   `log`/`detail` tail in `MatchRun.log`.
4. FE polls `/matches/{id}/` as today.

Config: `SOLVER_URL` Django setting (default
`https://juanigsrz--fasttrademaximizer-web.modal.run`), `SOLVER_TIMEOUT`
(default 250s, above modal's 240s cap). Outbound HTTP via `httpx`/`requests`
(new dep — backend currently has no native deps; `requests` is pure-python).

For `XTOY`, `POST /matches/` returns `400` ("this event matches via uploaded
solution — use /matches/upload/").

### 3b. `XTOY` (and optional manual `ONETOONE`) — upload stdout

New `POST /api/events/{slug}/matches/upload/` — organizer-only,
`status==MATCHING`. Body = raw solver stdout (`text/plain`).
1. Create `MatchRun(status=RUNNING, algorithm="gurobi-xy")`.
2. Parse by mode: `XTOY` → §4b, `ONETOONE` manual → §4a.
3. Build result + assignments (§5), mark `DONE`; parse failure → `400` with the
   offending line (do not persist a half-run) or a `FAILED` run with the error
   logged. (Plan: validate first, persist only on success.)

Workflow for the organizer: set mode `XTOY` → transition to `MATCHING` →
**Download wants.txt** → run `python main.py wants.txt` locally (Gurobi) →
**Upload** the printed output → review.

---

## 4. Output parsers (`matching/parsers.py`, new)

Both produce the same intermediate: a list of directed edges
`(listing_code, giver_username, receiver_username)` — "this listing moves from
giver to receiver".

### 4a. ftm OLWLG output

`show()` default = `(username) tag`. The trade section:
```
TRADE LOOPS (N total trades):

(trader02) C-000042 receives (trader01) C-000001
(trader01) C-000001 receives (trader02) C-000042
                                                      <- blank line separates loops
ITEM SUMMARY (...):
```
- Slice between the `TRADE LOOPS (` header and the next section (`ITEM SUMMARY`).
- Each non-blank line: `(<recv_user>) <recv_tag> receives (<give_user>) <give_tag>`.
  The **moved listing = give_tag** (right side, `current` in `main.cpp`): it
  leaves `give_user` (giver) and arrives at `recv_user` (receiver).
  → edge `(give_tag, give_user, recv_user)`.
- Blank lines delimit loops → free `cycle_id` per block.

### 4b. gurobi output

```
Trade Results:
C-000001 -> C-000042
C-000003 C-000004 -> C-000077
```
- Lines after `Trade Results:` of the form `G… -> T…`.
- The wisher = owner of the give tokens; each take token `T` is **received** by
  the wisher from `owner(T)`. → for each take `T`: edge `(T, owner(T), wisher)`,
  where `wisher = owner(give[0])`. (The give side is redundant — it reappears as
  some other line's take side.)
- No usernames in the file → giver/receiver derived purely from the
  `EventListing` ownership lookup (no cross-check possible, none needed).
- No loop delimiters, and the result is **not** a set of clean cycles (§5) →
  group by connected component, not ring.

---

## 5. Edges → groups → persistence (shared)

Both parsers yield the same intermediate edge list
`(listing_code, giver_username, receiver_username)`. Each **traded listing moves
exactly once** (gurobi constrains every item node to `in == out`, `in <= 1`;
ftm cycles likewise), so giver/receiver per listing is unambiguous. But the
overall structure differs sharply by mode — do **not** assume clean cycles:

- **ONETOONE (ftm):** output is genuine simple cycles, blank-line delimited →
  one `cycle_id` per block; `steps` is an ordered ring.
- **XTOY (gurobi):** N-for-M trades give/receive different counts, so the
  user-move graph is a **tangled, heavily-intersecting flow** with no per-user
  conservation — it does **not** decompose into rings. Group by **weakly-
  connected component** (union-find over users joined by each move);
  `cycle_id` = component index, `steps` = that component's moves, **unordered**.
  Grouping is cosmetic — a single flat move list would also be valid.

Then, shared:
- Resolve each `listing_code` → `EventListing` (event-scoped). For ftm,
  cross-check parsed usernames against `listing.copy.owner`; for gurobi,
  ownership comes from the lookup (no usernames in the file). Reject unknown
  codes / owner mismatch with a clear error.
- Map each edge to the receiver's satisfied `TradeWish` (best-effort, nullable
  `TradeAssignment.wish`) by finding the receiver's active wish whose expanded
  wants include that listing.
- Emit the **same** `result`/`summary` JSON shape `FakeMatcher` produces
  (`{algorithm, generated_at, cycles:[{id,length,steps:[{listing_code,
  board_game,from_user,to_user,wish_id}]}], unmatched, stats}`) and
  `bulk_create` `TradeAssignment` rows. The `cycles` key is kept for FE
  compatibility; for XTOY an entry is a **trade group (component)**, and its
  `length`/order carry no ring meaning. Reuse/extract `FakeMatcher`'s
  `_make_cycle` / `_create_assignments` helpers so the schema stays identical.

Net: parsers + this builder are the only new matcher code; everything
downstream (serializers, result view, `/mine/`, FE result page) is untouched.

---

## 6. Blocks & edge cases

- **UserBlock:** neither solver format carries usernames+blocks natively. Only
  lever is export-time filtering: when expanding a wisher's wants, drop listings
  owned by anyone they block (and anyone who blocks them). `ONETOONE` per-item
  wishlists and `XTOY` take-lists both apply it. Document that block enforcement
  is approximate (a third party can still route a blocked pair into one cycle);
  acceptable for v1, note in `DESIGN.md`.
- **Self-trades:** never list your own listings in your own wants (already
  excluded in expansion).
- **Inactive listings / withdrawn copies between export and upload:** validate on
  upload; if a code no longer maps to an active listing → reject with the line.
- **Unknown / malformed line on upload:** 400 with line number + content; persist
  nothing.
- **modal errors:** `422` malformed (surface `detail.log` tail), `504` timeout,
  cold-start latency (first call ~seconds) — task timeout 250s.
- **Empty event (no wishes):** export yields header only / no lines; run returns
  zero cycles, all unmatched.

---

## 7. Endpoints summary (additions)

| method | path | notes |
|---|---|---|
| GET | `/api/events/{slug}/wants-export/` | organizer-only; `text/plain` wants.txt, format per `matching_mode` |
| POST | `/api/events/{slug}/matches/` | `ONETOONE`: create run + call modal (existing path, mode-gated). `XTOY` → 400 |
| POST | `/api/events/{slug}/matches/upload/` | organizer-only, `status==MATCHING`; body = raw solver stdout → parse → run |

`matching_mode` added to the `TradeEvent` serializer (organizer-writable until
`MATCHING`). Update `docs/API_CONTRACT.md` + `docs/DATA_MODEL.md`.

---

## 8. Frontend (implemented)

- **Organizer event settings** (`features/events/EventDetailPage.tsx`):
  `MatchingModeCard` — a `matching_mode` select (1-to-1 / X-to-Y), disabled once
  `MATCHING`+ (`MATCHING_MODE_FROZEN_STATUSES`), PATCH via `usePatchEvent`.
- **Matching page** (`features/matching/MatchRunPage.tsx` + `api/matching.ts`):
  - `ONETOONE`: existing "Run matching" button → `POST /matches/`.
  - `XTOY`: `XToYSolvePanel` — "Download wants.txt" (`fetchWantsExport` → Blob
    download) + paste/file upload → `useUploadSolution` → `POST /matches/upload/`.
  - Result rendering, `/mine/`, cycle view: unchanged.
- `api/events.ts`: `MatchingMode` type, `MATCHING_MODE_LABELS`,
  `MATCHING_MODE_FROZEN_STATUSES`, `matching_mode` on `TradeEvent` + patch payload.
- Want List Builder drag-to-rank stripped to plain add/remove (binary wants);
  `@dnd-kit` no longer imported in `src`.

---

## 9. Testing plan

Backend (`matching/tests.py`, `events/tests.py`):
- Export `ONETOONE`: correct OLWLG lines, `BOARD_GAME` expansion to others'
  codes, blocked owner excluded, own listing excluded, empty-wants line.
- Export `XTOY`: `(NforM)` header from max_give/min_receive, give/take codes,
  block filtering.
- Parser `ftm`: fixture stdout (e.g. `testcases/1for1.txt` solved) → expected
  edges/cycles; multi-loop blank-line grouping.
- Parser `gurobi`: fixture from `main.py` output (`1for1`, `2for11for2`,
  `freegame`) → edges; component grouping (`freegame` is a tangled flow, not a
  ring — assert it stays one group, not forced into cycles); `NforM` line.
- Upload happy path → `MatchRun` DONE + correct `TradeAssignment` rows +
  result-schema parity with `FakeMatcher` output.
- Upload errors: unknown code, owner mismatch, malformed line → 400, nothing
  persisted. Non-organizer → 403. Wrong status → 400.
- `ONETOONE` modal call: mock the HTTP (`responses`/monkeypatch) — success,
  `422`, timeout → run FAILED.
- `POST /matches/` on `XTOY` → 400.

Round-trip smoke (manual / scripted, not CI): seed event → export → pipe through
the real `ftm`/`main.py` → upload → assert cycles match.

---

## 9b. Money + duplicate-protection (placeholder)

Money trading and per-want duplicate-protection are stored but **not yet solved**
(neither the C++ `ftm` nor the current gurobi model consume them). The MIP
formulation that handles them lands later. Until then `build_wants` prepends
**comment lines** (`#! …`) that both parsers ignore, so the export round-trips
unchanged while carrying the data forward:

```
#! MONEY-ENABLED max_per_user=50.00
#! BUDGET (trader01) 25.00
#! DUP-PROTECT (trader01) wish=42
#! MONEY-WANT (trader01) game=174430 max=30.00
```

Sources: `TradeEvent.money_enabled` / `max_money_per_user`,
`EventParticipation.max_spend`, `WantGroup.duplicate_protection`,
`WantGroupItem.money_amount` (see DATA_MODEL.md). `parse_ftm` reads only after
`TRADE LOOPS` and `parse_gurobi` only after `Trade Results`, so these `#!` lines
are inert — covered by `PlaceholderHeaderTests`.

---

## 10. Open questions / risks

- New backend dependency (`requests` or `httpx`) for the outbound modal call —
  acceptable? (pure-python, no native build.)
- Block enforcement is approximate (§6) — confirm acceptable for v1.
- Removing `tier`/`rank` (§1b) deprecates the @dnd-kit Want List Builder's
  drag-to-rank — strip it to plain add/remove, or retire the page? (decision)
- Should `ONETOONE` also support manual upload (offline ftm), or strictly the
  server call? Plan keeps `/upload/` mode-agnostic so it's cheap to allow both.
