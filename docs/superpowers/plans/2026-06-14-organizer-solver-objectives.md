# Organizer-selectable solver objectives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organizer pick which solver objectives to optimize and in what priority order, and emit each user's location into the exported `wants.txt` when `distance` is among the chosen objectives.

**Architecture:** Stateless. The frontend `XToYSolvePanel` holds an ordered, checkable list of the three objectives and passes the selection as a `?kpi=` query param to the existing wants-export endpoint. The endpoint validates the param and, when `distance` is selected, tells `build_wants` to append `location <username> <lat> <lng>` lines for trading users that have Profile coordinates. The selected `--kpi` string is shown as plain text for the organizer to pass when they run the solver manually. No DB model, no migration, FakeMatcher untouched.

**Tech Stack:** Django REST Framework (backend), React + TypeScript + Vite (frontend). Backend tests: `pytest`/Django `APITestCase`. Frontend verification: `tsc` build + ESLint (no unit-test framework in this project).

---

## File Structure

- `backend/matching/external_solver.py` — add `include_locations` param to `build_wants`; add `_location_lines` helper.
- `backend/events/views.py` — parse + validate `?kpi=` in `wants_export`; pass `include_locations` to `build_wants`.
- `backend/matching/test_external_solver.py` — tests for location emission and the endpoint kpi param.
- `frontend/src/api/matching.ts` — `fetchWantsExport` gains an optional `kpi: string[]` arg.
- `frontend/src/features/matching/MatchRunPage.tsx` — objectives picker UI inside `XToYSolvePanel`.

---

## Task 1: `build_wants` emits location lines

**Files:**
- Modify: `backend/matching/external_solver.py` (`build_wants`, ~line 135; add `_location_lines` helper near `_load_coords`, ~line 83)
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing tests**

Add this test class to `backend/matching/test_external_solver.py` (after the `ExportXToYTests` class):

```python
# ---------------------------------------------------------------------------
# Location export (distance objective)
# ---------------------------------------------------------------------------

class LocationExportTests(MatchingTestBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    @classmethod
    def _set_coords(cls, user, lat, lng):
        from accounts.models import Profile
        Profile.objects.filter(user=user).update(latitude=lat, longitude=lng)

    def test_no_location_lines_by_default(self):
        text = external_solver.build_wants(self.event)
        self.assertNotIn("location ", text)

    def test_locations_included_for_users_with_coords(self):
        self._set_coords(self.user_a, 40.7128, -74.006)
        self._set_coords(self.user_b, 34.0522, -118.2437)
        text = external_solver.build_wants(self.event, include_locations=True)
        self.assertIn(f"location {self.user_a.username} 40.7128 -74.006", text)
        self.assertIn(f"location {self.user_b.username} 34.0522 -118.2437", text)

    def test_user_without_coords_skipped(self):
        self._set_coords(self.user_a, 40.7128, -74.006)
        # user_b has no coords (Profile lat/lng null) -> no line
        text = external_solver.build_wants(self.event, include_locations=True)
        self.assertIn(f"location {self.user_a.username} ", text)
        self.assertNotIn(f"location {self.user_b.username} ", text)

    def test_location_lines_do_not_break_gurobi_parser(self):
        self._set_coords(self.user_a, 40.7128, -74.006)
        text = external_solver.build_wants(self.event, include_locations=True)
        # location lines have no '->', so the swap parser ignores them
        self.assertEqual(external_solver.parse_gurobi(text), [])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest matching/test_external_solver.py::LocationExportTests -v`
Expected: FAIL — `test_locations_included_for_users_with_coords` and others fail with `TypeError: build_wants() got an unexpected keyword argument 'include_locations'`.

- [ ] **Step 3: Add the `_location_lines` helper**

In `backend/matching/external_solver.py`, add this function right after `_load_coords` (the function ending ~line 89):

```python
def _location_lines(listings, wishes) -> str:
    """`location <username> <lat> <lng>` for every user who owns an active
    listing or has an active wish AND has Profile coordinates. Sorted, '' if none.

    Covers both ends of every possible move (owner + receiver) so the solver's
    distance objective can price each shipment. Users without coordinates are
    skipped; the solver tolerates moves with a missing location on either end.
    """
    coords = _load_coords()  # user_id -> (lat, lng, max_km)
    names = {}               # user_id -> username
    for el in listings:
        names[el.copy.owner_id] = el.copy.owner.username
    for w in wishes:
        names[w.user_id] = w.user.username

    lines = []
    for uid, username in names.items():
        c = coords.get(uid)
        if not c:
            continue
        lat, lng, _max = c
        if lat is None or lng is None:
            continue
        lines.append(f"location {username} {lat} {lng}")
    return ("\n".join(sorted(lines)) + "\n") if lines else ""
```

- [ ] **Step 4: Wire it into `build_wants`**

In `backend/matching/external_solver.py`, replace the `build_wants` function (currently lines ~135-145):

```python
def build_wants(event) -> str:
    listings, by_code, by_game, by_id = _listing_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(event, listings, wishes, by_game, by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_game, by_id, by_code, block_pairs)
    return money_block + body
```

with:

