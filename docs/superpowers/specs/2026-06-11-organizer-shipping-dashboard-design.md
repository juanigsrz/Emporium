# Organizer Shipping Dashboard — Design

**Date:** 2026-06-11
**Status:** Approved (design); implementation plan pending
**Scope item:** #7 from the 2026-06-11 manual-review backlog

## Problem

The Shipping tab (`MatchRunPage`) is **user-scoped** — `ShippingView`
(`GET /events/{slug}/shipping/`) returns only the requester's own shipments
(assignments where they are giver or receiver). The organizer has no way to
browse the **overall** shipping status of an event: what's been marked sent,
what's still pending, and which traders are behind.

## Decisions (from brainstorming)

1. The dashboard is **read-only browsing** — the organizer sees status but does
   not act on shipments in v1.
2. **Approach A:** one organizer-only endpoint returns the flat list of all
   shipments; the FE computes the status counts and per-trader rollup (one
   event's shipments is a small dataset). No server-side aggregation.
3. The dashboard surfaces as an **organizer-only tab in `MatchRunPage`**, shown
   when `is_organizer` and the event is `SHIPPING`/`ARCHIVED`, alongside the
   existing per-user Shipping tab.

## Backend

New organizer-only endpoint, mirroring `ShippingView` minus the user filter.

`GET /api/events/{slug}/shipping/overview/`
- Auth: `IsAuthenticated`; reject non-organizers with `PermissionDenied` (403)
  using the established check `event.organizer_id != request.user.id`.
- Resolve the run with the existing `_latest_done_run(event)`; if `None`,
  return `[]`.
- Take **all** `TradeAssignment`s of that run (no giver/receiver filter),
  `Shipment.objects.get_or_create(assignment=a)` each (lazily creating any
  missing rows so the overview is complete), and serialize with the existing
  `ShipmentSerializer` (which already exposes `id`, `status`, `shipping_info`,
  `listing_code`, `board_game_name`, `board_game_thumbnail`, `giver_username`,
  `receiver_username`, `my_role`, `sent_at`, `received_at`).
- Route in `matching/urls.py` named `shipping-overview`. The literal `overview`
  segment does not collide with the `shipping/<int:pk>/` route (int converter).

`ShipmentSerializer.get_my_role` reads `request.user`; for an organizer who is
not a participant it returns `None`, which the overview ignores (it shows the
explicit `giver → receiver`). Context with `request` is passed as today.

No model changes.

## Frontend

**API** (`api/shipping.ts`): `listShippingOverview(slug): Promise<Shipment[]>`
(GET the new endpoint) + `useShippingOverview(slug, enabled)` react-query hook.
Reuse the existing `Shipment` type.

**Dashboard** — a new organizer-only tab in `MatchRunPage`, labelled
"Shipping Overview", added to the `tabs` array only when the viewer
`is_organizer` AND the event status is `SHIPPING` or `ARCHIVED` (the same
`showShipping` gate the per-user Shipping tab uses). The tab content renders, all
computed FE-side from the flat `Shipment[]`:

1. **Status count bar** — totals for Pending / Sent / Received.
2. **Per-trader rollup** — grouped by username across all shipments. For each
   trader: sending `sent/total-outgoing` (where they are the giver; "sent"
   counts status `SENT` or `RECEIVED`) and receiving `received/total-incoming`
   (where they are the receiver; "received" counts status `RECEIVED`). Flag a
   trader with ⚠ when `sent < total-outgoing` or `received < total-incoming`.
3. **Filterable table** — one row per shipment: a `GameThumb` + game name,
   `giver_username → receiver_username`, a status badge, sent/received dates,
   and shipping notes. A status filter (all / pending / sent / received) above
   the table.

Reuse `GameThumb` (from the thumbnails feature) and the existing shipping
status-badge styling where practical.

**`is_organizer` source:** `MatchRunPage` must know whether the viewer is the
organizer. If it already has the event (with `is_organizer` from
`TradeEventSerializer`), use it; otherwise read `is_organizer` from the event
detail the page fetches. (Confirm during implementation; the field exists on the
event serializer.)

## Testing

- **Backend:** organizer GET returns shipments for **all** participants'
  assignments (not just their own); a non-organizer gets 403; the endpoint
  lazily creates missing `Shipment` rows; returns `[]` when there is no DONE run.
  (Reuse `MatchingTestBase` + a DONE run with assignments across users.)
- **Frontend:** `tsc --noEmit` clean. Manual — the tab appears only for the
  organizer in SHIPPING/ARCHIVED; the count bar, per-trader rollup (with the
  behind ⚠ flag), and filterable table render correctly from real data.

## Out of scope (v1)

- Organizer acting on shipments (marking sent/received on a trader's behalf,
  nudging, reminders).
- CSV/export of the shipping status.
- Pagination (one event's shipment count is small; the flat list is fine).
- Real-time updates (the react-query refetch on tab focus is sufficient).
