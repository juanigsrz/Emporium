"""
seed_test_event — populate a testing event with many users, copies, and submitted listings.

Creates:
    - 1 organizer + N trader users (fixed usernames, idempotent)
    - a pool of distinct BoardGames (top-ranked) the copies spread over (so the
      same game is owned by several users → trades are actually possible)
    - K copies per trader (random game/condition/language)
    - an EventParticipation + active EventListing for every copy (= "submitted")
    - one OfferGroup + WantGroup + TradeWish trio per listing, plus optional
      money bids/asks, so the event has real wishes to match

Usage:
    python manage.py seed_test_event
    python manage.py seed_test_event --users 12 --games 40 --reset
    python manage.py seed_test_event --slug demo-trade --status SUBMISSIONS_OPEN

Re-run with --reset to wipe the event (cascades listings/participations) and the
seeded traders' copies, then rebuild. Without --reset it refuses to clobber an
existing event.

Performance notes
-----------------
Every write goes through bulk_create / bulk_update instead of per-row .create() /
.save(). For a big event (e.g. --users 300 --wants-max 299) the old version
issued one INSERT per WantGroupItem — hundreds of thousands of round-trips; this
version issues a few hundred statements total. The shared test password is hashed
once and reused for every user instead of running the KDF per user.

Assumptions:
    * PostgreSQL (or any backend whose bulk_create returns primary keys, incl.
      modern SQLite/MariaDB). The OfferGroup/WantGroup rows are bulk-created and
      their returned PKs are used to attach items/wishes. On a backend that does
      NOT return PKs you'd re-fetch the groups before building the children.
    * The seeded models are plain data rows. bulk_create bypasses Model.save()
      and post_save signals; if e.g. Copy.save() generates a field (a listing_code,
      a denormalized counter, a search-index hook), revert that one block to a
      per-row Copy.objects.create() loop.

The RNG draw order is identical to the previous version, so a given --seed still
produces the same data set.
"""

"""
seed_test_event — populate a testing event with many users, copies, and submitted listings.
Optimized for massive scale using generator-based chunking.
"""

import random
from itertools import islice

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import BoardGame, BoardGameVersion
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent
from trades.models import (
    OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, WantBid,
)

User = get_user_model()

PASSWORD = "testpass123"
ORGANIZER_USERNAME = "mt_organizer"
TRADER_PREFIX = "trader"
LANGUAGES = ["English", "Spanish", "German", "French"]
BATCH = 5000  # Increased for higher throughput on large datasets


def chunked_bulk_insert(model, generator, batch_size=BATCH):
    """Consumes a generator in chunks and bulk_creates them to keep memory flat."""
    total_created = 0
    while True:
        batch = list(islice(generator, batch_size))
        if not batch:
            break
        model.objects.bulk_create(batch, batch_size=batch_size)
        total_created += len(batch)
    return total_created


