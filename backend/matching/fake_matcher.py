"""
matching/fake_matcher.py

FakeMatcher — a greedy placeholder for the real external solver.

Given a TradeEvent, reads all active TradeWishes (with their offer groups'
listings and want groups' targets), forms valid 2-cycles and 3-cycles, respects
X/Y bounds and UserBlock, and emits the Result JSON per DATA_MODEL schema.

Algorithm:
  1. Load all active wishes with their offer and want data.
  2. Build a block set (pair of user IDs that must never share a cycle).
  3. For each wish, precompute which active EventListings satisfy its want group:
       - BOARD_GAME target: any ACTIVE listing of that game owned by someone else.
       - LISTING target: that specific listing (if active and not owned by wisher).
  4. Greedy 2-cycle pass: for each pair (wish_a, wish_b) where a's offered
     listings satisfy b's wants AND b's offered listings satisfy a's wants AND
     no block between a.user and b.user, form a cycle.
  5. Greedy 3-cycle pass on remaining unmatched wishes.
  6. X bound: a wish may contribute at most offer_group.max_give listings in
     total across all cycles. A wish is "matched" only when it has received
     at least want_group.min_receive items (Y bound).
  7. Write result JSON, summary, and create TradeAssignment rows.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from django.db import transaction

if TYPE_CHECKING:
    from matching.models import MatchRun

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------

class _WishNode:
    """In-memory representation of one active TradeWish for the matcher."""

    def __init__(self, wish):
        self.wish_id: int = wish.id
        self.user_id: int = wish.user_id
        self.username: str = wish.user.username
        self.max_give: int = wish.offer_group.max_give          # X
        self.min_receive: int = wish.want_group.min_receive     # Y

        # Listings this wish CAN offer (EventListing objects from OfferGroupItems)
        self.offered_listings: list = list(
            wish.offer_group.items.select_related(
                "event_listing__copy__board_game",
                "event_listing__copy__owner",
            ).all()
        )

        # Want targets (WantGroupItems)
        self.want_items: list = list(
            wish.want_group.items.select_related(
                "board_game",
                "event_listing__copy__board_game",
                "event_listing__copy__owner",
            ).all()
        )

        # Mutable tracking during matching
        self.given_count: int = 0       # listings already allocated to give
        self.received_count: int = 0    # listings already allocated to receive
        self.matched: bool = False      # True when received_count >= min_receive


# ---------------------------------------------------------------------------
# FakeMatcher
# ---------------------------------------------------------------------------

class FakeMatcher:
    """
    Greedy fake matcher that produces valid 2-cycles and 3-cycles.

    Usage:
        result = FakeMatcher(match_run).run()
        # match_run.result, match_run.summary, TradeAssignment rows populated.
    """

    def __init__(self, match_run: "MatchRun"):
        self.match_run = match_run
        self.event = match_run.event
        self._log_lines: list[str] = []

    # -----------------------------------------------------------------------
    # Public entry point
    # -----------------------------------------------------------------------

    @transaction.atomic
    def run(self) -> dict:
        self._log("FakeMatcher starting")

        # 1. Load wishes
        wishes = self._load_wishes()
        self._log(f"Loaded {len(wishes)} active wishes")

        # 2. Build block set
        block_set = self._load_blocks()
        self._log(f"Loaded {len(block_set)} blocked pairs")

        # 3. Build satisfiability index
        #    satisfy_map[wish_id] = set of EventListing ids that satisfy its wants
        active_listings = self._load_active_listings()
        satisfy_map = self._build_satisfy_map(wishes, active_listings)
        self._log("Satisfiability index built")

        # 4. Greedy 2-cycle pass
        cycles: list[dict] = []
        used_wish_ids: set[int] = set()
        cycle_id_counter = 1

        nodes = {w.wish_id: w for w in wishes}
        wish_list = list(wishes)

        self._log("Starting 2-cycle pass")
        for i, wa in enumerate(wish_list):
            if wa.wish_id in used_wish_ids:
                continue
            for j in range(i + 1, len(wish_list)):
                wb = wish_list[j]
                if wb.wish_id in used_wish_ids:
                    continue
                if self._blocked(wa.user_id, wb.user_id, block_set):
                    continue
                if wa.user_id == wb.user_id:
                    # Don't cycle with yourself
                    continue

                # Find a listing wa can give that wb wants
                a_gives = self._find_satisfying_listing(wa, wb, satisfy_map)
                if a_gives is None:
                    continue
                # Find a listing wb can give that wa wants
                b_gives = self._find_satisfying_listing(wb, wa, satisfy_map)
                if b_gives is None:
                    continue

                # Form 2-cycle: wa gives a_gives to wb; wb gives b_gives to wa
                cycle = self._make_cycle(
                    cycle_id=cycle_id_counter,
                    steps=[
                        (a_gives, wa, wb),
                        (b_gives, wb, wa),
                    ],
                    wish_map={wa.wish_id: wa, wb.wish_id: wb},
                )
                cycles.append(cycle)
                cycle_id_counter += 1

                wa.given_count += 1
                wb.given_count += 1
                wa.received_count += 1
                wb.received_count += 1

                # Mark matched if Y satisfied
                if wa.received_count >= wa.min_receive:
                    wa.matched = True
                if wb.received_count >= wb.min_receive:
                    wb.matched = True

                used_wish_ids.add(wa.wish_id)
                used_wish_ids.add(wb.wish_id)
                self._log(
                    f"  2-cycle {cycle_id_counter - 1}: "
                    f"wish {wa.wish_id}({wa.username}) ↔ wish {wb.wish_id}({wb.username})"
                )
                break  # wa matched; move to next wa

        # 5. Greedy 3-cycle pass on remaining
        self._log("Starting 3-cycle pass")
        remaining = [w for w in wish_list if w.wish_id not in used_wish_ids]
        for i, wa in enumerate(remaining):
            if wa.wish_id in used_wish_ids:
                continue
            for j in range(len(remaining)):
                wb = remaining[j]
                if wb.wish_id in used_wish_ids or wb.wish_id == wa.wish_id:
                    continue
                if self._blocked(wa.user_id, wb.user_id, block_set):
                    continue
                if wa.user_id == wb.user_id:
                    continue

                a_gives_b = self._find_satisfying_listing(wa, wb, satisfy_map)
                if a_gives_b is None:
                    continue

                for k in range(len(remaining)):
                    wc = remaining[k]
                    if wc.wish_id in used_wish_ids:
                        continue
                    if wc.wish_id in (wa.wish_id, wb.wish_id):
                        continue
                    if wc.user_id == wa.user_id or wc.user_id == wb.user_id:
                        continue
                    if self._blocked(wa.user_id, wc.user_id, block_set):
                        continue
                    if self._blocked(wb.user_id, wc.user_id, block_set):
                        continue

                    b_gives_c = self._find_satisfying_listing(wb, wc, satisfy_map)
                    if b_gives_c is None:
                        continue
                    c_gives_a = self._find_satisfying_listing(wc, wa, satisfy_map)
                    if c_gives_a is None:
                        continue

                    # Form 3-cycle: wa→wb, wb→wc, wc→wa
                    cycle = self._make_cycle(
                        cycle_id=cycle_id_counter,
                        steps=[
                            (a_gives_b, wa, wb),
                            (b_gives_c, wb, wc),
                            (c_gives_a, wc, wa),
                        ],
                        wish_map={
                            wa.wish_id: wa,
                            wb.wish_id: wb,
                            wc.wish_id: wc,
                        },
                    )
                    cycles.append(cycle)
                    cycle_id_counter += 1

                    wa.given_count += 1
                    wb.given_count += 1
                    wc.given_count += 1
                    wa.received_count += 1
                    wb.received_count += 1
                    wc.received_count += 1

                    if wa.received_count >= wa.min_receive:
                        wa.matched = True
                    if wb.received_count >= wb.min_receive:
                        wb.matched = True
                    if wc.received_count >= wc.min_receive:
                        wc.matched = True

                    used_wish_ids.add(wa.wish_id)
                    used_wish_ids.add(wb.wish_id)
                    used_wish_ids.add(wc.wish_id)
                    self._log(
                        f"  3-cycle {cycle_id_counter - 1}: "
                        f"wish {wa.wish_id}({wa.username}) → "
                        f"wish {wb.wish_id}({wb.username}) → "
                        f"wish {wc.wish_id}({wc.username})"
                    )
                    break  # wb found a c; stop inner loop
                if wa.wish_id in used_wish_ids:
                    break  # wa was placed; move to next wa

        # 6. Unmatched
        unmatched = []
        for w in wishes:
            if not w.matched:
                unmatched.append({
                    "wish_id": w.wish_id,
                    "reason": "no viable cycle",
                })

        # 7. Stats
        matched_users = set()
        matched_listings_count = 0
        for cycle in cycles:
            for step in cycle["steps"]:
                matched_users.add(step["from_user"])
                matched_users.add(step["to_user"])
                matched_listings_count += 1

        total_users = len({w.user_id for w in wishes})
        total_listings = len(active_listings)

        stats = {
            "users": total_users,
            "listings": total_listings,
            "matched": matched_listings_count,
            "cycles": len(cycles),
        }

        result = {
            "algorithm": "fake",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cycles": cycles,
            "unmatched": unmatched,
            "stats": stats,
        }

        summary = {
            "matched_wishes": sum(1 for w in wishes if w.matched),
            "cycles": len(cycles),
            "unmatched": len(unmatched),
        }

        self._log(
            f"Done: {len(cycles)} cycles, "
            f"{summary['matched_wishes']} matched wishes, "
            f"{len(unmatched)} unmatched"
        )

        # 8. Persist TradeAssignment rows
        self._create_assignments(cycles, nodes)

        return result, summary, "\n".join(self._log_lines)

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _log(self, msg: str):
        timestamped = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}"
        self._log_lines.append(timestamped)
        logger.debug(msg)

    def _load_wishes(self) -> list[_WishNode]:
        from trades.models import TradeWish
        wishes_qs = (
            TradeWish.objects
            .filter(event=self.event, active=True)
            .select_related(
                "user",
                "offer_group",
                "want_group",
            )
            .prefetch_related(
                "offer_group__items__event_listing__copy__board_game",
                "offer_group__items__event_listing__copy__owner",
                "want_group__items__board_game",
                "want_group__items__event_listing__copy__board_game",
                "want_group__items__event_listing__copy__owner",
            )
        )
        return [_WishNode(w) for w in wishes_qs]

    def _load_blocks(self) -> set[frozenset]:
        """Return a set of frozensets {user_id_a, user_id_b} for blocked pairs."""
        from accounts.models import UserBlock
        blocks = UserBlock.objects.filter()
        return {
            frozenset([b.blocker_id, b.blocked_id])
            for b in blocks
        }

    def _load_active_listings(self) -> list:
        """Return all active EventListings in this event."""
        from events.models import EventListing
        return list(
            EventListing.objects
            .filter(event=self.event, active=True)
            .select_related("copy__board_game", "copy__owner")
        )

    def _build_satisfy_map(self, wishes: list[_WishNode], active_listings: list) -> dict:
        """
        For each wish, compute the set of EventListing IDs that satisfy at least
        one of its want group items (owned by someone else).

        satisfy_map[wish_id] = set of EventListing ids
        """
        from trades.models import WantGroupItem

        # Index active listings by board_game id and by listing id
        by_game: dict[int, list] = {}
        by_listing: dict[int, object] = {}
        for el in active_listings:
            bgg_id = el.copy.board_game_id  # bgg_id is the PK
            by_game.setdefault(bgg_id, []).append(el)
            by_listing[el.id] = el

        satisfy_map: dict[int, set] = {}
        for w in wishes:
            matching_ids: set[int] = set()
            for item in w.want_items:
                if item.target_type == WantGroupItem.TargetType.BOARD_GAME:
                    # Any active listing of that game owned by someone else
                    for el in by_game.get(item.board_game_id, []):
                        if el.copy.owner_id != w.user_id:
                            matching_ids.add(el.id)
                elif item.target_type == WantGroupItem.TargetType.LISTING:
                    el_id = item.event_listing_id
                    el = by_listing.get(el_id)
                    if el and el.copy.owner_id != w.user_id:
                        matching_ids.add(el.id)
            satisfy_map[w.wish_id] = matching_ids

        return satisfy_map

    def _blocked(self, uid_a: int, uid_b: int, block_set: set[frozenset]) -> bool:
        return frozenset([uid_a, uid_b]) in block_set

    def _find_satisfying_listing(
        self,
        giver_wish: _WishNode,
        receiver_wish: _WishNode,
        satisfy_map: dict,
    ):
        """
        Find an EventListing that giver_wish can give (has it in offer group,
        hasn't exceeded max_give) AND that satisfies receiver_wish's wants.

        Returns the EventListing object or None.
        """
        if giver_wish.given_count >= giver_wish.max_give:
            return None

        receiver_wants = satisfy_map.get(receiver_wish.wish_id, set())

        # Track already-allocated listing ids to avoid double-allocating from this offer group
        # (We just check offered listings against receiver's want set)
        for item in giver_wish.offered_listings:
            el = item.event_listing
            if el.id in receiver_wants:
                return el

        return None

    def _make_cycle(self, cycle_id: int, steps: list, wish_map: dict) -> dict:
        """
        Build the cycle dict conforming to the result JSON schema.

        steps: list of (event_listing, giver_wish_node, receiver_wish_node)
        """
        step_dicts = []
        for el, giver_w, receiver_w in steps:
            step_dicts.append({
                "listing_code": el.copy.listing_code,
                "board_game": el.copy.board_game.name,
                "from_user": giver_w.username,
                "to_user": receiver_w.username,
                "wish_id": receiver_w.wish_id,  # the wish being satisfied (receiver's)
            })

        return {
            "id": cycle_id,
            "length": len(steps),
            "steps": step_dicts,
        }

    def _create_assignments(self, cycles: list[dict], nodes: dict):
        """Create normalized TradeAssignment rows from the cycle data."""
        from django.contrib.auth import get_user_model
        from events.models import EventListing
        from trades.models import TradeWish
        from matching.models import TradeAssignment

        User = get_user_model()

        # Build lookup caches
        user_cache: dict[str, object] = {}
        listing_cache: dict[str, object] = {}
        wish_cache: dict[int, object] = {}

        # Pre-fetch all relevant objects
        all_usernames = set()
        all_listing_codes = set()
        all_wish_ids = set()
        for cycle in cycles:
            for step in cycle["steps"]:
                all_usernames.add(step["from_user"])
                all_usernames.add(step["to_user"])
                all_listing_codes.add(step["listing_code"])
                all_wish_ids.add(step["wish_id"])

        for u in User.objects.filter(username__in=all_usernames):
            user_cache[u.username] = u

        for el in EventListing.objects.filter(
            event=self.event,
            copy__listing_code__in=all_listing_codes,
        ).select_related("copy"):
            listing_cache[el.copy.listing_code] = el

        for w in TradeWish.objects.filter(id__in=all_wish_ids):
            wish_cache[w.id] = w

        assignments = []
        for cycle in cycles:
            cycle_id = cycle["id"]
            for step in cycle["steps"]:
                el = listing_cache.get(step["listing_code"])
                giver = user_cache.get(step["from_user"])
                receiver = user_cache.get(step["to_user"])
                wish = wish_cache.get(step["wish_id"])

                if not (el and giver and receiver):
                    logger.warning(
                        "Could not resolve assignment for step %s in cycle %s",
                        step, cycle_id,
                    )
                    continue

                assignments.append(TradeAssignment(
                    match_run=self.match_run,
                    event_listing=el,
                    giver=giver,
                    receiver=receiver,
                    wish=wish,
                    cycle_id=cycle_id,
                ))

        TradeAssignment.objects.bulk_create(assignments)
        self._log(f"Created {len(assignments)} TradeAssignment rows")
