# Add-Copy Form Parity + Version Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Add-a-copy form full field parity with Edit by sharing one `CopyForm`, and replace the free-text "Edition"/"Language" with a required BGG **version** selector that auto-derives language.

**Architecture:** One new read endpoint lists a game's real BGG versions. A shared `CopyForm` React component (extracted from the existing Edit modal) holds the whole field set + a version `<select>`; both `AddCopyModal` (create) and `EditCopyModal` (update) render it. The backend `CopySerializer` already accepts `version` and derives `language` — no change there.

**Tech Stack:** Django + DRF (backend, `manage.py test`), Vite + React + TypeScript + react-hook-form + zod (frontend, `tsc --noEmit`; no FE test harness — verify via tsc + manual).

Spec: `docs/superpowers/specs/2026-06-11-add-copy-form-parity-design.md`.

**Conventions:**
- `BoardGame` PK is `bgg_id`; only `bgg_id` + `name` are required to create one in tests.
- Run backend tests from `backend/`: `./venv/bin/python manage.py test <path>`.
- Commit messages: Conventional Commits. **No `Co-Authored-By` trailer** (project rule).
- The backend version→language derivation lives in `CopySerializer._resolve_version_and_language` (`version=null` → Unknown fallback, `language="Unknown"`); the new "required" rule is **client-side only**.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/catalog/serializers.py` | `BoardGameVersionSerializer` | Modify |
| `backend/catalog/views.py` | `BoardGameVersionsView` (list real versions, 404 if game missing) | Modify |
| `backend/catalog/urls.py` | route `games/{bgg_id}/versions/` | Modify |
| `backend/catalog/tests_versions.py` | endpoint tests | Modify (append) |
| `frontend/src/api/games.ts` | `GameVersion` type + `listGameVersions` + `useGameVersions` | Modify |
| `frontend/src/api/copies.ts` | add `version`/`version_name` to `Copy`, `version` to `CopyCreatePayload` | Modify |
| `frontend/src/features/copies/CopyForm.tsx` | shared form body: full field set + version select + derived language | Create |
| `frontend/src/features/copies/MyCopiesPage.tsx` | `EditCopyModal` + `AddCopyModal` use `CopyForm`; card edition chip → version | Modify |

---

## Task 1: Backend — versions endpoint

**Files:**
- Modify: `backend/catalog/serializers.py`, `backend/catalog/views.py`, `backend/catalog/urls.py`
- Test: `backend/catalog/tests_versions.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/catalog/tests_versions.py`:

```python
from rest_framework.test import APITestCase
from rest_framework import status

from catalog.models import BoardGame, BoardGameVersion


class GameVersionsAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.game = BoardGame.objects.create(bgg_id=500001, name="Versioned Game")
        cls.v1 = BoardGameVersion.objects.create(
            board_game=cls.game, bgg_version_id=9001, name="First Edition",
            language="English", year_published=2018,
        )
        cls.v2 = BoardGameVersion.objects.create(
            board_game=cls.game, bgg_version_id=9002, name="Deluxe",
            language="English|German", year_published=2021,
        )
        # synthetic Unknown — must be EXCLUDED from the endpoint
        cls.unknown = BoardGameVersion.get_or_create_unknown(cls.game)

    def test_lists_real_versions_excludes_unknown(self):
        resp = self.client.get(f"/api/games/{self.game.bgg_id}/versions/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {v["id"] for v in resp.data}
        self.assertEqual(ids, {self.v1.id, self.v2.id})
        self.assertNotIn(self.unknown.id, ids)

    def test_version_fields_present(self):
        resp = self.client.get(f"/api/games/{self.game.bgg_id}/versions/")
        v = next(v for v in resp.data if v["id"] == self.v1.id)
        self.assertEqual(v["bgg_version_id"], 9001)
        self.assertEqual(v["name"], "First Edition")
        self.assertEqual(v["language"], "English")
        self.assertEqual(v["year_published"], 2018)
        self.assertIn("thumbnail_url", v)

    def test_unknown_game_404(self):
        resp = self.client.get("/api/games/424242/versions/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_game_with_no_versions_returns_empty(self):
        g2 = BoardGame.objects.create(bgg_id=500002, name="No Versions")
        resp = self.client.get(f"/api/games/{g2.bgg_id}/versions/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data, [])
```

- [ ] **Step 2: Run — verify fail (404, route missing)**

Run: `cd backend && ./venv/bin/python manage.py test catalog.tests_versions.GameVersionsAPITests -v 2`
Expected: FAIL (404 for the versions URL).

- [ ] **Step 3: Add `BoardGameVersionSerializer`**

Append to `backend/catalog/serializers.py` (import `BoardGameVersion` from `.models` if not already imported):

```python
class BoardGameVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardGameVersion
        fields = ["id", "bgg_version_id", "name", "language", "year_published", "thumbnail_url"]
```

- [ ] **Step 4: Add `BoardGameVersionsView`**

In `backend/catalog/views.py`, import the serializer and add the view (no pagination — a single game's version list is bounded; return a plain list):

```python
from .serializers import BoardGameDetailSerializer, BoardGameListSerializer, BoardGameVersionSerializer


class BoardGameVersionsView(generics.ListAPIView):
    """GET /api/games/{bgg_id}/versions/ — real BGG versions of a game (excludes Unknown)."""

    serializer_class = BoardGameVersionSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_queryset(self):
        from .models import BoardGameVersion
        bgg_id = self.kwargs["bgg_id"]
        if not BoardGame.objects.filter(bgg_id=bgg_id).exists():
            raise NotFound(f"No game with bgg_id={bgg_id}.")
        return (
            BoardGameVersion.objects
            .filter(board_game_id=bgg_id, bgg_version_id__isnull=False)
            .order_by("bgg_version_id")
        )
```

- [ ] **Step 5: Route it**

In `backend/catalog/urls.py`, import `BoardGameVersionsView` and add (before or after the copies route):

```python
    path("games/<int:bgg_id>/versions/", BoardGameVersionsView.as_view(), name="game-versions"),
```

- [ ] **Step 6: Run — verify pass**

Run: `cd backend && ./venv/bin/python manage.py test catalog.tests_versions.GameVersionsAPITests -v 2`
Expected: PASS (4 tests).

- [ ] **Step 7: Full suite**

Run: `cd backend && ./venv/bin/python manage.py test -v 1`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/catalog/serializers.py backend/catalog/views.py backend/catalog/urls.py backend/catalog/tests_versions.py
git commit -m "feat(catalog): list a game's BGG versions endpoint"
```

---

## Task 2: Frontend API layer — versions + Copy.version types

**Files:**
- Modify: `frontend/src/api/games.ts`, `frontend/src/api/copies.ts`

- [ ] **Step 1: Add version type + fetch/hook to `games.ts`**

Add to `frontend/src/api/games.ts` (match the file's existing `apiClient` + react-query style):

```typescript
export interface GameVersion {
  id: number
  bgg_version_id: number | null
  name: string
  language: string
  year_published: number | null
  thumbnail_url: string
}

export async function listGameVersions(bggId: number): Promise<GameVersion[]> {
  const { data } = await apiClient.get<GameVersion[]>(`/games/${bggId}/versions/`)
  return data
}

export function useGameVersions(bggId: number | undefined) {
  return useQuery({
    queryKey: ['games', 'versions', bggId],
    queryFn: () => listGameVersions(bggId!),
    enabled: bggId != null,
    staleTime: 5 * 60_000,
  })
}
```

(If `useQuery` / `apiClient` are imported differently in this file, match that. Confirm `useQuery` is imported from `@tanstack/react-query`.)

- [ ] **Step 2: Add `version` fields to copy types in `copies.ts`**

In `frontend/src/api/copies.ts`:
- In `interface Copy`, add after `board_game_name`:
  ```typescript
  version: number | null
  version_name: string
  ```
- In `interface CopyCreatePayload`, add:
  ```typescript
  version?: number | null
  ```
  (`CopyPatchPayload` already extends `Partial<CopyCreatePayload>`, so it inherits `version`.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (Existing `MyCopiesPage` doesn't yet reference `version`, so adding optional/required fields here is safe; `version`/`version_name` are required on `Copy` and the API always returns them.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/games.ts frontend/src/api/copies.ts
git commit -m "feat(copies): FE types + hook for game versions"
```

---

## Task 3: Shared `CopyForm` + convert `EditCopyModal`

Extract the form into a reusable `CopyForm`, dropping free-text language/edition and adding the version selector + derived language. Prove it by re-implementing `EditCopyModal` on top of it (Edit already has the full field set).

**Files:**
- Create: `frontend/src/features/copies/CopyForm.tsx`
- Modify: `frontend/src/features/copies/MyCopiesPage.tsx`

- [ ] **Step 1: Create `frontend/src/features/copies/CopyForm.tsx`**

The schema + version/language logic are NEW (below in full). The remaining field JSX (condition, sleeved, includes_expansions, missing/upgraded components, component_notes, owner_notes, trade_value_hint, shipping_constraints, pickup_available, photo_urls) is **relocated verbatim** from the current `EditCopyModal` form body in `MyCopiesPage.tsx` — same `register(...)`, same Tailwind classes, same `inputCls` helper, same photo `useFieldArray`. Do NOT re-add the `language` or `edition` `<input>`s.

```tsx
import { useEffect, useMemo } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CONDITION_LABELS } from './constants'
import { useGameVersions } from '../../api/games'

const CONDITION_VALUES = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const
const SLEEVED_VALUES = ['UNKNOWN', 'NONE', 'SLEEVED'] as const
const SLEEVED_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown', NONE: 'Not sleeved', SLEEVED: 'Sleeved',
}

// version_sel: "" = untouched (fails required); "UNKNOWN" = explicit Unknown; "<id>" = a real version.
export const copyFormSchema = z.object({
  version_sel: z.string().min(1, 'Select an edition'),
  condition: z.enum(CONDITION_VALUES, { error: 'Condition is required' }),
  sleeved: z.enum(SLEEVED_VALUES).optional(),
  includes_expansions: z.string().optional(),
  missing_components: z.string().optional(),
  upgraded_components: z.string().optional(),
  component_notes: z.string().optional(),
  owner_notes: z.string().optional(),
  trade_value_hint: z.string().max(120).optional(),
  shipping_constraints: z.string().optional(),
  pickup_available: z.boolean().optional(),
  photo_urls: z
    .array(z.object({ url: z.string().url('Must be a valid URL').or(z.literal('')) }))
    .optional(),
})
export type CopyFormValues = z.infer<typeof copyFormSchema>

export interface CopySubmitPayload {
  version: number | null
  condition: (typeof CONDITION_VALUES)[number]
  sleeved?: (typeof SLEEVED_VALUES)[number]
  includes_expansions?: string
  missing_components?: string
  upgraded_components?: string
  component_notes?: string
  owner_notes?: string
  trade_value_hint?: string
  shipping_constraints?: string
  pickup_available?: boolean
  photo_urls?: string[]
}

export interface CopyFormProps {
  boardGameId: number
  formId: string
  // Edit seeding (omit for Add):
  initial?: Partial<CopyFormValues> & { versionId?: number | null; versionName?: string }
  onSubmit: (payload: CopySubmitPayload) => Promise<void>
  serverError: string | null
}

export function CopyForm({ boardGameId, formId, initial, onSubmit, serverError }: CopyFormProps) {
  const { data: versions = [], isLoading: versionsLoading } = useGameVersions(boardGameId)

  const {
    register, handleSubmit, control, watch, setValue,
    formState: { errors },
  } = useForm<CopyFormValues>({
    resolver: zodResolver(copyFormSchema),
    defaultValues: {
      version_sel: '',
      condition: initial?.condition ?? 'GOOD',
      sleeved: initial?.sleeved ?? 'UNKNOWN',
      includes_expansions: initial?.includes_expansions ?? '',
      missing_components: initial?.missing_components ?? '',
      upgraded_components: initial?.upgraded_components ?? '',
      component_notes: initial?.component_notes ?? '',
      owner_notes: initial?.owner_notes ?? '',
      trade_value_hint: initial?.trade_value_hint ?? '',
      shipping_constraints: initial?.shipping_constraints ?? '',
      pickup_available: initial?.pickup_available ?? false,
      photo_urls: initial?.photo_urls ?? [],
    },
  })

  const { fields: photoFields, append: appendPhoto, remove: removePhoto } = useFieldArray({
    control, name: 'photo_urls',
  })

  // Seed the version selector once the version list has loaded (Edit only).
  useEffect(() => {
    if (versionsLoading) return
    let sel = ''
    if (initial?.versionId != null && versions.some((v) => v.id === initial.versionId)) {
      sel = String(initial.versionId)
    } else if (initial && (initial.versionName === 'Unknown' || initial.versionId != null)) {
      // copy exists but its version is the Unknown fallback (excluded from the list)
      sel = 'UNKNOWN'
    }
    if (sel) setValue('version_sel', sel, { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsLoading])

  const versionSel = watch('version_sel')
  const derivedLanguage = useMemo(() => {
    if (versionSel === '' || versionSel === 'UNKNOWN') return 'Unknown'
    const v = versions.find((vv) => String(vv.id) === versionSel)
    return v?.language || 'Unknown'
  }, [versionSel, versions])

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      version: values.version_sel === 'UNKNOWN' ? null : Number(values.version_sel),
      condition: values.condition,
      sleeved: values.sleeved,
      includes_expansions: values.includes_expansions || undefined,
      missing_components: values.missing_components || undefined,
      upgraded_components: values.upgraded_components || undefined,
      component_notes: values.component_notes || undefined,
      owner_notes: values.owner_notes || undefined,
      trade_value_hint: values.trade_value_hint || undefined,
      shipping_constraints: values.shipping_constraints || undefined,
      pickup_available: values.pickup_available,
      photo_urls: values.photo_urls?.filter((p) => p.url.trim() !== '').map((p) => p.url.trim()),
    })
  })

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
      hasErr ? 'border-red-400' : 'border-gray-300'
    }`

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {serverError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Version (Edition) — required */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Edition <span className="text-red-500">*</span>
        </label>
        <select {...register('version_sel')} className={inputCls(!!errors.version_sel)} disabled={versionsLoading}>
          <option value="" disabled>{versionsLoading ? 'Loading editions…' : 'Select an edition…'}</option>
          <option value="UNKNOWN">Unknown / Not specified</option>
          {versions.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name}{v.language ? ` (${v.language})` : ''}{v.year_published ? ` ${v.year_published}` : ''}
            </option>
          ))}
        </select>
        {errors.version_sel && <p className="mt-1 text-xs text-red-600">{errors.version_sel.message}</p>}
        <p className="mt-1 text-xs text-gray-400">Language: <span className="font-medium text-gray-600">{derivedLanguage}</span> (from edition)</p>
      </div>

      {/* Condition — required */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Condition <span className="text-red-500">*</span>
        </label>
        <select {...register('condition')} className={inputCls(!!errors.condition)}>
          <option value="">Select condition…</option>
          {Object.entries(CONDITION_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
        </select>
        {errors.condition && <p className="mt-1 text-xs text-red-600">{errors.condition.message}</p>}
      </div>

      {/* ↓↓↓ RELOCATE the remaining field JSX verbatim from the current EditCopyModal:
            Sleeved, Includes expansions, Missing/Upgraded components, Component notes,
            Owner notes, Trade value hint, Shipping constraints, Pickup available, Photo URLs.
            Use SLEEVED_LABELS, photoFields/appendPhoto/removePhoto, register(...), inputCls(...)
            exactly as today. Do NOT include the free-text Language or Edition <input>s. ↓↓↓ */}
    </form>
  )
}
```

> The `SLEEVED_LABELS` constant is defined above; the original `MyCopiesPage` copy of it can stay or be imported — keep one source if trivial, otherwise leave both (do not over-refactor).

- [ ] **Step 2: Re-implement `EditCopyModal` on top of `CopyForm`**

In `MyCopiesPage.tsx`, replace `EditCopyModal`'s internal form with `CopyForm`. Keep the modal chrome (header with `#listing_code`, Cancel/Save footer wired to `form="edit-copy-form"`). The submit handler keeps the existing `patchCopy.mutateAsync` + server-error extraction, but now receives a `CopySubmitPayload` and passes it straight through (it already maps cleanly; just include `version`):

```tsx
function EditCopyModal({ copy, onClose }: EditCopyModalProps) {
  const patchCopy = usePatchCopy()
  const [serverError, setServerError] = useState<string | null>(null)

  async function handleSubmit(payload: CopySubmitPayload) {
    setServerError(null)
    try {
      await patchCopy.mutateAsync({ id: copy.id, payload })
      onClose()
    } catch (err: unknown) {
      setServerError(extractCopyError(err))  // reuse the existing error-extraction logic
    }
  }

  return (
    <ModalShell title="Edit copy" subtitle={`#${copy.listing_code}`} onClose={onClose} formId="edit-copy-form" submitLabel="Save changes" pending={patchCopy.isPending}>
      <CopyForm
        boardGameId={copy.board_game}
        formId="edit-copy-form"
        initial={{
          condition: copy.condition, sleeved: copy.sleeved,
          includes_expansions: copy.includes_expansions, missing_components: copy.missing_components,
          upgraded_components: copy.upgraded_components, component_notes: copy.component_notes,
          owner_notes: copy.owner_notes, trade_value_hint: copy.trade_value_hint,
          shipping_constraints: copy.shipping_constraints,
          pickup_available: copy.pickup_available,
          photo_urls: (copy.photo_urls ?? []).map((url) => ({ url })),
          versionId: copy.version, versionName: copy.version_name,
        }}
        onSubmit={handleSubmit}
        serverError={serverError}
      />
    </ModalShell>
  )
}
```

You may either (a) extract the existing modal chrome into a small `ModalShell` (header + scroll body + Cancel/submit footer) reused by both Add and Edit, or (b) keep the existing inline modal markup in `EditCopyModal` and wrap `CopyForm` with it. Prefer (a) — it keeps Add/Edit visually identical and is a clean small unit — but (b) is acceptable if extraction balloons. Move the existing server-error parsing into a module helper `extractCopyError(err)` so both modals share it.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. Remove the now-unused `editSchema`/`EditFormValues` and the relocated imports from `MyCopiesPage` if they are orphaned by this change.

- [ ] **Step 4: Manual verify (Edit)**

Run the app. Open Edit on an existing copy: the Edition selector shows the game's versions (or just "Unknown"), seeded to the copy's current version; the read-only Language reflects it; changing the edition updates Language; Save persists and the card reflects the new derived language.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/copies/CopyForm.tsx frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "feat(copies): shared CopyForm with version selector; Edit uses it"
```

