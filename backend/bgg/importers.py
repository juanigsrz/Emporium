"""Importer registry. Each feature registers `IMPORTERS[kind] = fn(job) -> dict`.

An importer returns {"summary": {...}, "result": {...}, "log": "..."}.
"""

from accounts.models import GameRating, Wishlist
from catalog.models import BoardGame
from copies.models import Copy

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


@register("OWNED")
@register("GEEKLIST")
def import_copies(job):
    client = BggClient()
    if job.kind == "GEEKLIST":
        rows = client.fetch_geeklist(job.source_ref)
        source = "BGG_GEEKLIST"
    else:
        rows = client.fetch_collection(job.user.profile.bgg_username, "OWNED")
        rows = rows + client.fetch_collection(job.user.profile.bgg_username, "OWNED_EXPANSIONS")
        source = "BGG_OWNED"

    skip_dupes = bool(job.options.get("skip_duplicates"))
    catalog_ids = set(
        BoardGame.objects.filter(bgg_id__in=[r.bgg_id for r in rows]).values_list("bgg_id", flat=True)
    )
    owned_ids = set(Copy.objects.filter(owner=job.user).values_list("board_game_id", flat=True))
    created, pending, skipped = [], [], []
    for r in rows:
        if r.bgg_id not in catalog_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "not in catalog"})
            continue
        if skip_dupes and r.bgg_id in owned_ids:
            skipped.append({"bgg_id": r.bgg_id, "reason": "duplicate"})
            continue
        copy = Copy(owner=job.user, board_game_id=r.bgg_id,
                    language=(r.language or ""), import_source=source)
        copy.recompute_pending()
        copy.save()
        owned_ids.add(r.bgg_id)
        created.append(copy.id)
        if copy.is_pending:
            pending.append(copy.id)
    return {
        "summary": {"created": len(created), "pending": len(pending), "skipped": len(skipped)},
        "result": {"created": created, "pending": pending, "skipped": skipped},
        "log": f"Copy import ({source}): {len(created)} created, {len(pending)} pending, {len(skipped)} skipped.",
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
