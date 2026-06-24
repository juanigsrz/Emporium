# Lifecycle Locks & Read-only (#2, #8) — Design

## Summary

Stop users changing matching-relevant inputs after they've committed, and make
the read-only state visible:

- **#2 Price lock:** once an event leaves `WANTLIST_OPEN` (i.e. `inputs_locked` /
  `MATCHING` onward), block edits to all price inputs — `UserGamePrice`,
  `WantBid`, and `EventListing.sell_price`.
- **#2 Location lock:** while a user participates in any non-`ARCHIVED` event,
  freeze their distance-relevant Profile fields (`latitude`, `longitude`,
  `max_trade_distance_km`) — block changes to an existing value (first-time set
  allowed); editable again once all their events are archived.
- **#8 Grey-out:** in the My Wants builder, disable + grey the editing controls
  once the event is locked, so it's obvious nothing can change.

**Repo:** Emporium. **Builds on:** the existing `inputs_locked` machinery.
**Scope:** one spec, one plan (backend locks + a frontend grey-out).

## Background

- `TradeEvent.inputs_locked` is True for `MATCHING`/`MATCH_REVIEW`/`FINALIZATION`/
  `SHIPPING`/`ARCHIVED`. Want/offer/wish/cap views and listing create/delete
  already gate on it via `EventScopedMixin._assert_editable`. **Gaps:**
  `GamePriceView` (put/delete) and `WantBidView` (put/delete) do **not** call
  `_assert_editable`; and `listing_detail`'s PATCH branch (sell_price) only
  guards DELETE, not PATCH — so prices remain editable after matching starts.
- Profile distance fields live on `accounts.Profile` (`latitude`, `longitude`,
  `max_trade_distance_km`), edited via `ProfileMeView` (`RetrieveUpdateAPIView`,
  `PATCH /api/profiles/me/`). No lock today. `EventParticipation` (events app)
  records which events a user joined.
- `MyWantsPage` shows a "locked for matching" banner and hides the save bar when
  locked, but its three views (`GameBrowse` catalog, `VisualMode`, `GridMode`)
  don't receive a `locked` prop and keep their inputs/buttons interactive.

## #2 Price lock (backend)

Apply `self._assert_editable(event)` (raises `PermissionDenied` → 403 when
`event.inputs_locked`) in:

- `trades/views.py` `GamePriceView.put` and `GamePriceView.delete`.
- `trades/views.py` `WantBidView.put` and `WantBidView.delete`.

In `events/views.py` `listing_detail`, guard the PATCH path: if
`event.inputs_locked`, raise `PermissionDenied("Prices are locked — this event
has moved to matching.")` before saving `sell_price` (mirroring the DELETE
guard).

GET (reads) stay open. Net effect: `UserGamePrice`, `WantBid`, and
`EventListing.sell_price` are read-only from `MATCHING` onward.

## #2 Location lock (backend)

In `ProfileMeView` (override `perform_update` / `update`), before applying a
profile change:

- Compute whether any of `latitude`, `longitude`, `max_trade_distance_km` would
  **change from a non-null current value** (a value is in `validated_data` and
  differs from the stored field, and the stored field is not `None`).
- If so AND the user has an `EventParticipation` in an event whose status is not
  `ARCHIVED` → raise `PermissionDenied` ("Your location is locked while you're in
  an active event; it can be changed once your events are archived.").
- First-time set (stored field is `None`) is always allowed. Non-distance profile
  fields (bio, etc.) are always editable.

Implementation detail: read the three fields off the existing `Profile` instance
(`self.get_object()`), compare against `serializer.validated_data`, and run the
participation check only when a real change to an existing value is detected.

## #8 Grey-out (frontend)

In `MyWantsPage`, thread `locked = event.inputs_locked` into the three view
components and make their controls read-only when locked:

- `GameBrowse` (catalog): disable the rating/price inputs (`RatingPriceRow`), the
  "Want" / per-card toggle buttons, and the `WantGroupControls` add-to-group
  controls; apply a greyed style.
- `VisualMode`: disable the per-item "Add want" and the remove (×) buttons.
- `GridMode`: disable the grid cell toggles and the per-game/bid inputs.

Reuse the existing `disabled:opacity-50` / `disabled` patterns. The banner and
hidden save bar already exist; this completes the read-only affordance.

## Testing

**Backend (Django):**
- Price lock: PUT/DELETE `game-prices`, PUT/DELETE `want-bids`, and PATCH a
  listing's `sell_price` all return 403 when the event is `MATCHING`; succeed
  when `WANTLIST_OPEN`.
- Location lock: changing `latitude` (existing value) while in a non-archived
  event → 403; first-time set (from null) → 200; changing it when the user's only
  event is `ARCHIVED` → 200; changing `max_trade_distance_km` (existing) while in
  an active event → 403; a non-distance field edit during an active event → 200.

**Frontend (#8):** typecheck + lint + manual checklist (open My Wants on a
`MATCHING` event → catalog/visual/grid controls are visibly disabled; on a
`WANTLIST_OPEN` event they're interactive).

## Files

- `backend/trades/views.py` (price-lock guards on GamePriceView/WantBidView)
- `backend/events/views.py` (listing PATCH price-lock guard)
- `backend/accounts/views.py` (ProfileMeView location lock)
- `backend/trades/test_price_lock.py`, `backend/accounts/test_location_lock.py`
- `frontend/src/features/trades/MyWantsPage.tsx` (grey-out)

## Out of scope

- Inputs that already lock at `MATCHING` (wants, offers, wishes, caps, listing
  create/delete) — unchanged.
- Locking other profile fields (only the three distance-relevant ones).
- Greying out other pages' edit controls beyond the My Wants builder (the
  builder is the primary edit surface; other surfaces already gate server-side).
