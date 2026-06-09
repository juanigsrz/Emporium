"""Importer registry. Each feature registers `IMPORTERS[kind] = fn(job) -> dict`.

An importer returns {"summary": {...}, "result": {...}, "log": "..."}.
"""

from accounts.models import GameRating, Wishlist
from catalog.models import BoardGame

from .client import BggClient

IMPORTERS = {}


def register(kind):
    def deco(fn):
        IMPORTERS[kind] = fn
        return fn
    return deco


@register("WISHLIST")
def import_wishlist(job):
    username = job.user.profile.bgg_username
    rows = BggClient().fetch_collection(username, "WISHLIST")
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    matched, skipped = [], []
    for r in rows:
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"})
            continue
        Wishlist.objects.update_or_create(
            user=job.user, board_game_bgg_id=r.bgg_id,
            defaults={"note": (r.wishlist_comment or "")[:200]},
        )
        matched.append(r.bgg_id)
    return {
        "summary": {"matched": len(matched), "skipped": len(skipped)},
        "result": {"matched": matched, "skipped": skipped},
        "log": f"Wishlist sync: {len(matched)} matched, {len(skipped)} skipped.",
    }


@register("RATINGS")
def import_ratings(job):
    rows = BggClient().fetch_collection(job.user.profile.bgg_username, "RATED")
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    matched, skipped = [], []
    for r in rows:
        if r.my_rating is None:
            skipped.append({"bgg_id": r.bgg_id, "reason": "no rating"})
            continue
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"})
            continue
        GameRating.objects.update_or_create(
            user=job.user, board_game_id=r.bgg_id, defaults={"value": r.my_rating},
        )
        matched.append(r.bgg_id)
    return {
        "summary": {"matched": len(matched), "skipped": len(skipped)},
        "result": {"matched": matched, "skipped": skipped},
        "log": f"Ratings import: {len(matched)} matched, {len(skipped)} skipped.",
    }