```python
def build_wants(event, include_locations: bool = False) -> str:
    listings, by_code, by_game, by_id = _listing_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(event, listings, wishes, by_game, by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_game, by_id, by_code, block_pairs)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + location_block
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && python -m pytest matching/test_external_solver.py::LocationExportTests -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Run the full external_solver test module (no regressions)**

Run: `cd backend && python -m pytest matching/test_external_solver.py -q`
Expected: PASS (all existing tests still green).

- [ ] **Step 7: Commit**

```bash
git add backend/matching/external_solver.py backend/matching/test_external_solver.py
git commit -m "feat(matching): emit user location lines in wants export when requested

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `wants_export` endpoint accepts a `kpi` param

**Files:**
- Modify: `backend/events/views.py` (`wants_export`, ~lines 554-568; add a `_parse_kpi` helper on the same viewset)
- Test: `backend/matching/test_external_solver.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/matching/test_external_solver.py`, inside the existing `ExportXToYTests` class (it already authenticates as the organizer via `MatchingTestBase`; `user_a` is the organizer):

```python
    def test_export_kpi_distance_includes_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,distance"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn(f"location {self.user_a.username} 40.7128 -74.006",
                      resp.content.decode())

    def test_export_kpi_without_distance_has_no_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,users"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn("location ", resp.content.decode())

    def test_export_default_kpi_has_no_locations(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user_a).update(latitude=40.7128, longitude=-74.006)
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug))  # no kpi param
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn("location ", resp.content.decode())

    def test_export_invalid_kpi_400(self):
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,foo"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_export_duplicate_kpi_400(self):
        self.client.force_authenticate(user=self.user_a)
        resp = self.client.get(export_url(self.slug), {"kpi": "trades,trades"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest "matching/test_external_solver.py::ExportXToYTests" -v -k "kpi"`
Expected: FAIL — `test_export_kpi_distance_includes_locations` fails (no `location` line; endpoint ignores the param), and the `400` tests fail (endpoint returns 200).

- [ ] **Step 3: Add the `_parse_kpi` helper**

In `backend/events/views.py`, add this method to the same viewset class that defines `wants_export` (place it directly above the `wants_export` method, ~line 554). `ValidationError` is already imported (line 31):

```python
    ALLOWED_KPIS = ("trades", "users", "distance")

    def _parse_kpi(self, raw):
        """Comma-separated objectives in priority order. Validates tokens,
        rejects duplicates, defaults to ['trades']."""
        if not raw:
            return ["trades"]
        out = []
        for tok in raw.split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok not in self.ALLOWED_KPIS:
                raise ValidationError({"kpi": f"invalid objective '{tok}'"})
            if tok in out:
                raise ValidationError({"kpi": f"duplicate objective '{tok}'"})
            out.append(tok)
        return out or ["trades"]
```

- [ ] **Step 4: Use it in `wants_export`**

In `backend/events/views.py`, replace the body of `wants_export` (currently lines ~559-568):

```python
        from django.http import HttpResponse
        from matching.external_solver import build_wants

        event = self.get_object()
        self._check_organizer(event)

        text = build_wants(event)
        resp = HttpResponse(text, content_type="text/plain; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{event.slug}-wants.txt"'
        return resp
```

with:

```python
        from django.http import HttpResponse
        from matching.external_solver import build_wants

        event = self.get_object()
        self._check_organizer(event)

        kpi = self._parse_kpi(request.query_params.get("kpi"))
        text = build_wants(event, include_locations=("distance" in kpi))
        resp = HttpResponse(text, content_type="text/plain; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{event.slug}-wants.txt"'
        return resp
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && python -m pytest "matching/test_external_solver.py::ExportXToYTests" -v`
Expected: PASS (existing export tests + the 5 new kpi tests).

- [ ] **Step 6: Commit**

```bash
git add backend/events/views.py backend/matching/test_external_solver.py
git commit -m "feat(events): accept kpi param on wants-export, include locations for distance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend `fetchWantsExport` passes the kpi param

**Files:**
- Modify: `frontend/src/api/matching.ts` (`fetchWantsExport`, ~line 137)

- [ ] **Step 1: Update `fetchWantsExport`**

In `frontend/src/api/matching.ts`, replace the existing `fetchWantsExport`:

```ts
/** GET the gurobi solver wants file (text) for the event. Organizer-only. */
export async function fetchWantsExport(slug: string): Promise<string> {
  const { data } = await apiClient.get<string>(`/events/${slug}/wants-export/`, {
    responseType: 'text',
  })
  return data
}
```

with:

```ts
/** GET the gurobi solver wants file (text) for the event. Organizer-only.
 *  `kpi` is the selected objectives in priority order; when it contains
 *  'distance' the backend appends user location lines. */
