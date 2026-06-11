# Add-Copy Form Parity + Version Selector — Design

**Date:** 2026-06-11
**Status:** Approved (design); implementation plan pending
**Scope item:** #1 from the 2026-06-11 manual-review backlog

## Problem

In `MyCopiesPage`, the **Add a copy** panel (`AddCopyPanel`) only collects game,
condition, and a free-text language — far fewer fields than the **Edit** modal
(`EditCopyModal`), which has condition, language, edition, sleeved, expansions,
missing/upgraded components, notes, trade-value hint, shipping constraints,
pickup, and photo URLs. Adding a copy then forces a second Edit pass to fill in
details.

Separately, both forms still use **free-text** `language` and `edition`. The
backend already models editions as `BoardGameVersion` rows imported from BGG and
derives `Copy.language` server-side from the selected version (`CopySerializer`
+ `BoardGameVersion.get_or_create_unknown`). No UI uses the version FK, and there
is no endpoint to list a game's versions.

## Decisions (from brainstorming)

1. **Form structure:** one shared `CopyForm` used by both Add (create) and Edit
   (update) — guarantees field parity, no drift. Add becomes a modal like Edit.
2. **"Edition" = a required version selector.** The selector always lists the
   game's real BGG versions PLUS an **"Unknown / Not specified"** option; the
   user must actively pick one, and Unknown is a valid pick. "Required" is
   enforced **client-side only** — the backend keeps `version` optional so CSV/BGG
   imports (which pass no version → Unknown fallback) keep working.
3. **Language is read-only, auto-derived** from the picked version
   (`version.language`, or `"Unknown"`). The free-text `language` and `edition`
   inputs are **removed** from both forms.
4. `Copy.edition` (CharField) stays on the model (legacy/import data) but is no
   longer form-editable; the version selector is the single "Edition" source.

## Backend

One new read-only endpoint.

`GET /api/games/{bgg_id}/versions/`
- Returns the game's **real** versions (i.e. `bgg_version_id IS NOT NULL`),
  excluding the synthetic Unknown row, ordered by `bgg_version_id`.
- Each item: `{id, bgg_version_id, name, language, year_published, thumbnail_url}`.
- `404` if the game (bgg_id) does not exist.
- Auth: same as the existing `games/{bgg_id}/` detail route (read endpoint).

A small `BoardGameVersionSerializer` (catalog) exposes those fields. The view
lives alongside the existing `BoardGameDetailView` in `catalog/views.py`, routed
in `catalog/urls.py`.

No change to `CopySerializer`: it already accepts `version` (optional), validates
the version belongs to the game, and derives `language` (`version.language` or
`"Unknown"`); `version=null` assigns the Unknown fallback.

## Frontend

**Shared `CopyForm`** (extracted from `EditCopyModal`'s form body):
- Field set = current Edit set **minus** free-text `language` and `edition`,
  **plus** the version selector. Fields: version (Edition)\*, condition\*,
  sleeved, includes_expansions, missing_components, upgraded_components,
  component_notes, owner_notes, trade_value_hint, shipping_constraints,
  pickup_available, photo_urls.
- **Version (Edition) \*** — required `<select>` populated from
  `GET /games/{bgg_id}/versions/`. Three kinds of option value, kept distinct:
  - `""` — a leading **disabled placeholder** ("Select an edition…"), the default;
    required validation fails while this is selected (this is "untouched").
  - `"UNKNOWN"` — the **"Unknown / Not specified"** option (a real, selectable
    choice). On submit it maps to `version = null`.
  - `"<id>"` — each real version, labelled `name (language) year`; maps to
    `version = Number(id)` on submit.
  Zod requires `value !== ""`. So Unknown is a valid pick; only the placeholder fails.
- **Language** — read-only display reflecting the picked version's language
  (or "Unknown"); not an input, not submitted.
- On submit, the payload's `version` is the picked version id or `null` (Unknown).

**`AddCopyModal`** (replaces `AddCopyPanel`): keeps the catalog game-picker step,
then renders `CopyForm` for the picked game (fetching its versions). Submits via
`useCreateCopy`. The "Add a copy" button opens this modal.

**`EditCopyModal`**: re-implemented on top of `CopyForm`, seeded from the existing
copy, fetching versions for `copy.board_game`. Seeding rule for the selector: if
`copy.version` is a real version present in the fetched list, preselect its `id`;
if the copy currently has the **Unknown fallback** (its version is absent from the
list because the endpoint excludes Unknown, or `version_name === "Unknown"`),
preselect the `"UNKNOWN"` sentinel.

**`MyCopyCard`**: the edition chip switches from `copy.edition` → `copy.version_name`,
shown only when it is non-empty and not `"Unknown"`.

**API layer** (`frontend/src/api`): add `listGameVersions(bggId)` +
`GameVersion` type; ensure `Copy`/create/patch payload types carry `version`
(number | null) and `version_name`.

## Testing

- **Backend:** `GET /games/{bgg_id}/versions/` returns the game's real versions,
  excludes the Unknown row, and 404s for an unknown bgg_id. (Reuse a catalog test
  base that imports sample games + creates versions.)
- **Frontend:** `tsc --noEmit` clean. Manual: Add a copy picking a real version →
  language reflects it; Add picking "Unknown" → language "Unknown"; Edit changing
  the version updates the derived language; Add form now exposes the full field
  set (parity with Edit).

## Out of scope (v1)

- Editing the game on an existing copy (game stays fixed after create).
- Version thumbnails in the selector (data is returned; rendering deferred).
- Backfilling `Copy.edition` from version names for legacy rows.
- A version search/typeahead (plain `<select>`; revisit if a game has very many
  versions).