---

## Task 4: `AddCopyModal` (parity) + card version display

Convert the minimal Add panel into a modal that reuses `CopyForm`, and switch the card's edition chip to the version name.

**Files:**
- Modify: `frontend/src/features/copies/MyCopiesPage.tsx`

- [ ] **Step 1: Replace `AddCopyPanel` with `AddCopyModal`**

Keep the catalog game-picker (the `useGamesList` typeahead + `picked` state). Once a game is picked, render `CopyForm` (no `initial`) inside the same `ModalShell`. Submit via `useCreateCopy`, passing `board_game: picked.bgg_id` plus the `CopySubmitPayload`:

```tsx
function AddCopyModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ bgg_id: number; name: string } | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const { data } = useGamesList({ search: q.trim(), ordering: 'rank' })
  const results = q.trim().length >= 2 && !picked ? (data?.results ?? []).slice(0, 8) : []
  const create = useCreateCopy()

  async function handleSubmit(payload: CopySubmitPayload) {
    if (!picked) return
    setServerError(null)
    try {
      await create.mutateAsync({ board_game: picked.bgg_id, ...payload })
      onClose()
    } catch (err: unknown) {
      setServerError(extractCopyError(err))
    }
  }

  // Picker step (reuse the existing typeahead markup from AddCopyPanel).
  // Once `picked`, render <CopyForm boardGameId={picked.bgg_id} formId="add-copy-form" onSubmit={handleSubmit} serverError={serverError} />
  // inside ModalShell with submitLabel="Add copy", pending={create.isPending}, and a "Change game" affordance.
}
```

