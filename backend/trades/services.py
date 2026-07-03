"""trades/services.py — cross-event import (best-effort)."""

from django.db import transaction


@transaction.atomic
def import_user_trades(user, source_event, target_event):
    """Copy the user's per-game prices and wants from source_event into
    target_event. Prices upsert. Wants are re-created (items re-resolved to the
    target's active listings by canonical game) only if the user has no want
    groups in the target yet. Returns {"prices": n, "want_groups": m}."""
    from events.models import EventListing
    from .models import UserGamePrice, WantGroup, WantGroupItem

    prices = 0
    for gp in UserGamePrice.objects.filter(user=user, event=source_event):
        UserGamePrice.objects.update_or_create(
            user=user, event=target_event, board_game=gp.board_game,
            defaults={"price": gp.price},
        )
        prices += 1

    want_groups = 0
    if not WantGroup.objects.filter(user=user, event=target_event).exists():
        # Target's active listings owned by others, grouped by canonical game.
        by_game = {}
        target_listings = (
            EventListing.objects.filter(event=target_event, active=True)
            .select_related("copy")
            .exclude(copy__owner=user)
        )
        for el in target_listings:
            by_game.setdefault(el.copy.board_game_id, []).append(el)

        src_groups = (
            WantGroup.objects.filter(user=user, event=source_event)
            .prefetch_related("items__event_listing__copy")
        )
        for wg in src_groups:
            games = set()
            for it in wg.items.all():
                if it.event_listing_id and it.event_listing:
                    games.add(it.event_listing.copy.board_game_id)
                # combo want items have no single canonical game -> skipped
            target_items = []
            for g in games:
                target_items.extend(by_game.get(g, []))
            if not target_items:
                continue
            new_wg = WantGroup.objects.create(
                user=user, event=target_event, name=wg.name,
                min_receive=wg.min_receive,
                duplicate_protection=wg.duplicate_protection,
            )
            for el in target_items:
                WantGroupItem.objects.create(want_group=new_wg, event_listing=el)
            want_groups += 1

    return {"prices": prices, "want_groups": want_groups}
