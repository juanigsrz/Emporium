# Thumbnails + Visual Polish — Design

**Date:** 2026-06-11
**Status:** Approved (design); implementation plan pending
**Scope items:** #3, #4, #5, #6 from the 2026-06-11 manual-review backlog

## Problem

Several trade views show only text where a game thumbnail would help, and one
popup is visually broken:

- **#3 Visual view** (`MyWantsPage`, `view==='visual'`): wanted copies have no
  thumbnails, and there's nothing to make "what you send" vs "what you receive"
  visually obvious.
- **#4 Advanced X-to-Y builder** (`WantListBuilderPage`): the OfferGroups,
  WantGroups, and Wishes tabs list items as text only — no thumbnails.
- **#5 Matching** (`MatchRunPage`): the My Trades tab (Giving/Receiving) and the
  Shipping tab (Sending/Receiving) show no thumbnails.
- **#6 Grid view popup** (`MyWantsPage` `CopyDetailModal`): the popup is
  `fixed inset-0 z-50` but renders **inside** the grid view, so an ancestor
  stacking context traps it behind other elements. It should also show the game
  thumbnail and the new version name.

Thumbnails come from `board_game.metadata["thumbnail"]` (the established source;
`EventListingSerializer.board_game_thumbnail` and the catalog serializers already
expose it). The inline render pattern (`<img object-cover loading="lazy">` with a
fallback) is duplicated across a few files with no shared component.

## Decisions (from brainstorming)

1. **Shared `GameThumb` component** (Approach A): extract the inline thumbnail
   pattern into one component used by every new spot. Retrofit the 2–3 existing
   inline spots only if trivial — no forced refactor.
2. The Grid popup fix is a **React portal to `document.body`**, the robust escape
   from any ancestor stacking context (not just a higher z-index).
3. The popup's "Edition" row switches from free-text `copy.edition` →
   `copy.version_name` (consistency with the version-selector feature). This also
   closes the earlier `MyWantsPage` `copy.edition` follow-up for this surface.

## Backend

Add a `board_game_thumbnail` read field (a `SerializerMethodField` returning
`(<game>.metadata or {}).get("thumbnail", "")`, mirroring the existing
`EventListingSerializer.get_board_game_thumbnail`) to four serializers:

| Serializer | File | Game source for the thumbnail |
|---|---|---|
| `TradeAssignmentSerializer` | `matching/serializers.py` | `event_listing.copy.board_game` |
| `ShipmentSerializer` | `matching/serializers.py` | `assignment.event_listing.copy.board_game` |
| `WantGroupItemSerializer` | `trades/serializers.py` | BOARD_GAME → `board_game`; LISTING → `event_listing.copy.board_game` |
| `CopySerializer` | `copies/serializers.py` | `board_game` |

Each is additive and read-only (added to `fields`/`read_only_fields`). No model
or query changes (the related rows are already selected/loaded on these paths;
confirm `select_related` covers `board_game` where a serializer newly reaches it,
e.g. `WantGroupItemSerializer` LISTING target — add to the view's prefetch if a
new N+1 appears).

## Frontend

**`GameThumb`** (`frontend/src/components/GameThumb.tsx`): props
`{ src?: string | null; alt?: string; className?: string }`. Renders
`<img src object-cover loading="lazy">` when `src` is non-empty, else a neutral
placeholder box (a muted square with a small game icon). Default size via
`className` (callers pass e.g. `h-10 w-10`). One source of truth for the pattern.

**#3 Visual view** (`MyWantsPage`): render a `GameThumb` for the offered copy and
for each wanted copy, laid out as `[offered thumb] → [wanted thumb(s)]` with an
explicit arrow glyph between the send side and the receive side.

**#4 Builder** (`WantListBuilderPage`): add a `GameThumb` to each item row in the
OfferGroups tab (listing `board_game_thumbnail`), WantGroups tab, and Wishes tab
(new `WantGroupItem.board_game_thumbnail`).

**#5 Matching** (`MatchRunPage`): add a `GameThumb` to each Giving and Receiving
row (My Trades, from `TradeAssignment.board_game_thumbnail`) and each Sending and
Receiving row (Shipping, from `Shipment.board_game_thumbnail`).

**#6 Grid popup** (`MyWantsPage` `CopyDetailModal`): wrap the modal's rendered
output in a React portal targeting `document.body` (via `createPortal`) so it
escapes the grid's stacking context. Add a `GameThumb` next to the title using
`copy.board_game_thumbnail` (new `CopySerializer` field → add to the `Copy` TS
type), and change the "Edition" `CopyDetailRow` to use `copy.version_name`
(shown only when not "Unknown").

**API types** (`frontend/src/api`): add `board_game_thumbnail` to the TS types for
the matching assignment, shipment, want-group item, and copy as needed so the new
fields are typed.

## Testing

- **Backend:** for each of the four serializers, a test asserting
  `board_game_thumbnail` is in the serialized output and equals the game's
  `metadata["thumbnail"]` (and `""` when absent). Reuse existing test bases
  (`MatchingTestBase` for assignment/shipment/want-item; a copies test for Copy).
- **Frontend:** `tsc --noEmit` clean. Manual — thumbnails render (with the
  placeholder fallback when a game has no thumbnail); the Visual view shows the
  send→receive arrow; the Grid popup now renders above the grid; the popup shows
  the thumbnail + version name.

## Out of scope (v1)

- Retrofitting every pre-existing inline thumbnail to `GameThumb` (only if
  trivial; otherwise left as-is).
- Thumbnails in the Cycle/Visual graph on `MatchRunPage` (the `cycles` tab) —
  item #3 refers to the want-builder Visual view, not the match cycle graph.
- Image upload / hosting (thumbnails are external BGG URLs only).
- Lightbox/zoom on thumbnails.
