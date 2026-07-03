# COMBO feature fixes — design

Date: 2026-06-23
Status: approved

The combo feature (#12) shipped backend + a first FE pass, but three frontend
problems remain. This spec fixes all three. One small backend change is included
so the displayed combo price matches what the solver actually bids.

## Background

- A `Combo` (events app) bundles ≥2 of a user's own `EventListing`s to trade as a
  unit. `Combo.sell_price` is the **owner's** bundle ask.
- A wisher can want a combo. The wisher's bid override lives in `WantBid(combo)`.
  `WantGroupItemSerializer.resolved_bid` already surfaces the resolved value.
- FE state lives in `frontend/src/features/trades/MyWantsPage.tsx`, which has three
  views: **catalog** (browse game cards, each expands to a copy dropdown via
  `GameCopies`), **visual** (one card per my-item, wanted items as thumbnails), and
  **grid** (rows = wished games, cols = my items; each row expands to `GameCopies`).
- Combo CRUD UI ("My Combos in This Event") lives in
  `frontend/src/features/events/EventDetailPage.tsx`.

## Issue 1 — invisible combo buttons (bug)

Root cause: the combo buttons use `bg-fern … text-cream`. `fern` is **not** in the
Tailwind palette (`tailwind.config.js`), so the background is transparent and the
white `text-cream` text is invisible on the parchment page — only the `border-ink`
outline shows ("just a shape").

Fix: restyle the three combo buttons to the standard primary button style used
elsewhere (`bg-butter … text-ink`):

- `EventDetailPage.tsx:984` — "+ New combo"
- `EventDetailPage.tsx:1206` — "Create combo" / "Save"
- `EventDetailPage.tsx:1274` — (third combo button in the section)

No layout/behavior change; color classes only.

## Issue 2 — browse & wish combos via member-game dropdowns

Today combos surface as their **own** synthetic-gameId row in both grid and visual
(`buildModel` L201–218), shown whether or not the user wished them — so they
pollute the grid (which should show wished items only) and there is no real browse
affordance.

New model: a combo is browsed/wished **inside the copy dropdown of each of its
member games** — the same item shown in multiple dropdowns.

### FE changes (`MyWantsPage.tsx`)

1. **Remove standalone surfacing.** Delete the "surface every active combo as a
   wantable row" block (`buildModel` L201–218). Keep the wished-combo path
   (L164–177) that adds a combo `Target` (`comboId`) when it appears in a want
   group — still needed for the visual view and persistence.
2. **Stop combos rendering as their own rows.** `GridMode` and `VisualMode` build
   rows/cards from game groups; combo targets (`gameId >= COMBO_GAME_OFFSET`) must
   not produce a standalone game group. (Wished combos still render — in the visual
   card cluster, see Issue 3 — but never as a top-level grid row.)
3. **Inject combos into `GameCopies`.** `GameCopies` receives the event's `combos`
   list. For game `bggId`, after the listing copies it renders the combos whose
   members include `bggId`, each as a selectable row:
   - member-game thumbnails + combo name,
   - a wish checkbox bound to the combo target key `comboTargetKey(comboId)`
     (`K:<id>`), so toggling the row under Gloomhaven or under Frosthaven toggles
     the **same** target,
   - toggling on calls `editor.addTarget(comboTarget)` then toggles the key for the
     acting items (mirrors the existing `toggleCopy` flow),
   - money events: a **read-only** effective bid (see pricing below). The override
     itself is edited in the advanced Prices panel (`WantListBuilderPage`), not here.
4. **Grid reachability.** Any **wished** combo forces its member-game rows to appear
   in the grid (even if the bare game has no wished copies), so the combo is always
   visible/removable in its dropdown. The combo never gets its own grid row.

### Combo price (FE display) — needs a backend change

The displayed effective bid must equal what the solver bids. Backend `resolve_bid`
(`trades/pricing.py`) currently returns **only** the explicit `WantBid(user,combo)`
for a combo, with **no** member-game fallback. So an un-overridden combo currently
bids nothing, which would make any FE "max member bid" display a lie.

Backend change: in `resolve_bid`, when the target is a combo and there is no
`WantBid(user,combo)`, fall back to **max** of the user's `UserGamePrice` over the
combo's member board games (None if the user priced none of them). Apply the same
fallback wherever combo bids are bulk-loaded for solver export
(`load_combo_bids` / the export path) so export and display agree. Add a test
(`trades/test_combos.py`) covering: override wins; else max member price; else None.

FE then shows `resolved_bid` for wished combos and computes the same max-member
value for not-yet-wished combos in the browse dropdown.

## Issue 3 — visual view: real combo rendering, labels, bigger thumbnails

In `VisualMode`:

1. **Bigger thumbnails.** Single-game received thumbnails and the offered (give)
   thumbnail grow to `h-32 w-32`.
2. **Combo cluster.** A wished combo renders not as one blank `GameThumb` but as an
   **outlined box** containing its member-game thumbnails (smaller, e.g. `h-16`),
   visually distinct from a single game. The single `×`-remove control stays
   (removes the combo target).
3. **Text labels.** Every received item (single game **and** combo) shows its name
   as a text label **below** the thumbnail, so it is readable without hovering.

## Out of scope

- Editing a combo bid override inline in MyWantsPage (stays in the advanced Prices
  panel).
- Any change to combo CRUD behavior beyond the button restyle.

## Files touched

- `frontend/src/features/events/EventDetailPage.tsx` — 3 button restyles.
- `frontend/src/features/trades/MyWantsPage.tsx` — buildModel, GameCopies, VisualMode,
  GridMode.
- `backend/trades/pricing.py` — `resolve_bid` combo fallback + bulk-load path.
- `backend/trades/test_combos.py` — combo-bid resolution test.

## Verification

- Backend: `resolve_bid` test passes (override / max-member / none).
- FE: combo buttons show text; grid shows only wished games; a combo appears in each
  member game's dropdown and toggles as one item; wished combo shows in the visual
  card as an outlined member-thumbnail cluster with a name label; thumbnails are
  `h-32`; un-overridden wished combo's displayed bid == max member bid == solver bid.
