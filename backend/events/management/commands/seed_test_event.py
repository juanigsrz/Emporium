"""
seed_test_event — populate a testing event with many users, copies, and submitted listings.

Creates:
    - 1 organizer + N trader users (fixed usernames, idempotent via get_or_create)
    - a pool of distinct BoardGames (top-ranked) the copies spread over (so the
      same game is owned by several users → trades are actually possible)
    - K copies per trader (random game/condition/language)
    - an EventParticipation + active EventListing for every copy (= "submitted")

Usage:
    python manage.py seed_test_event
    python manage.py seed_test_event --users 12 --games 40 --reset
    python manage.py seed_test_event --slug demo-trade --status SUBMISSIONS_OPEN

Re-run with --reset to wipe the event (cascades listings/participations) and the
seeded traders' copies, then rebuild. Without --reset it refuses to clobber an
existing event.
"""

import random

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import BoardGame
from copies.models import Copy
from events.models import EventListing, EventParticipation, TradeEvent

User = get_user_model()

PASSWORD = "testpass123"
ORGANIZER_USERNAME = "mt_organizer"
TRADER_PREFIX = "trader"
LANGUAGES = ["English", "Spanish", "German", "French"]


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

        # --- organizer ---
        organizer, _ = User.objects.get_or_create(
            username=ORGANIZER_USERNAME,
            defaults={"email": f"{ORGANIZER_USERNAME}@example.test"},
        )
        organizer.set_password(PASSWORD)
        organizer.save(update_fields=["password"])

        # --- trader users ---
        traders = []
        for i in range(1, n_users + 1):
            uname = f"{TRADER_PREFIX}{i:02d}"
            u, _ = User.objects.get_or_create(
                username=uname, defaults={"email": f"{uname}@example.test"}
            )
            u.set_password(PASSWORD)
            u.save(update_fields=["password"])
            traders.append(u)

        # --- event ---
        existing = TradeEvent.objects.filter(slug=slug).first()
        if existing:
            if not opts["reset"]:
                raise CommandError(
                    f"Event '{slug}' already exists. Re-run with --reset to rebuild it."
                )
            # Cascade deletes listings + participations; also drop seeded traders' copies.
            existing.delete()
            Copy.objects.filter(owner__in=traders).delete()

        event = TradeEvent.objects.create(
            name="Test MathTrade 2026",
            slug=slug,
            description="Auto-seeded testing event with many users and copies.",
            organizer=organizer,
            status=opts["status"],
        )

        # --- copies + participations + submitted listings ---
        total_copies = 0
        listings = []
        for u in traders:
            EventParticipation.objects.get_or_create(
                event=event,
                user=u,
                defaults={"region": rng.choice(["NA", "EU", "SA", "APAC"])},
            )
            k = rng.randint(lo, hi)
            for _ in range(k):
                game = rng.choice(pool)
                copy = Copy.objects.create(
                    owner=u,
                    board_game=game,
                    condition=rng.choice([c.value for c in Copy.Condition]),
                    language=rng.choice(LANGUAGES),
                    status=Copy.Status.ACTIVE,
                )
                listings.append(EventListing(event=event, copy=copy, active=True))
                total_copies += 1

        EventListing.objects.bulk_create(listings)

        # --- report ---
        distinct_games = len({el.copy.board_game_id for el in listings})
        self.stdout.write(self.style.SUCCESS(f"Seeded event '{event.slug}' ({event.status})"))
        self.stdout.write(
            f"  organizer:   {organizer.username}  (password: {PASSWORD})\n"
            f"  traders:     {len(traders)}  ({TRADER_PREFIX}01..{TRADER_PREFIX}{n_users:02d}, password: {PASSWORD})\n"
            f"  copies:      {total_copies} submitted listings\n"
            f"  game pool:   {len(pool)} games, {distinct_games} distinct games actually listed\n"
            f"  frontend:    /events/{event.slug}\n"
        )
