"""trades/pricing.py

Resolve effective money prices from the per-game default + overrides.

    resolve_ask(event_listing) -> Decimal | None
        per-copy EventListing.sell_price
        ?? UserGamePrice(owner, event, game)
        ?? None  (barter-only)

    resolve_bid(user, event, target) -> Decimal | None
        WantBid(user, event, target.event_listing)
        ?? UserGamePrice(user, event, target.event_listing.copy.board_game)
        ?? None  (no bid)

`target` is a WantGroupItem (or any object exposing `.event_listing`).

Callers that invoke these helpers in a loop should pre-load related rows to
avoid N+1: select_related("copy") on listings passed to resolve_ask, and
prefetch `event_listing__copy` for any LISTING-target want items passed to
resolve_bid.
"""

from .models import UserGamePrice, WantBid


def _game_default(user_id, event_id, board_game_id):
    if board_game_id is None:
        return None
    row = (
        UserGamePrice.objects
        .filter(user_id=user_id, event_id=event_id, board_game_id=board_game_id)
        .values_list("price", flat=True)
        .first()
    )
    return row


def load_bids(event):
    """Preload listing WantBids for an event: (user_id, event_listing_id) -> amount.

    Pass to resolve_bid to avoid a per-item DB lookup in bulk loops (exports).
    Combo bids are loaded separately via load_combo_bids.
    """
    return {
        (uid, elid): amount
        for uid, elid, amount in WantBid.objects
        .filter(event=event, event_listing__isnull=False)
        .values_list("user_id", "event_listing_id", "amount")
    }


def load_combo_bids(event):
    """Preload combo WantBids: (user_id, combo_id) -> amount."""
    return {
        (uid, cid): amount
        for uid, cid, amount in WantBid.objects
        .filter(event=event, combo__isnull=False)
        .values_list("user_id", "combo_id", "amount")
    }


def load_game_prices(event):
    """Preload all UserGamePrices for an event: (user_id, board_game_id) -> price.

    Pass to resolve_ask/resolve_bid to avoid a per-item DB lookup in bulk loops.
    """
    return {
        (uid, bgid): price
        for uid, bgid, price in UserGamePrice.objects
        .filter(event=event)
        .values_list("user_id", "board_game_id", "price")
    }


def resolve_ask(event_listing, game_prices=None):
    """Effective sell ask for a listing, or None if barter-only.

    Pass a preloaded game_prices map (load_game_prices) to skip the DB lookup.
    """
    if event_listing.sell_price is not None:
        return event_listing.sell_price
    copy = event_listing.copy
    if game_prices is not None:
        return game_prices.get((copy.owner_id, copy.board_game_id))
    return _game_default(copy.owner_id, event_listing.event_id, copy.board_game_id)


def resolve_ask_target(target):
    """Effective sell ask for a tradeable target.

    EventListing -> resolve_ask(target). Combo -> combo.sell_price (no fallback).
    """
    from events.models import Combo
    if isinstance(target, Combo):
        return target.sell_price
    return resolve_ask(target)


def resolve_bid(user, event, target, bids=None, game_prices=None, combo_bids=None):
    """Effective buy bid for a user's want target, or None if no bid.

    Pass preloaded bids/game_prices/combo_bids maps to skip per-item DB lookups
    in bulk loops. A combo target has no per-game fallback — its bid is the
    explicit WantBid(user, combo) only.
    """
    combo_id = getattr(target, "combo_id", None)
    if combo_id:
        if combo_bids is not None:
            return combo_bids.get((user.id, combo_id))
        return (
            WantBid.objects
            .filter(user=user, event=event, combo_id=combo_id)
            .values_list("amount", flat=True)
            .first()
        )
    if bids is not None:
        override = bids.get((user.id, target.event_listing_id))
    else:
        override = (
            WantBid.objects
            .filter(user=user, event=event, event_listing_id=target.event_listing_id)
            .values_list("amount", flat=True)
            .first()
        )
    if override is not None:
        return override
    bgid = target.event_listing.copy.board_game_id
    if game_prices is not None:
        return game_prices.get((user.id, bgid))
    return _game_default(user.id, event.id, bgid)
