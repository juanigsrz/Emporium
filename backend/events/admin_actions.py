"""
events/admin_actions.py

Organizer admin operations that mutate other users' event data.

kick_participant() removes ALL of a user's event-scoped rows from an event while
keeping their Copy inventory. Deleting the user's EventListings relies on the
existing on_delete=CASCADE FKs to clean up OTHER users' references to those
specific listings (WantGroupItem, WantBid, OfferGroupItem, plus any stale
TradeAssignment/Shipment).
"""

from django.db import transaction

from trades.models import (
    OfferGroup, WantGroup, WantGroupItem, TradeWish, WantBid, UserGamePrice,
)
from .models import EventListing, EventParticipation


def remove_listing(listing):
    """Delete an EventListing and every Combo it belongs to.

    A combo is a bundle traded as one unit; if one member leaves, the bundle is
    no longer the thing other users wished for, so the whole Combo is removed
    (not merely its ComboItem)."""
    from .models import Combo
    Combo.objects.filter(items__event_listing=listing).distinct().delete()
    listing.delete()


@transaction.atomic
def kick_participant(event, user):
    """Remove `user` from `event`. Returns an impact summary dict."""
    listings = EventListing.objects.filter(event=event, copy__owner=user)
    listing_ids = list(listings.values_list("id", flat=True))

    # Count distinct OTHER users whose specific-listing refs the cascade removes.
    affected = set(
        WantBid.objects.filter(event=event, event_listing_id__in=listing_ids)
        .exclude(user=user).values_list("user_id", flat=True)
    )
    affected.update(
        WantGroupItem.objects.filter(event_listing_id__in=listing_ids)
        .exclude(want_group__user=user).values_list("want_group__user_id", flat=True)
    )

    summary = {
        "username": user.username,
        "removed_listings": len(listing_ids),
        "removed_wishes": TradeWish.objects.filter(event=event, user=user).count(),
        "removed_groups": (
            OfferGroup.objects.filter(event=event, user=user).count()
            + WantGroup.objects.filter(event=event, user=user).count()
        ),
        "affected_other_users": len(affected),
    }

    # Delete the victim's event-scoped rows. Deleting the groups cascades to their
    # own wishes/items; deleting the listings cascades to other users' refs.
    TradeWish.objects.filter(event=event, user=user).delete()
    OfferGroup.objects.filter(event=event, user=user).delete()
    WantGroup.objects.filter(event=event, user=user).delete()
    WantBid.objects.filter(event=event, user=user).delete()
    UserGamePrice.objects.filter(event=event, user=user).delete()
    listings.delete()
    EventParticipation.objects.filter(event=event, user=user).delete()

    return summary