export async function fetchWantsExport(slug: string, kpi: string[] = []): Promise<string> {
  const { data } = await apiClient.get<string>(`/events/${slug}/wants-export/`, {
    responseType: 'text',
    params: kpi.length ? { kpi: kpi.join(',') } : undefined,
  })
  return data
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: PASS — no type errors (the new arg is optional, so the existing caller still compiles).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/matching.ts
git commit -m "feat(matching-ui): pass kpi objectives to wants-export fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Objectives picker UI in `XToYSolvePanel`

**Files:**
- Modify: `frontend/src/features/matching/MatchRunPage.tsx` (`XToYSolvePanel`, ~lines 148-250)

- [ ] **Step 1: Add the objectives type + default above `XToYSolvePanel`**

In `frontend/src/features/matching/MatchRunPage.tsx`, directly above the `XToYSolvePanel` function (~line 146, after the section comment), add:

```tsx
type ObjectiveKey = 'trades' | 'users' | 'distance'

interface ObjectiveRow {
  key: ObjectiveKey
  label: string
  checked: boolean
}

// Default: only 'trades' on (matches solver default; distance off => no locations
// emitted until opted in). List order = solver priority (topmost optimized first).
const DEFAULT_OBJECTIVES: ObjectiveRow[] = [
  { key: 'trades', label: 'Trades', checked: true },
  { key: 'users', label: 'Users', checked: false },
  { key: 'distance', label: 'Distance', checked: false },
]
```

- [ ] **Step 2: Add picker state + handlers inside `XToYSolvePanel`**

In `frontend/src/features/matching/MatchRunPage.tsx`, find the state declarations at the top of `XToYSolvePanel` (currently):

```tsx
  const upload = useUploadSolution()
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
```

and add immediately below them:

```tsx
  const [objectives, setObjectives] = useState<ObjectiveRow[]>(DEFAULT_OBJECTIVES)
  const kpi = objectives.filter((o) => o.checked).map((o) => o.key)

  function toggleObjective(i: number) {
    setObjectives((os) =>
      os.map((o, idx) => (idx === i ? { ...o, checked: !o.checked } : o)),
    )
  }

  function moveObjective(i: number, dir: -1 | 1) {
    setObjectives((os) => {
      const j = i + dir
      if (j < 0 || j >= os.length) return os
      const next = os.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
```

- [ ] **Step 3: Pass the selected kpi when downloading**

In the same `XToYSolvePanel`, find the line inside `handleDownload`:

```tsx
      const text = await fetchWantsExport(slug)
```

and replace it with:

```tsx
      const text = await fetchWantsExport(slug, kpi)
```

- [ ] **Step 4: Render the picker + disable Download when no objective is selected**

In the same `XToYSolvePanel`, find the Download button block in the returned JSX (currently):

```tsx
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full rounded-2xl border-2 border-ink bg-violet-400 px-4 py-2 text-sm font-bold text-white shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
      >
        {downloading ? 'Preparing…' : 'Download wants.txt'}
      </button>
      <p className="text-xs text-violet-600">
        Run the solver locally (Gurobi), then upload its output.
      </p>
```

and replace it with:

```tsx
      <div className="space-y-1">
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
          Objectives (priority order)
        </p>
        {objectives.map((o, i) => (
          <div key={o.key} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={o.checked}
              onChange={() => toggleObjective(i)}
              className="rounded border-ink/30 text-violet-500 focus:ring-violet-500"
            />
            <span className="w-5 text-xs text-violet-600">{i + 1}.</span>
            <span className="flex-1">{o.label}</span>
            <button
              type="button"
              onClick={() => moveObjective(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${o.label} up`}
              className="px-1.5 text-violet-600 disabled:opacity-30 hover:text-violet-800"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveObjective(i, 1)}
              disabled={i === objectives.length - 1}
              aria-label={`Move ${o.label} down`}
              className="px-1.5 text-violet-600 disabled:opacity-30 hover:text-violet-800"
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading || kpi.length === 0}
        className="w-full rounded-2xl border-2 border-ink bg-violet-400 px-4 py-2 text-sm font-bold text-white shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
      >
        {downloading ? 'Preparing…' : 'Download wants.txt'}
      </button>
      {kpi.length === 0 ? (
        <p className="text-xs text-red-600">Select at least one objective.</p>
      ) : (
        <p className="text-xs text-violet-600">
          Objectives: <code className="font-mono">--kpi {kpi.join(',')}</code>
          <br />
          Pass this flag when running the solver locally (Gurobi), then upload its output.
        </p>
      )}
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no type errors, no lint warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/matching/MatchRunPage.tsx
git commit -m "feat(matching-ui): organizer objectives picker with priority ordering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Backend suite for the touched apps**

Run: `cd backend && python -m pytest matching/ events/ -q`
Expected: PASS (no regressions).

- [ ] **Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS.

---

## Spec coverage check

- Organizer selects any non-empty subset + priority order → Task 4 (ordered checklist + ↑/↓, ≥1 required).
- Selection reaches solver as `--kpi` plain text → Task 4 (shows `--kpi <list>`).
- `distance` selected → locations in `wants.txt` → Task 1 (`_location_lines`) + Task 2 (`include_locations="distance" in kpi`).
- Default = just `trades` → Task 4 `DEFAULT_OBJECTIVES`; Task 2 default `["trades"]`.
- Location user set = owners-of-active-listings ∪ active-wishers with coords → Task 1 `_location_lines`.
- Stateless, no migration, FakeMatcher untouched → no model changes anywhere in the plan.
