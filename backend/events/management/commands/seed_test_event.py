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
    - a few Combos (base game + expansion bundles) each offered as base /
      expansion / bundle, with matching demand wishes (the combos feature)
    - 1-2 N-to-M wishes per trader (max_give 2-3 / min_receive 2-3)

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

import random

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import BoardGame, BoardGameVersion
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, EventParticipation, TradeEvent
from trades.models import (
    OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish, WantBid,
)

User = get_user_model()

PASSWORD = "testpass123"
ORGANIZER_USERNAME = "mt_organizer"
TRADER_PREFIX = "trader"
LANGUAGES = ["English", "Spanish", "German", "French"]
BATCH = 2000  # rows per bulk_create / bulk_update round-trip


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
        parser.add_argument(
            "--wants-min", type=int, default=2, help="Min want targets per listing."
        )
        parser.add_argument(
            "--wants-max", type=int, default=4, help="Max want targets per listing."
        )
        parser.add_argument(
            "--combos", type=int, default=3,
            help="Number of base+expansion combos to seed (0 disables).",
        )
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

        # Real editions for the pool games, grouped by game, so each copy can be
        # given an actual version (and inherit that edition's language). Games with
        # no imported versions fall back to a random language and no version.
        versions_by_game = {}
        for v in BoardGameVersion.objects.filter(board_game__in=pool).exclude(name="Unknown"):
            versions_by_game.setdefault(v.board_game_id, []).append(v)

        # --- users (organizer + traders) ------------------------------------
        # All test users share one password, so hash it a single time and reuse
        # the hash instead of running the KDF once per user.
        hashed = make_password(PASSWORD)
        usernames = [ORGANIZER_USERNAME] + [
            f"{TRADER_PREFIX}{i:02d}" for i in range(1, n_users + 1)
        ]
        found = {u.username: u for u in User.objects.filter(username__in=usernames)}

        if found:
            # Keep pre-existing users' password in sync (idempotent re-runs).
            User.objects.filter(pk__in=[u.pk for u in found.values()]).update(
                password=hashed
            )
            for u in found.values():
                u.password = hashed
        for uname in usernames:
            if uname not in found:
                found[uname] = User.objects.create(
                    username=uname, email=f"{uname}@example.test", password=hashed
                )

        organizer = found[ORGANIZER_USERNAME]
        traders = [found[f"{TRADER_PREFIX}{i:02d}"] for i in range(1, n_users + 1)]

        # --- event ----------------------------------------------------------
        existing = TradeEvent.objects.filter(slug=slug).first()
        if existing:
            if not opts["reset"]:
                raise CommandError(
                    f"Event '{slug}' already exists. Re-run with --reset to rebuild it."
                )
            existing.delete()  # cascades listings + participations
            # Delete by the seed's own marker, not the current trader list: a
            # prior run with more --users leaves orphan copies whose recycled
            # TEST- listing_codes collide on the next run.
            Copy.objects.filter(listing_code__startswith="TEST-").delete()

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
        copy_counter = 1 # Use a counter to ensure uniqueness

        for u in traders:
            region = rng.choice(["NA", "EU", "SA", "APAC"])
            max_spend = (
                round(rng.uniform(money_cap * 0.4, money_cap), 2)
                if money_enabled else 0
            )
            participations.append(
                EventParticipation(
                    event=event, user=u, region=region, max_spend=max_spend
                )
            )
            for _ in range(rng.randint(lo, hi)):
                game = rng.choice(pool)
                vers = versions_by_game.get(game.bgg_id)
                if vers:
                    ver = rng.choice(vers)
                    # version.language is pipe-joined when multiple; take the first.
                    language = (ver.language or "").split("|")[0].strip() or rng.choice(LANGUAGES)
                    edition = ver.name
                else:
                    ver = None
                    language = rng.choice(LANGUAGES)
                    edition = ""
                copies.append(
                    Copy(
                        owner=u,
                        board_game=game,
                        version=ver,
                        condition=rng.choice([c.value for c in Copy.Condition]),
                        language=language,
                        edition=edition,
                        status=Copy.Status.ACTIVE,
                        listing_code=f"TEST-{copy_counter:06d}" # <--- Manually inject a unique code
                    )
                )
                copy_counter += 1

        EventParticipation.objects.bulk_create(participations, batch_size=BATCH)
        Copy.objects.bulk_create(copies, batch_size=BATCH)
        EventListing.objects.bulk_create(
            [EventListing(event=event, copy=c, active=True) for c in copies],
            batch_size=BATCH,
        )
        total_copies = len(copies)

        # Re-read listings with their copy so listing_code etc. reflect the DB,
        # and group them for want-list building.
        saved = list(
            EventListing.objects.filter(event=event).select_related("copy")
        )
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

        offer_groups = []          # parallel to want_groups / plan
        want_groups = []
        plan = []                  # (event_listing, offer_group, want_group, wanted_listings)
        sell_updates = []          # listings that got a per-copy ask
        bid_candidates = []        # (user_id, event_listing_id, amount) in RNG order
        n_money_offers = 0

        for u in traders:
            # Games owned by OTHERS only (so a match is actually possible).
            owned = games_by_owner.get(u.id, set())
            candidates = [g for g in all_games_sorted if g not in owned]
            if not candidates:
                continue
            for el in listings_by_owner.get(u.id, []):
                k = min(rng.randint(wmin, wmax), len(candidates))
                wanted_games = rng.sample(candidates, k)
                # Post-refactor wants are listing-based: resolve each wanted game
                # to one specific listing (all owned by others, since candidates
                # excludes games this user owns).
                wanted_listings = [
                    rng.choice(listings_by_game[g]) for g in wanted_games
                ]

                og = OfferGroup(
                    event=event, user=u, name=el.copy.listing_code, max_give=1
                )
                # Sell side (Q): ~40% of listings get a per-copy ask override.
                if money_enabled and rng.random() < 0.4:
                    el.sell_price = round(rng.uniform(5, min(money_cap, 25)), 2)
                    sell_updates.append(el)
                    n_money_offers += 1

                wg = WantGroup(
                    event=event, user=u, name=f"Wants for {el.copy.listing_code}",
                    min_receive=1, duplicate_protection=True,
                )
                # Buy side (P): ~30% of wants get a per-target bid override.
                for target in wanted_listings:
                    if money_enabled and rng.random() < 0.3:
                        amount = round(rng.uniform(5, min(money_cap, 30)), 2)
                        bid_candidates.append((u.id, target.id, amount))

                offer_groups.append(og)
                want_groups.append(wg)
                plan.append((el, og, wg, wanted_listings))

        # Insert the groups first so their PKs are available for the children.
        OfferGroup.objects.bulk_create(offer_groups, batch_size=BATCH)
        WantGroup.objects.bulk_create(want_groups, batch_size=BATCH)

        offer_items = []
        want_items = []
        wishes = []
        for el, og, wg, wanted_listings in plan:
            offer_items.append(OfferGroupItem(offer_group=og, event_listing=el))
            for target in wanted_listings:
                want_items.append(
                    WantGroupItem(want_group_id=wg.id, event_listing_id=target.id)
                )
            wishes.append(
                TradeWish(
                    event=event, user=og.user,
                    offer_group=og, want_group=wg, active=True,
                )
            )

        OfferGroupItem.objects.bulk_create(offer_items, batch_size=BATCH)
        WantGroupItem.objects.bulk_create(want_items, batch_size=BATCH)
        TradeWish.objects.bulk_create(wishes, batch_size=BATCH)
        n_wishes = len(wishes)

        if sell_updates:
            EventListing.objects.bulk_update(
                sell_updates, ["sell_price"], batch_size=BATCH
            )

        # WantBid is keyed per (user, event, event_listing): keep the first draw
        # for each pair and drop later duplicates.
        seen = set()
        want_bids = []
        for uid, listing_id, amount in bid_candidates:
            key = (uid, listing_id)
            if key in seen:
                continue
            seen.add(key)
            want_bids.append(
                WantBid(
                    user_id=uid, event_id=event.id,
                    event_listing_id=listing_id, amount=amount,
                )
            )
        WantBid.objects.bulk_create(want_bids, batch_size=BATCH)
        n_money_wants = len(want_bids)

        # --- combos + N-to-M (advanced wishes) ------------------------------
        # All draws below happen AFTER the existing ones, so a given --seed still
        # reproduces the per-listing data unchanged; only the extra rows are new.
        pool_by_id = {g.bgg_id: g for g in pool}

        # Expansions aren't in the ranked pool, so pull a few popular ones here.
        n_combos = min(opts["combos"], len(traders))
        expansions = list(
            BoardGame.objects.filter(is_expansion=True).order_by("-users_rated")[:n_combos]
        )
        n_combos = min(n_combos, len(expansions))
        combo_owners = traders[:n_combos]

        # One expansion Copy + active listing per combo owner. TEST- listing_code
        # so --reset cleans them up alongside the main copies.
        exp_copies = [
            Copy(
                owner=owner, board_game=exp_game, version=None,
                condition=rng.choice([c.value for c in Copy.Condition]),
                language=rng.choice(LANGUAGES), edition="",
                status=Copy.Status.ACTIVE,
                listing_code=f"TEST-{copy_counter + i:06d}",
            )
            for i, (owner, exp_game) in enumerate(zip(combo_owners, expansions))
        ]
        copy_counter += len(exp_copies)
        Copy.objects.bulk_create(exp_copies, batch_size=BATCH)
        exp_listings = EventListing.objects.bulk_create(
            [EventListing(event=event, copy=c, active=True) for c in exp_copies],
            batch_size=BATCH,
        )

        # Accumulate advanced wishes, then insert with the same PK-after-insert
        # pattern used above. Specs are ("listing", EventListing) | ("combo", Combo).
        adv_offer_groups = []
        adv_want_groups = []
        adv_plan = []          # (offer_specs, want_specs, offer_group, want_group)
        combo_bid_specs = []   # (user, combo)

        def queue_wish(user, offer_specs, want_specs, max_give, min_receive, name):
            og = OfferGroup(event=event, user=user, name=name[:120], max_give=max_give)
            wg = WantGroup(
                event=event, user=user, name=f"Wants: {name}"[:120],
                min_receive=min_receive, duplicate_protection=False,
            )
            adv_offer_groups.append(og)
            adv_want_groups.append(wg)
            adv_plan.append((offer_specs, want_specs, og, wg))

        def others_listings(user_id):
            """Listings owned by everyone except user_id, keyed by game (for wants)."""
            owned = games_by_owner.get(user_id, set())
            return [g for g in all_games_sorted if g not in owned]

        combos = []   # (combo, owner)
        for owner, exp_game, el_exp in zip(combo_owners, expansions, exp_listings):
            owner_listings = listings_by_owner.get(owner.id)
            if not owner_listings:
                continue
            base = owner_listings[0]
            base_game = pool_by_id[base.copy.board_game_id]
            priced = money_enabled and rng.random() < 0.6
            combo = Combo.objects.create(
                event=event, owner=owner,
                name=f"{base_game.name} + {exp_game.name}",
                sell_price=(round(rng.uniform(money_cap * 0.5, money_cap), 2) if priced else None),
            )
            ComboItem.objects.create(combo=combo, event_listing=base)
            ComboItem.objects.create(combo=combo, event_listing=el_exp)
            combos.append((combo, owner))

            # Offer side: give the base alone, the expansion alone, OR the bundle.
            # max_give=1 + the per-member givecap keep a copy from leaving twice.
            cands = others_listings(owner.id)
            if cands:
                wants = [
                    rng.choice(listings_by_game[g])
                    for g in rng.sample(cands, min(2, len(cands)))
                ]
                queue_wish(
                    owner,
                    [("listing", base), ("listing", el_exp), ("combo", combo)],
                    [("listing", w) for w in wants],
                    max_give=1, min_receive=1,
                    name=f"Combo offer {combo.combo_code}",
                )

            # Demand side: a different trader offers one copy and wants the bundle.
            others = [t for t in traders if t.id != owner.id and listings_by_owner.get(t.id)]
            if others:
                wisher = rng.choice(others)
                give = rng.choice(listings_by_owner[wisher.id])
                queue_wish(
                    wisher, [("listing", give)], [("combo", combo)],
                    max_give=1, min_receive=1,
                    name=f"Want combo {combo.combo_code}",
                )
                if money_enabled and combo.sell_price is not None:
                    combo_bid_specs.append((wisher, combo))

        # N-to-M: 1-2 multi-give/multi-receive wishes per trader.
        n_ntom = 0
        for u in traders:
            owner_listings = listings_by_owner.get(u.id, [])
            cands = others_listings(u.id)
            if len(owner_listings) < 2 or len(cands) < 2:
                continue
            for _ in range(rng.randint(1, 2)):
                x = min(rng.randint(2, 3), len(owner_listings))
                y = min(rng.randint(2, 3), len(cands))
                if x < 2 or y < 2:
                    continue
                give_listings = rng.sample(owner_listings, x)
                want_games = rng.sample(cands, min(y + 1, len(cands)))
                want_listings = [rng.choice(listings_by_game[g]) for g in want_games]
                queue_wish(
                    u,
                    [("listing", el) for el in give_listings],
                    [("listing", w) for w in want_listings],
                    max_give=x, min_receive=y,
                    name=f"{u.username} {x}-to-{y}",
                )
                n_ntom += 1

        OfferGroup.objects.bulk_create(adv_offer_groups, batch_size=BATCH)
        WantGroup.objects.bulk_create(adv_want_groups, batch_size=BATCH)

        adv_offer_items, adv_want_items, adv_wishes = [], [], []
        for offer_specs, want_specs, og, wg in adv_plan:
            for kind, obj in offer_specs:
                adv_offer_items.append(
                    OfferGroupItem(offer_group_id=og.id, event_listing_id=obj.id)
                    if kind == "listing" else
                    OfferGroupItem(offer_group_id=og.id, combo_id=obj.id)
                )
            for kind, obj in want_specs:
                adv_want_items.append(
                    WantGroupItem(want_group_id=wg.id, event_listing_id=obj.id)
                    if kind == "listing" else
                    WantGroupItem(want_group_id=wg.id, combo_id=obj.id)
                )
            adv_wishes.append(
                TradeWish(
                    event=event, user_id=og.user_id,
                    offer_group_id=og.id, want_group_id=wg.id, active=True,
                )
            )
        OfferGroupItem.objects.bulk_create(adv_offer_items, batch_size=BATCH)
        WantGroupItem.objects.bulk_create(adv_want_items, batch_size=BATCH)
        TradeWish.objects.bulk_create(adv_wishes, batch_size=BATCH)
        n_wishes += len(adv_wishes)

        combo_bids = []
        for user, combo in combo_bid_specs:
            combo_bids.append(
                WantBid(
                    user_id=user.id, event_id=event.id, combo_id=combo.id,
                    amount=round(rng.uniform(money_cap * 0.5, money_cap), 2),
                )
            )
        WantBid.objects.bulk_create(combo_bids, batch_size=BATCH)

        # --- report ---------------------------------------------------------
        distinct_games = len({c.board_game_id for c in copies})
        self.stdout.write(self.style.SUCCESS(f"Seeded event '{event.slug}' ({event.status})"))
        self.stdout.write(
            f"  organizer:   {organizer.username}  (password: {PASSWORD})\n"
            f"  traders:     {len(traders)}  ({TRADER_PREFIX}01..{TRADER_PREFIX}{n_users:02d}, password: {PASSWORD})\n"
            f"  copies:      {total_copies} submitted listings\n"
            f"  game pool:   {len(pool)} games, {distinct_games} distinct games actually listed\n"
            f"  wishes:      {n_wishes} ({n_wishes - len(adv_wishes)} per-listing + {len(adv_wishes)} advanced)\n"
            f"  combos:      {len(combos)} base/expansion bundles (offered base/expansion/bundle)\n"
            f"  N-to-M:      {n_ntom} multi-give/multi-receive wishes\n"
            f"  money:       {'enabled, cap ' + str(round(money_cap, 2)) if money_enabled else 'disabled'}"
            f"{', ' + str(n_money_wants) + ' buy bids, ' + str(n_money_offers) + ' sell asks' if money_enabled else ''}\n"
            f"  frontend:    /events/{event.slug}\n"
        )