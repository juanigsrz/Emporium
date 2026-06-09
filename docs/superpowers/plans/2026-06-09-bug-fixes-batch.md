# Bug-Fix & Feature Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 reported defects across event listings, want-list locking, want-list builder UX, solver export, geeklist import, and profile geocoding.

**Architecture:** Django REST backend (`backend/`, tests via `venv/bin/python manage.py test`) + Vite/React/TS frontend (`frontend/`, no unit-test runner — verify with `npm run build` + `npm run lint` + manual repro). Each task is independent; do them in any order, commit per task.

**Tech Stack:** Django, DRF, React 18, TanStack Query, react-hook-form, Tailwind, Gurobi solver (`../FastTradeMaximizer/main.py`), BeautifulSoup (BGG scrape).

**Decisions locked (from review):**
- Item 2: lock **wants + listings**, from status **MATCHING** onward.
- Item 5: align XTOY export for **barter + money** (real `user budget` / `item … ask` / `bid` lines).
- Item 9: send picked autocomplete coords to the backend; surface geocode failures instead of swallowing them.

**Test commands:**
- Backend: `cd backend && venv/bin/python manage.py test <app>`
- Frontend: `cd frontend && npm run build && npm run lint`

---

## File Structure

| Item | Files touched |
|---|---|
| 2 | `backend/events/models.py`, `backend/trades/views.py`, `backend/events/views.py`, `frontend/src/features/trades/MyWantsPage.tsx`, `frontend/src/features/trades/WantListBuilderPage.tsx` |
| 5 | `backend/matching/external_solver.py`, `backend/matching/test_external_solver.py` |
| 8 | `backend/bgg/client.py`, `backend/bgg/tests/` |
| 9 | `backend/accounts/serializers.py`, `frontend/src/api/profiles.ts`, `frontend/src/features/profile/ProfilePage.tsx` |
| 1 | `frontend/src/features/events/EventDetailPage.tsx` |
| 4 | `frontend/src/features/trades/MyWantsPage.tsx` |
| 3 | `frontend/src/features/trades/MyWantsPage.tsx` |
| 7 | `frontend/src/features/trades/WantListBuilderPage.tsx` |

---

## Task 1 (Item 2): Lock wants + listings once status reaches MATCHING

**Files:**
- Modify: `backend/events/models.py` (add locked-status set + property)
- Modify: `backend/trades/views.py` (guard OfferGroup/WantGroup/TradeWish writes)
- Modify: `backend/events/views.py:292` (guard listing create), `:listing_detail delete`
- Test: `backend/trades/tests.py`, `backend/events/tests.py`
- Modify (FE, locked banner + disable save): `frontend/src/features/trades/MyWantsPage.tsx`, `frontend/src/features/trades/WantListBuilderPage.tsx`

- [ ] **Step 1: Write failing test — wish write blocked at MATCHING**