`CopyCreatePayload` now includes optional `version`; `create.mutateAsync({ board_game, ...payload })` type-checks because `payload` carries `version: number | null` and the rest of the optional fields.

- [ ] **Step 2: Wire the "Add a copy" button to the modal**

In `MyCopiesPage`, the `addOpen` state now toggles `<AddCopyModal onClose={() => setAddOpen(false)} />` instead of the inline `<AddCopyPanel/>`. Keep the empty-state "Add a copy" button behavior.

- [ ] **Step 3: Card edition chip → version name**

In `MyCopyCard`, replace the `copy.edition` chip block:

```tsx
{copy.version_name && copy.version_name !== 'Unknown' && (
  <span className="text-xs border border-gray-100 rounded px-1.5 py-0.5 text-gray-400">
    {copy.version_name}
  </span>
)}
```

(Leave the `copy.language` chip as-is — it's still the derived language.)

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. Remove the now-orphaned `AddCopyPanel`, `ADD_CONDITION_OPTIONS`, and any imports unused after the swap.

- [ ] **Step 5: Manual verify (Add parity)**

Run the app. Click "Add a copy": pick a game → the form shows the FULL field set (sleeved, expansions, components, notes, trade value, shipping, pickup, photos) plus the required Edition selector. Picking a real version derives its language; picking "Unknown" → language "Unknown"; submitting without touching the Edition selector is blocked with the "Select an edition" error. The new copy appears with the right condition/language/version.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/copies/MyCopiesPage.tsx
git commit -m "feat(copies): Add-a-copy modal with full field parity"
```

---

## Final verification

- [ ] `cd backend && ./venv/bin/python manage.py test` — full suite green.
- [ ] `cd frontend && npx tsc --noEmit` — clean.
- [ ] Manual end-to-end: Add a copy (full fields + version → language) and Edit a copy (version reseeded, language derived) both work; the card shows the version name and derived language; the free-text Edition/Language inputs are gone from both forms.