class Command(BaseCommand):
    help = "Populate a testing event with users, copies, and submitted listings."

    def add_arguments(self, parser):
        parser.add_argument("--slug", default="test-mathtrade", help="Event slug.")
        parser.add_argument("--users", type=int, default=8, help="Number of trader users.")
        parser.add_argument("--games", type=int, default=30, help="Distinct games pool size.")
        parser.add_argument("--min-copies", type=int, default=5, help="Min copies per trader.")
        parser.add_argument("--max-copies", type=int, default=10, help="Max copies per trader.")
        parser.add_argument(
            "--status",
            default="WANTLIST_OPEN",
            choices=[s.value for s in TradeEvent.Status],
            help="Event status to set (default WANTLIST_OPEN so want-lists are buildable).",
        )
        parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducibility.")
        parser.add_argument("--wants-min", type=int, default=2, help="Min want targets per listing.")
        parser.add_argument("--wants-max", type=int, default=4, help="Max want targets per listing.")
        parser.add_argument(
            "--money-cap", type=float, default=50.0,
            help="Per-user money cap (enables money trading). 0 disables money.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete the existing event + seeded traders' copies and rebuild.",
        )

    @transaction.atomic
    def handle(self, *args, **opts):
        rng = random.Random(opts["seed"])
        slug = opts["slug"]
        n_users = opts["users"]
        n_games = opts["games"]
        lo, hi = opts["min_copies"], opts["max_copies"]
        if lo > hi:
            raise CommandError("--min-copies cannot exceed --max-copies")

        # --- game pool (top-ranked real games so names look sensible) ---
        pool = list(
            BoardGame.objects.filter(rank__isnull=False).order_by("rank")[:n_games]
        )
        if len(pool) < 2:
            raise CommandError(
                "Need at least 2 ranked games in the catalog. Run import_games first."
            )

        versions_by_game = {}
        for v in BoardGameVersion.objects.filter(board_game__in=pool).exclude(name="Unknown"):
            versions_by_game.setdefault(v.board_game_id, []).append(v)

        # --- users (organizer + traders) ------------------------------------
        hashed = make_password(PASSWORD)
        usernames = [ORGANIZER_USERNAME] + [
            f"{TRADER_PREFIX}{i:04d}" for i in range(1, n_users + 1) # Padded to 4 digits for large testcases
        ]
        found = {u.username: u for u in User.objects.filter(username__in=usernames)}

        if found:
            User.objects.filter(pk__in=[u.pk for u in found.values()]).update(password=hashed)
            for u in found.values():
                u.password = hashed
        for uname in usernames:
            if uname not in found:
                found[uname] = User.objects.create(
                    username=uname, email=f"{uname}@example.test", password=hashed
                )

        organizer = found[ORGANIZER_USERNAME]
        traders = [found[f"{TRADER_PREFIX}{i:04d}"] for i in range(1, n_users + 1)]

        # --- event ----------------------------------------------------------
        existing = TradeEvent.objects.filter(slug=slug).first()
        if existing:
            if not opts["reset"]:
                raise CommandError(f"Event '{slug}' already exists. Re-run with --reset to rebuild it.")
            existing.delete() 
            Copy.objects.filter(owner__in=traders).delete()

        money_cap = opts["money_cap"]
        money_enabled = money_cap > 0
        event = TradeEvent.objects.create(
            name="Test MathTrade 2026",
            slug=slug,
            description="Auto-seeded testing event with many users and copies.",
            organizer=organizer,
            status=opts["status"],
            money_enabled=money_enabled,
            max_money_per_user=(round(money_cap, 2) if money_enabled else None),
        )

        # --- participations + copies + submitted listings -------------------
        participations = []
        copies = []
        copy_counter = 1 

        for u in traders:
            region = rng.choice(["NA", "EU", "SA", "APAC"])
            max_spend = (round(rng.uniform(money_cap * 0.4, money_cap), 2) if money_enabled else 0)
            participations.append(EventParticipation(event=event, user=u, region=region, max_spend=max_spend))
            
            for _ in range(rng.randint(lo, hi)):
                game = rng.choice(pool)
                vers = versions_by_game.get(game.bgg_id)
                if vers:
                    ver = rng.choice(vers)
                    language = (ver.language or "").split("|")[0].strip() or rng.choice(LANGUAGES)
                    edition = ver.name
                else:
                    ver = None
                    language = rng.choice(LANGUAGES)
                    edition = ""
                copies.append(
                    Copy(
                        owner=u, board_game=game, version=ver,
                        condition=rng.choice([c.value for c in Copy.Condition]),
                        language=language, edition=edition, status=Copy.Status.ACTIVE,
                        listing_code=f"TEST-{copy_counter:06d}" 
                    )
                )
                copy_counter += 1

        EventParticipation.objects.bulk_create(participations, batch_size=BATCH)
        Copy.objects.bulk_create(copies, batch_size=BATCH)
        
        # Generator for EventListings
        chunked_bulk_insert(EventListing, (EventListing(event=event, copy=c, active=True) for c in copies))
        total_copies = len(copies)

        # Re-read listings
        saved = list(EventListing.objects.filter(event=event).select_related("copy"))
        listings_by_owner = {}
        games_by_owner = {}
        listings_by_game = {}
        all_games = set()
        
        for el in saved:
            listings_by_owner.setdefault(el.copy.owner_id, []).append(el)
            games_by_owner.setdefault(el.copy.owner_id, set()).add(el.copy.board_game_id)
            listings_by_game.setdefault(el.copy.board_game_id, []).append(el)
            all_games.add(el.copy.board_game_id)
        all_games_sorted = sorted(all_games)

        # --- want lists: one offer+want+wish trio per listing ---------------
        wmin, wmax = opts["wants_min"], opts["wants_max"]

        offer_groups = []          
        want_groups = []
        plan = []                  
        sell_updates = []          
        bid_candidates = []        
        n_money_offers = 0

        for u in traders:
            owned = games_by_owner.get(u.id, set())
            candidates = [g for g in all_games_sorted if g not in owned]
            if not candidates:
                continue
            for el in listings_by_owner.get(u.id, []):
                k = min(rng.randint(wmin, wmax), len(candidates))
                wanted_games = rng.sample(candidates, k)

                og = OfferGroup(event=event, user=u, name=el.copy.listing_code, max_give=1)
                
                if money_enabled and rng.random() < 0.4:
                    el.sell_price = round(rng.uniform(5, min(money_cap, 25)), 2)
                    sell_updates.append(el)
                    n_money_offers += 1

                wg = WantGroup(event=event, user=u, name=f"Wants for {el.copy.listing_code}", min_receive=1, duplicate_protection=True)
                
                for bgg_id in wanted_games:
                    if money_enabled and rng.random() < 0.3:
                        amount = round(rng.uniform(5, min(money_cap, 30)), 2)
                        bid_candidates.append((u.id, bgg_id, amount))

                offer_groups.append(og)
                want_groups.append(wg)
                plan.append((el, og, wg, wanted_games))

        OfferGroup.objects.bulk_create(offer_groups, batch_size=BATCH)
        WantGroup.objects.bulk_create(want_groups, batch_size=BATCH)

        # Use generators for the massive inserts
        def generate_offer_items():
            for el, og, wg, wanted_games in plan:
                yield OfferGroupItem(offer_group=og, event_listing=el)

        def generate_want_items():
            for el, og, wg, wanted_games in plan:
                for bgg_id in wanted_games:
                    for target in listings_by_game.get(bgg_id, []):
                        yield WantGroupItem(want_group=wg, event_listing=target)

        def generate_wishes():
            for el, og, wg, wanted_games in plan:
                yield TradeWish(event=event, user=og.user, offer_group=og, want_group=wg, active=True)

        chunked_bulk_insert(OfferGroupItem, generate_offer_items())
        total_wants_inserted = chunked_bulk_insert(WantGroupItem, generate_want_items())
        n_wishes = chunked_bulk_insert(TradeWish, generate_wishes())

        if sell_updates:
            EventListing.objects.bulk_update(sell_updates, ["sell_price"], batch_size=BATCH)

        def generate_want_bids():
            seen = set()
            for uid, bgg_id, amount in bid_candidates:
                key = (uid, bgg_id)
                if key in seen:
                    continue
                seen.add(key)
                for target in listings_by_game.get(bgg_id, []):
                    yield WantBid(user_id=uid, event=event, event_listing=target, amount=amount)

        n_money_wants = chunked_bulk_insert(WantBid, generate_want_bids())

        # --- report ---------------------------------------------------------
        distinct_games = len({c.board_game_id for c in copies})
        self.stdout.write(self.style.SUCCESS(f"Seeded event '{event.slug}' ({event.status})"))
        self.stdout.write(
            f"  organizer:   {organizer.username}  (password: {PASSWORD})\n"
            f"  traders:     {len(traders)}  ({TRADER_PREFIX}0001..{TRADER_PREFIX}{n_users:04d}, password: {PASSWORD})\n"
            f"  copies:      {total_copies} submitted listings\n"
            f"  game pool:   {len(pool)} games, {distinct_games} distinct games actually listed\n"
            f"  wishes:      {n_wishes} (one per listing)\n"
            f"  want items:  {total_wants_inserted} target mappings created\n"
            f"  money:       {'enabled, cap ' + str(round(money_cap, 2)) if money_enabled else 'disabled'}"
            f"{', ' + str(n_money_wants) + ' buy bids, ' + str(n_money_offers) + ' sell asks' if money_enabled else ''}\n"
            f"  frontend:    /events/{event.slug}\n"
        )