Add to `backend/trades/tests.py` (reuse the file's existing event/listing fixtures — match the `setUp`/`setUpTestData` pattern already there):

```python
def test_wantgroup_create_blocked_after_matching(self):
    self.event.status = "MATCHING"
    self.event.save(update_fields=["status"])
    resp = self.client.post(
        f"/api/events/{self.event.slug}/want-groups/",
        {"name": "x", "min_receive": 1,
         "items": [{"target_type": "BOARD_GAME", "board_game": self.game.bgg_id}]},
        format="json",
    )
    self.assertEqual(resp.status_code, 403)

def test_wantgroup_create_allowed_in_wantlist_open(self):
    self.event.status = "WANTLIST_OPEN"
    self.event.save(update_fields=["status"])
    resp = self.client.post(
        f"/api/events/{self.event.slug}/want-groups/",
        {"name": "x", "min_receive": 1,
         "items": [{"target_type": "BOARD_GAME", "board_game": self.game.bgg_id}]},
        format="json",
    )
    self.assertEqual(resp.status_code, 201)
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && venv/bin/python manage.py test trades.tests -v 2`
Expected: `test_wantgroup_create_blocked_after_matching` FAILS (returns 201, not 403).

- [ ] **Step 3: Add locked-status helper to the model**

In `backend/events/models.py`, after `ALLOWED_TRANSITIONS` (line ~44) add:

```python
# Statuses at/after which wants + listings are frozen (matching has begun;
# changing inputs would let users alter computed results).
WANTLIST_LOCKED_STATUSES = {
    "MATCHING", "MATCH_REVIEW", "FINALIZATION", "SHIPPING", "ARCHIVED",
}
```

On `TradeEvent` (after `allowed_transitions_list`, line ~150) add:

```python
@property
def inputs_locked(self) -> bool:
    """True once matching has begun — wants and listings are read-only."""
    return self.status in WANTLIST_LOCKED_STATUSES
```

- [ ] **Step 4: Guard the trade write endpoints**

In `backend/trades/views.py`, add to `EventScopedMixin` (after `_get_event`, line ~62):

```python
def _assert_editable(self, event):
    from rest_framework.exceptions import PermissionDenied
    if event.inputs_locked:
        raise PermissionDenied(
            "Want lists are locked — this event has moved to matching."
        )
```

Call `self._assert_editable(event)` at the top of every mutating handler, right after `event = self._get_event(slug)`:
- `OfferGroupListCreateView.post` (line ~100)
- `OfferGroupDetailView.patch` (~144), `.delete` (~158)
- `WantGroupListCreateView.post` (~187)
- `WantGroupDetailView.patch` (~259), `.delete` (~276)
- `TradeWishListCreateView.post` (~302)
- `TradeWishDetailView.patch` (~345), `.delete` (~359)

(GET handlers stay open.)

- [ ] **Step 5: Guard listing create/delete**

In `backend/events/views.py`, in `_listings_create` (line ~292) after the event is resolved, and in the `DELETE` listing handler, add the same lock check:

```python
if event.inputs_locked:
    raise PermissionDenied("Listings are locked — this event has moved to matching.")
```

(`PermissionDenied` is already imported in this module — confirm; if not, import from `rest_framework.exceptions`.)

- [ ] **Step 6: Run backend tests, verify pass**

Run: `cd backend && venv/bin/python manage.py test trades events matching -v 1`
Expected: PASS (the locking tests pass; no regressions in existing suites).

- [ ] **Step 7: Frontend — disable editing + show locked banner**

In `frontend/src/features/trades/MyWantsPage.tsx`, derive `const locked = event.status === 'MATCHING' || event.status === 'MATCH_REVIEW' || event.status === 'FINALIZATION' || event.status === 'SHIPPING' || event.status === 'ARCHIVED'` (or add a shared `INPUTS_LOCKED_STATUSES` set to `frontend/src/features/events/eventUtils.ts` and import it). When `locked`:
- Render a banner above the view tabs: `This event is locked for matching — want lists can no longer be edited.`
- Hide the sticky save bar (`editor.dirtyCount > 0` block, line ~1547) and disable toggles. Simplest: early-guard `handleSave` and pass `disabled={locked}` down; minimum viable is hiding the save bar + banner so saves can't be issued (backend already rejects them).

Do the same banner in `WantListBuilderPage.tsx` (disable the create/save buttons when locked).

- [ ] **Step 8: Verify frontend build + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual: open an event in MATCHING → confirm banner shows, save bar gone; API PATCH returns 403 if forced.

- [ ] **Step 9: Commit**

```bash
git add backend/events/models.py backend/trades/views.py backend/events/views.py backend/trades/tests.py frontend/src/features/trades/MyWantsPage.tsx frontend/src/features/trades/WantListBuilderPage.tsx frontend/src/features/events/eventUtils.ts
git commit -m "feat: lock wants + listings once event enters matching"
```

---

## Task 2 (Item 5): Align XTOY export with main.py (barter + money)

**Files:**
- Modify: `backend/matching/external_solver.py` (`_build_xtoy`, `_build_placeholder_header`, money lines, cash-result parsing)
- Test: `backend/matching/test_external_solver.py`

Reference target format (`../FastTradeMaximizer/main.py`):
- wish: `<username> : (NforM) <give codes> -> <take codes>`
- money: `user <username> budget <int>`, `item <code> owner <username> [ask <int>]`, `bid <username> <code> <int>`
- `#`-prefixed lines are stripped by the solver (safe for dup-protect notes).
- **All money amounts must be integers** (solver regexes use `\d+`). Export every amount as **integer cents** (`round(Decimal * 100)`) so `bid ≥ ask` and `budget` comparisons stay consistent.

- [ ] **Step 1: Update failing tests to the new format**

In `backend/matching/test_external_solver.py`, change `ExportXToYTests.test_nforM_lines` (line ~116) to expect the username prefix:

```python
def test_nforM_lines(self):
    text = external_solver.build_wants(self.event)
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    self.assertEqual(len(lines), 2)  # one per wish
    for line in lines:
        self.assertRegex(line, r"^\S+ : \(1for1\) ")
        self.assertIn(" -> ", line)
```

Add a money-export test (new class or extend `ExportXToYTests`); set `event.money_enabled = True`, give one offer item a `money_amount` and one want item a `money_amount`, then:

```python
def test_money_lines_are_real_solver_directives(self):
    self.event.money_enabled = True
    self.event.save(update_fields=["money_enabled"])
    # ... attach money_amount to an OfferGroupItem (sell) and WantGroupItem (buy) ...
    text = external_solver.build_wants(self.event)
    self.assertRegex(text, r"(?m)^item \S+ owner \S+")
    self.assertRegex(text, r"(?m)^bid \S+ \S+ \d+$")
    # no inert money comments remain
    self.assertNotIn("#! MONEY-WANT", text)
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd backend && venv/bin/python manage.py test matching.test_external_solver -v 2`
Expected: FAIL — current export has no `username :` prefix and emits `#! MONEY-*` comments.

- [ ] **Step 3: Add the username prefix to XTOY wish lines**

In `backend/matching/external_solver.py`, `_build_xtoy` (line ~226), change the emitted line (line ~247) from:

```python
lines.append(f"({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
```
to:
```python
lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
```

- [ ] **Step 4: Emit real money directives for XTOY money events**

Add a helper used only when `event.matching_mode == XTOY and event.money_enabled`, emitting (de-duplicated, ahead of the wish lines):

```python
def _cents(amount):
    return int((amount * 100).to_integral_value())

def _build_xtoy_money(event, listings, wishes, by_game, by_id, block_pairs):
    lines = []
    # budgets (per-participant max_spend; fall back to event cap)
    for p in event.participations.select_related("user").all():
        cap = p.max_spend if p.max_spend and p.max_spend > 0 else event.max_money_per_user
        if cap and cap > 0:
            lines.append(f"user {p.user.username} budget {_cents(cap)}")
    # item ownership + ask (sell-side min) for every active listing
    ask_by_code = {}
    for w in wishes:
        for ogi in w.offer_group.items.all():
            if ogi.money_amount is not None and ogi.event_listing.active:
                ask_by_code[ogi.event_listing.copy.listing_code] = ogi.money_amount
    for el in listings:
        code = el.copy.listing_code
        line = f"item {code} owner {el.copy.owner.username}"
        if code in ask_by_code:
            line += f" ask {_cents(ask_by_code[code])}"
        lines.append(line)
    # bids (buy-side max), expanding BOARD_GAME wants to concrete codes
    coords = _load_coords()
    for w in wishes:
        blocked = _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords)
        for it in w.want_group.items.all():
            if it.money_amount is None:
                continue
            codes = _expand([it], w.user_id, by_game, by_id, blocked)
            for code in codes:
                lines.append(f"bid {w.user.username} {code} {_cents(it.money_amount)}")
    return ("\n".join(lines) + "\n") if lines else ""
```

Wire it in `build_wants` (line ~141): when XTOY, prepend `_build_xtoy_money(...)` output before `_build_xtoy(...)`; drop the `#! MONEY-*` lines from `_build_placeholder_header` for XTOY (keep `#! DUP-PROTECT` comments — inert and informative; main.py strips them). Leave the ONETOONE header path unchanged.

- [ ] **Step 5: Capture cash purchases on upload (parse_gurobi)**

`main.py` prints cash trades under a separate `Cash Purchases:` section, not `Trade Results:`. Extend `parse_gurobi` (line ~322) so cash moves become edges too:

```python
# after the Trade Results loop, scan for cash purchases
# line form: "C-XXXX: seller -> buyer  (buyer pays seller $N)"
for raw in output.splitlines():
    line = raw.strip()
    m = re.match(r"^(\S+):\s+\S+\s+->\s+\S+\s+\(", line)
    if m:
        code = m.group(1)
        # buyer receives `code`; giver/receiver resolved from ownership downstream
        edges.append((code, code, None))  # self-anchored; component grouping handles it
```

(Resolution in `load_solution` derives giver = owner(code); the receiver for a pure cash buy is the buyer — note this needs the buyer username. If ownership-only resolution can't name the buyer, scope cash-result loading as a follow-up and keep Step 5 to export-only. Mark this step optional and verify against a real `main.py` money run before committing.)

- [ ] **Step 6: Run tests, verify pass**

Run: `cd backend && venv/bin/python manage.py test matching -v 1`
Expected: PASS.

- [ ] **Step 7: Round-trip verify against the real solver**

```bash
cd backend && venv/bin/python manage.py shell -c "
from events.models import TradeEvent
from matching.external_solver import build_wants
e = TradeEvent.objects.filter(matching_mode='XTOY').first()
print(build_wants(e))" > /tmp/wants.txt
cd ../../FastTradeMaximizer && python main.py /tmp/wants.txt
```
Expected: solver prints `Trade Results:` with no `Unrecognized line` ValueError. (Seed an XTOY event with a couple of reciprocal wishes first if none exists.)

- [ ] **Step 8: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "fix: XTOY wants export matches main.py (user-prefixed wishes + real money lines)"
```

---

## Task 3 (Item 8): Geeklist import via BGG xmlapi

**Files:**
- Modify: `backend/bgg/client.py` (`fetch_geeklist`)
- Test: `backend/bgg/tests/` (add a focused test mocking `_get`)

Root cause: `/geeklist/{id}` HTML is JS-rendered → no `/boardgame/<id>` anchors → zero rows. The legacy `xmlapi` geeklist endpoint returns server-side XML and is **not** auth-gated.

- [ ] **Step 1: Write failing test**

In `backend/bgg/tests/` add `test_geeklist.py` mocking the client `_get` to return sample xmlapi XML:

```python
from unittest.mock import patch
from django.test import TestCase
from bgg.client import BggClient

SAMPLE = """<geeklist id="379573">
  <item objecttype="thing" subtype="boardgame" objectid="174430" objectname="Gloomhaven"/>
  <item objecttype="thing" subtype="boardgameexpansion" objectid="291457" objectname="Frosthaven"/>
</geeklist>"""

class GeeklistParseTests(TestCase):
    def test_fetch_geeklist_parses_xmlapi_items(self):
        with patch.object(BggClient, "_get", return_value=SAMPLE):
            rows = BggClient().fetch_geeklist("379573")
        ids = {r.bgg_id for r in rows}
        self.assertEqual(ids, {174430, 291457})
        self.assertTrue(any(r.name == "Gloomhaven" for r in rows))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && venv/bin/python manage.py test bgg -v 2`
Expected: FAIL — current `fetch_geeklist` parses HTML anchors, gets nothing from this XML.

- [ ] **Step 3: Switch fetch_geeklist to xmlapi + XML parse**

In `backend/bgg/client.py`, replace `fetch_geeklist` (line ~44):

```python
def fetch_geeklist(self, geeklist_id: str) -> list[CollectionRow]:
    url = f"{self.base_url}/xmlapi/geeklist/{geeklist_id}"
    xml = self._get(url)
    return self._parse_geeklist_xml(xml)

def _parse_geeklist_xml(self, xml: str) -> list[CollectionRow]:
    soup = BeautifulSoup(xml, "xml")
    out, seen = [], set()
    for item in soup.find_all("item"):
        if item.get("objecttype") != "thing":
            continue
        try:
            bgg_id = int(item.get("objectid"))
        except (TypeError, ValueError):
            continue
        if bgg_id in seen:
            continue
        seen.add(bgg_id)
        out.append(CollectionRow(bgg_id=bgg_id, name=item.get("objectname") or ""))
    return out
```

(`BeautifulSoup(xml, "xml")` needs `lxml`. If `lxml` isn't installed, use `"html.parser"` — it still finds `<item …>` tags case-insensitively — or `xml.etree.ElementTree`. Confirm the installed parser in `_parse_rows` usage; the codebase already uses `"html.parser"`, so prefer that to avoid a new dep.)

- [ ] **Step 4: Run test, verify pass**

Run: `cd backend && venv/bin/python manage.py test bgg -v 2`
Expected: PASS.

- [ ] **Step 5: Live verify the real geeklist**

```bash
cd backend && venv/bin/python manage.py shell -c "
from bgg.client import BggClient
rows = BggClient().fetch_geeklist('379573')
print(len(rows), [(r.bgg_id, r.name) for r in rows[:5]])"
```
Expected: non-zero rows for `mathtrade-test`. If `xmlapi` is rate-limited/blocked, confirm `BGG_BASE_URL` host and `User-Agent`. The importer still filters to catalog ids (`boardgames_ranks.csv`), so a row absent from the catalog is correctly skipped as "not in catalog" — verify the test game's `bgg_id` is in `catalog.BoardGame`.

- [ ] **Step 6: Commit**

```bash
git add backend/bgg/client.py backend/bgg/tests/test_geeklist.py
git commit -m "fix: import geeklists via BGG xmlapi (JS-rendered HTML had no items)"
```

---

## Task 4 (Item 9): Geocode — send picked coords, surface failures

**Files:**
- Modify: `backend/accounts/serializers.py` (`ProfileSerializer.update`)
- Modify: `frontend/src/api/profiles.ts` (payload type)
- Modify: `frontend/src/features/profile/ProfilePage.tsx` (carry suggestion coords; show error)
- Test: `backend/accounts/test_profile_geocode.py` (extend)

- [ ] **Step 1: Write failing backend tests**

In `backend/accounts/test_profile_geocode.py`:

```python
def test_explicit_coords_skip_geocode(self):
    with patch("accounts.serializers.geocode") as g:
        resp = self.client.patch("/api/profile/", {
            "location": "Rosario, Santa Fe, Argentina",
            "latitude": -32.95, "longitude": -60.64,
        }, format="json")
    self.assertEqual(resp.status_code, 200)
    g.assert_not_called()
    self.profile.refresh_from_db()
    self.assertAlmostEqual(self.profile.latitude, -32.95)

def test_unresolvable_location_surfaces_error(self):
    with patch("accounts.serializers.geocode", return_value=None):
        resp = self.client.patch("/api/profile/", {"location": "zzzz nowhere"}, format="json")
    self.assertEqual(resp.status_code, 400)
    self.assertIn("location", resp.data)
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && venv/bin/python manage.py test accounts.test_profile_geocode -v 2`
Expected: FAIL — `latitude`/`longitude` are read-only; failures are swallowed (returns 200, coords None).

- [ ] **Step 3: Make coords writable + surface geocode failure**

In `backend/accounts/serializers.py`, remove `latitude`/`longitude` from `read_only_fields` (line ~67) and rewrite `update` (line ~69):

```python
def update(self, instance, validated_data):
    lat = validated_data.pop("latitude", None)
    lng = validated_data.pop("longitude", None)
    new_location = validated_data.get("location", instance.location)
    location_changed = "location" in validated_data and new_location != instance.location
    instance = super().update(instance, validated_data)

    if lat is not None and lng is not None:
        instance.latitude, instance.longitude = lat, lng
        instance.save(update_fields=["latitude", "longitude", "updated"])
    elif location_changed:
        if new_location.strip():
            try:
                coords = geocode(new_location)
            except Exception:  # noqa: BLE001
                coords = None
            if coords is None:
                raise serializers.ValidationError(
                    {"location": "Couldn't resolve this location to coordinates. "
                                 "Pick a suggestion from the dropdown or refine the text."}
                )
            instance.latitude, instance.longitude = coords
        else:
            instance.latitude = instance.longitude = None
        instance.save(update_fields=["latitude", "longitude", "updated"])
    return instance
```

(Latitude/longitude accept floats; DRF maps the model `FloatField` automatically once they leave `read_only_fields`. They remain optional in the payload.)

- [ ] **Step 4: Run backend tests, verify pass**

Run: `cd backend && venv/bin/python manage.py test accounts -v 1`
Expected: PASS.

- [ ] **Step 5: Frontend — carry the selected suggestion's coords**

In `frontend/src/api/profiles.ts`, add to the update payload type: `latitude?: number | null; longitude?: number | null`.

In `frontend/src/features/profile/ProfilePage.tsx`:
- Add `const pickedCoords = useRef<{ lat: number; lon: number } | null>(null)`.
- On suggestion select (`onMouseDown`, line ~249), set `pickedCoords.current = { lat: s.lat, lon: s.lon }` alongside the existing `setValue('location', s.display_name, …)`.
- In the location search `useEffect` (the typing handler, line ~138) — when the user types (i.e., not the skip path), clear: `pickedCoords.current = null` (stale coords must not be sent for edited text).
- In `onSubmit` (line ~179), include coords when present:
  ```ts
  ...(pickedCoords.current
    ? { latitude: pickedCoords.current.lat, longitude: pickedCoords.current.lon }
    : {}),
  ```
- Surface the backend `location` error: read `mutation.error` and render its `response.data.location` message near the field (the generic "Failed to save profile" box already exists at line ~206 — add a specific case).

- [ ] **Step 6: Verify frontend + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual: type "Rosario, Santa Fe, Argentina", pick a suggestion, save → "Geocoded: …" shows coords. Type gibberish, save → inline error appears, no silent blank.

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/serializers.py backend/accounts/test_profile_geocode.py frontend/src/api/profiles.ts frontend/src/features/profile/ProfilePage.tsx
git commit -m "fix: persist picked location coords and surface geocode failures"
```

---

## Task 5 (Item 1): My Listings — filter by current user server-side

**Files:**
- Modify: `frontend/src/features/events/EventDetailPage.tsx:704`

Root cause: `useEventListings(event.slug)` fetches page 1 of ALL listings (page_size 24) then filters client-side; a user's listings past page 1 vanish. The `?user=` filter already works server-side (`events/views.py:269`).

- [ ] **Step 1: Pass the user filter (and a generous page size)**

In `MyListingsSection` (line ~704):

```ts
const { data: listingsData, isLoading } = useEventListings(event.slug, {
  user: username,
  page_size: 100,
})
```

Add `page_size?: number` to `EventListingsParams` in `frontend/src/api/events.ts` and forward it in `fetchEventListings` (mirror the `EventGamesParams` `page_size` handling at line ~291). The existing client-side `.filter(l => l.copy_owner_username === username)` (line ~708) becomes redundant — keep it as a harmless safety net or remove it; if removed, also drop the now-unused `username`-filter line only (leave `myListingCopyIds`).

- [ ] **Step 2: Verify frontend + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual: in an event where you own >24 total-listing-rank copies, open detail → "My Listings in This Event" shows all your copies.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/events/EventDetailPage.tsx frontend/src/api/events.ts
git commit -m "fix: My Listings filters by owner server-side instead of page-1 client filter"
```

---

## Task 6 (Item 4): Almanac highlight reflects specific-copy wants

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx:454`

Root cause: `isWanted(bggId)` checks only the `G:` (any-copy) key; wishing via specific copy checkboxes sets `L:` keys, so the card ring + bottom button don't reflect it. `wantedForControls` (line ~577) already does it correctly via `groupIsOn`.

- [ ] **Step 1: Make isWanted account for all targets of the game**

Replace `isWanted` (line ~454):

```ts
const isWanted = useCallback(
  (bggId: number) => {
    const group = groupByGame.get(bggId)
    return group ? myListings.some((l) => groupIsOn(editor, l.id, group)) : false
  },
  [editor, myListings, groupByGame]
)
```

- [ ] **Step 2: Reconcile the bottom "Want any copy" button**

`toggleWant` (line ~462) toggles only the `G:` key. With `isWanted` now true when only specific copies are selected, the button would read "Any copy ✓" yet clicking adds the any-copy target. Make the button mirror the grid's group semantics — when the game is wanted in any form, clear it; otherwise want any copy:

```ts
function toggleWant(g: { bgg_id: number; name: string }) {
  const group = groupByGame.get(g.bgg_id)
  if (group && myListings.some((l) => groupIsOn(editor, l.id, group))) {
    myListings.forEach((l) => groupKeys(group).forEach((k) => editor.toggle(l.id, k, false)))
    return
  }
  const key = gameTargetKey(g.bgg_id)
  editor.addTarget({ key, type: 'BOARD_GAME', boardGameId: g.bgg_id, label: g.name, gameId: g.bgg_id, gameName: g.name })
  myListings.forEach((l) => editor.toggle(l.id, key, true))
}
```

- [ ] **Step 3: Verify frontend + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual: in almanac, expand a game, check a specific copy (don't press "+ Want any copy") → card gets the purple ring and the bottom button reflects the selection.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "fix: almanac highlights games wished via specific-copy checkboxes"
```

---

## Task 7 (Item 3): Grid view — show which copies are in the wish

**Files:**
- Modify: `frontend/src/features/trades/MyWantsPage.tsx:1296`

Root cause: `GridMode` renders `<GameCopies>` without `editor`/`myListings`/`selectable`, so `canSelect` is false → no checkboxes or selected-copy highlight.

- [ ] **Step 1: Pass editor + myListings + selectable**

At line ~1296:

```tsx
<GameCopies
  slug={slug}
  bggId={g.gameId}
  username={username}
  editor={editor}
  myListings={myListings}
  selectable
/>
```

`GameCopies` already highlights wished copies (`isCopyWanted`, line ~722) and toggles `L:` targets when `canSelect`. No other change needed.

- [ ] **Step 2: Verify frontend + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual: grid view → expand a wanted game's row → the specific copies already in the wish show as checked/highlighted, and can be toggled.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/trades/MyWantsPage.tsx
git commit -m "fix: grid view marks which copies are in the wish (selectable GameCopies)"
```

---

## Task 8 (Item 7): Want Group builder — event-scoped search + copy checkboxes + dup-protect

**Files:**
- Modify: `frontend/src/features/trades/WantListBuilderPage.tsx` (`WantGroupEditor`, line ~638; `WantGroupsPanel`/create payload)

Root causes: game search uses global `useGamesList` (any catalog game, line ~660); "add specific listing" maps `myListings` = the user's OWN copies (line ~887–913); create form has no duplicate-protection toggle.

- [ ] **Step 1: Restrict search to games in this event**

Replace the search hook (line ~660) `useGamesList` with the event-scoped `useEventGames` (already used in `MyWantsPage`):

```ts
import { useEventGames } from '../../api/events'
// ...
const { data: gameResults } = useEventGames(slug, { search: gameSearch, page_size: 8 })
```

`useEventGames` returns `{ results: [{ bgg_id, name, year_published, ... }] }` — the same shape the results list renders (line ~857), so the dropdown markup is unchanged. Update the `addBoardGame(game)` arg type accordingly.

- [ ] **Step 2: Replace "add specific listing" with other-traders' copy checkboxes**

Remove the `myListings`-based "Or add a specific listing from this event" block (lines ~886–914). In its place, when a searched game is chosen, fetch that game's listings via `useEventListings(slug, { board_game: bggId })`, filter out the current user's own copies (`copy_owner_username !== username`), and render each as a checkbox row plus an "Any copy" checkbox. Stage selections locally and add them on a button press:

- Selecting "Any copy" → stages a `BOARD_GAME` draft item (`addBoardGame`).
- Checking specific copies → stages `LISTING` draft items (reuse `addListing(listing)` with the **other trader's** `EventListing`, not `myListings`).
- An "Add to want group" button commits staged checks into `items` (the existing `items`/`removeItem` model already renders them — line ~802).

Pass `username` into `WantGroupEditor` (thread from `WantGroupsPanel`, which has it via the page). Keep `myListings` out of the want-target picker entirely.

- [ ] **Step 3: Add duplicate-protection toggle to the create form**

`duplicate_protection` is already a writable serializer field and present on the create/patch payload types (`frontend/src/api/trades.ts:75,82`). In `WantGroupEditor` add `const [dupProtect, setDupProtect] = useState(group?.duplicate_protection ?? false)`, render a checkbox near the name/min-receive grid (line ~761), and include `duplicate_protection: dupProtect` in both the create `onClose({...})` payload (line ~743) and the patch payload (line ~748).

- [ ] **Step 4: Verify frontend + manual**

Run: `cd frontend && npm run build && npm run lint`
Manual:
- Create a Want Group → search only returns games present in this event.
- Choosing a game lists **other traders'** copies (not your own) with checkboxes + "Any copy"; nothing is added until you press "Add to want group".
- The create form has a "Protect against duplicates" checkbox that persists.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/trades/WantListBuilderPage.tsx
git commit -m "feat: event-scoped want-group search, copy-checkbox picker, dup-protect on create"
```

---

## Self-Review

**Spec coverage:** Items 1,2,3,4,5,7,8,9 each map to Tasks 5,1,7,6,2,8,3,4 respectively. Item 6 was not in the source list (skipped numbering). All 8 reported items covered.

**Known follow-ups / risks (flagged, not silently dropped):**
- Task 2 Step 5 (cash-purchase parsing on upload) is the one uncertain piece — `main.py`'s `Cash Purchases:` lines name buyer+seller in prose; resolving the *buyer* may need parsing the username from the line, not just ownership lookup. Verify against a real money solve before committing; if blocked, ship export-only and open a follow-up for cash-result loading.
- Money amounts export as integer **cents** (Task 2). If the solver or any downstream report assumes whole currency units, reconcile the scale.
- Item 2 frontend gating is defense-in-depth; backend 403 is the real guarantee. A shared `INPUTS_LOCKED_STATUSES` constant avoids drift between the two pages.
- BGG xmlapi (Task 3) is rate-limited; the existing `BGG_REQUEST_DELAY` applies via `_get`. Catalog filtering still gates which geeklist rows become copies.

**Type consistency:** `inputs_locked` (model) / `_assert_editable` (mixin) used consistently; `useEventGames`/`useEventListings` shapes reused as they exist today; `duplicate_protection` writable field confirmed in `trades/serializers.py:340` and `api/trades.ts`.
