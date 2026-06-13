# Organizer Manage Dashboard — Design

**Date:** 2026-06-13
**Status:** Approved (design)
**Topic:** Organizer tool to inspect/edit participants' submissions and kick a user, for fixing problems before re-running the solver.

## Problem

After matching, an organizer may discover something wrong — a participant made a mistake, or a malicious user submitted abusive listings/wishes. The organizer needs to manually fix the inputs (or remove the user entirely) and re-run the solver. Today there is no in-app tool: submissions are owner-only and locked once the event leaves the open phases.

## Goals

- Let the **organizer** search any participant and inspect their listings + wishes.
- Edit operations on another user's submissions:
  - Toggle a `TradeWish` active/inactive.
  - Remove/unlist one of the user's `EventListing`s.
  - Edit a group's `max_give` (X) / `min_receive` (Y) bound.
- **Kick** a user from the event: remove all their event-scoped data, keep their `Copy` records.
- Surface the existing solver re-run flow so the organizer can re-solve after fixing.

## Non-goals (YAGNI)

- Audit log / undo.
- Per-want-target (`WantGroupItem`) removal.
- Automated re-run after edits.
- Touching the kicked user's `Copy` inventory (copies are preserved).
- Settlement/money concerns (separate, deferred feature).

## Approach

**Dedicated organizer-admin endpoints under the event + a new organizer-only Manage page.** This keeps a single, auditable admin surface and a clean permission boundary, and reuses existing serializers. (Rejected: relaxing owner-only checks across existing trade endpoints — scatters permission logic and weakens a uniform security boundary. Rejected: Django admin — no cascade safety, not in-app.)

### Permission

All admin endpoints require `event.organizer == request.user`, else `403` (mirrors `EventViewSet._check_organizer`). Admin actions intentionally **bypass `inputs_locked`** — the override is needed precisely when normal submission is closed. Blocked when event status is `ARCHIVED`.

### Backend endpoints

Namespaced under `/api/events/{slug}/admin/` (organizer-only):

| Method & path | Purpose |
|---|---|
| `GET  …/admin/submissions/?user={username}` | That participant's `EventListing`s, `OfferGroup`s, `WantGroup`s, and `TradeWish`es (with bounds + active flag) for the panel. |
| `PATCH …/admin/wishes/{id}/` `{active}` | Toggle a `TradeWish.active`. |
| `PATCH …/admin/offer-groups/{id}/` `{max_give}` | Edit X. |
| `PATCH …/admin/want-groups/{id}/` `{min_receive}` | Edit Y. |
| `DELETE …/admin/listings/{id}/` | Unlist one copy from the event. |
| `POST …/admin/kick/` `{username}` | Transactional kick (below). |

Each `{id}` resource is validated to belong to `{slug}` before mutation.

### Kick cascade (atomic)

`POST …/admin/kick/` runs in a `transaction.atomic()`:

1. Resolve the target user (must be a participant).
2. Delete the user's event-scoped rows: `EventParticipation`, `EventListing` (their copies' listings in this event), `OfferGroup`, `WantGroup`, `TradeWish`, `WantBid`, `UserGamePrice`.
3. DB `on_delete=CASCADE` automatically removes **other** users' rows that referenced the kicked user's listings: `WantGroupItem`(LISTING), `WantBid`(LISTING), `OfferGroupItem`, plus any `TradeAssignment`/`Shipment` from a stale run. BOARD_GAME-type wants correctly survive (they target a game, not a specific listing).
4. `Copy` records are **not** touched.
5. Return a summary: `{removed_listings, removed_wishes, removed_groups, affected_other_users}` for the confirm-dialog preview.

### Frontend

- New organizer-only route `/events/:slug/manage` (route guard: redirect non-organizers).
- "Manage" button in the organizer header controls on `EventDetailPage` links to it.
- Page layout:
  - **Participant search** — pick a username (sourced from the participants list).
  - **Submissions panel** — the user's listings (each with *Unlist* + inline X/Y bound edit) and wishes (each with an *Active* toggle).
  - **Kick** button → confirm dialog. The preview uses counts already loaded in the submissions panel (their listings/wishes); no separate dry-run endpoint. On confirm, `POST …/admin/kick/` returns the actual removed summary, shown as a result toast.
- Reuse the existing confirm-dialog pattern (mirrors the status-change confirm) and `CopyDetailModal` for inspecting a listing.
- After edits: a link/CTA to the existing match-run flow to re-solve. A removed listing/kick invalidates the prior run; the organizer re-runs.

## Data model

No schema changes. All operations are deletes/updates on existing models. The cross-user cascade relies on existing `on_delete=CASCADE` FKs:
`OfferGroupItem.event_listing`, `WantGroupItem.event_listing`, `WantBid.event_listing`, `TradeAssignment.event_listing` (→ `Shipment`).

## Testing

**Backend (primary):**
- Kick cascade: other users' LISTING-type `WantGroupItem`/`WantBid` referencing the kicked user's listings are removed; BOARD_GAME-type wants survive; kicked user's `Copy` rows preserved; participation/listings/groups/wishes/bids/prices gone.
- Permission: non-organizer → 403 on every admin endpoint.
- Edits: toggle wish active, edit X/Y bounds, unlist a listing (and its cascade).
- `ARCHIVED` event → admin mutations blocked.
- Atomicity: a failing kick rolls back fully.

**Frontend (light):** route guard hides Manage from non-organizers; toggle/unlist/kick call the right endpoints and refresh.

## Open extensions (future)

Audit log of organizer actions; undo; auto re-run; per-want-target editing.
