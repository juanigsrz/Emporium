"""trades/pricing.py

Resolve effective money prices from the per-game default + overrides.

    resolve_ask(event_listing) -> Decimal | None
        per-copy EventListing.sell_price
        ?? UserGamePrice(owner, event, game)
        ?? None  (barter-only)

    resolve_bid(user, event, target) -> Decimal | None
        WantBid(user, event, target)
        ?? UserGamePrice(user, event, target.board_game)
        ?? None  (no bid)

`target` is a WantGroupItem (or any object exposing `.target_type`,
`.board_game_id`, and `.event_listing` with the same TextChoices string values).

Callers that invoke these helpers in a loop should pre-load related rows to
avoid N+1: select_related("copy") on listings passed to resolve_ask, and
prefetch `event_listing__copy` for any LISTING-target want items passed to
resolve_bid.
"""

from .models import UserGamePrice, WantBid, WantGroupItem


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


def resolve_ask(event_listing):
    """Effective sell ask for a listing, or None if barter-only."""
    if event_listing.sell_price is not None:
        return event_listing.sell_price
    copy = event_listing.copy
    return _game_default(copy.owner_id, event_listing.event_id, copy.board_game_id)


def _target_board_game_id(target):
    if target.target_type == WantGroupItem.TargetType.BOARD_GAME:
        return target.board_game_id
    return target.event_listing.copy.board_game_id


def resolve_bid(user, event, target):
    """Effective buy bid for a user's want target, or None if no bid."""
    if target.target_type == WantGroupItem.TargetType.BOARD_GAME:
        override = (
            WantBid.objects
            .filter(user=user, event=event,
                    target_type=WantBid.TargetType.BOARD_GAME,
                    board_game_id=target.board_game_id)
            .values_list("amount", flat=True)
            .first()
        )
    else:
        override = (
            WantBid.objects
            .filter(user=user, event=event,
                    target_type=WantBid.TargetType.LISTING,
                    event_listing_id=target.event_listing_id)
            .values_list("amount", flat=True)
            .first()
        )
    if override is not None:
        return override
    return _game_default(user.id, event.id, _target_board_game_id(target))
