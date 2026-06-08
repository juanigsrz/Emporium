"""
matching/external_solver.py

Bridge to the external FastTradeMaximizer solver (both variants).

  build_wants(event) -> str
      Export the event's active wishes as a wants file in the format the event's
      matching_mode expects:
        ONETOONE -> OLWLG format for the hosted C++ `ftm` solver.
        XTOY     -> `(NforM) give -> take` format for the local gurobi solver.

  call_online_solver(wants_text) -> str
      POST a wants file to the hosted modal endpoint, return solver stdout.
      (ONETOONE / production only — see settings.MATCHING_USE_ONLINE_SOLVER.)

  load_solution(match_run, raw_output) -> (result, summary, log)
      Parse solver stdout into the standard result JSON and create the
      TradeAssignment rows on the MatchRun. Mirrors FakeMatcher.run()'s return.

The item token in every file AND in the parsed result is Copy.listing_code; it
round-trips unchanged through both solvers. giver/receiver are always derived
from listing ownership — never from usernames in the file (the C++ solver
upper-cases them).
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone

from django.db import transaction

from events.models import TradeEvent
from trades.models import WantGroupItem


# ---------------------------------------------------------------------------
# Shared loading / indexing
# ---------------------------------------------------------------------------

def _listing_index(event):
    """Active EventListings of the event, indexed by code / game / id."""
    from events.models import EventListing

    listings = list(
        EventListing.objects
        .filter(event=event, active=True)
        .select_related("copy__board_game", "copy__owner")
    )
    by_code, by_id = {}, {}
    by_game = defaultdict(list)
    for el in listings:
        by_code[el.copy.listing_code] = el
        by_id[el.id] = el
        by_game[el.copy.board_game_id].append(el)
    return listings, by_code, by_game, by_id


def _active_wishes(event):
    from trades.models import TradeWish

    return list(
        TradeWish.objects
        .filter(event=event, active=True)
        .select_related("user", "offer_group", "want_group")
        .prefetch_related(
            "offer_group__items__event_listing__copy",
            "want_group__items",
        )
    )


def _block_pairs():
    from accounts.models import UserBlock
    return [(b.blocker_id, b.blocked_id) for b in UserBlock.objects.all()]


def _blocked_with(user_id, block_pairs):
    out = set()
    for a, b in block_pairs:
        if a == user_id:
            out.add(b)
        elif b == user_id:
            out.add(a)
    return out


def _expand(want_items, user_id, by_game, by_id, blocked):
    """Canonical wants -> concrete listing_codes (others' active copies).

    Binary wants — no priority. Returns a deterministic, sorted list, excluding
    the wisher's own copies and any owned by a blocked user.
    """
    codes = set()
    for it in want_items:
        if it.target_type == WantGroupItem.TargetType.BOARD_GAME:
            for el in by_game.get(it.board_game_id, []):
                if el.copy.owner_id != user_id and el.copy.owner_id not in blocked:
                    codes.add(el.copy.listing_code)
        elif it.target_type == WantGroupItem.TargetType.LISTING:
            el = by_id.get(it.event_listing_id)
            if el and el.copy.owner_id != user_id and el.copy.owner_id not in blocked:
                codes.add(el.copy.listing_code)
    return sorted(codes)


# ---------------------------------------------------------------------------
# Export — build_wants
# ---------------------------------------------------------------------------

def build_wants(event) -> str:
    listings, by_code, by_game, by_id = _listing_index(event)
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    if event.matching_mode == TradeEvent.MatchingMode.XTOY:
        body = _build_xtoy(wishes, by_game, by_id, block_pairs)
    else:
        body = _build_onetoone(listings, wishes, by_game, by_id, block_pairs)

    header = _build_placeholder_header(event, wishes, by_id)
    return header + body if header else body


def _build_placeholder_header(event, wishes, by_id) -> str:
    """Money budgets / per-want bids / duplicate-protection as comment lines.

    Comment lines (`#! ...`) are ignored by both parse_ftm and parse_gurobi, so
    they round-trip harmlessly. This is a placeholder the MIP solver will consume
    later — see docs/SOLVER_INTEGRATION.md.
    """
    lines = []

    if event.money_enabled:
        cap = event.max_money_per_user
        lines.append(
            f"#! MONEY-ENABLED max_per_user={f'{cap:.2f}' if cap is not None else 'none'}"
        )
        for p in event.participations.select_related("user").all():
            if p.max_spend and p.max_spend > 0:
                lines.append(f"#! BUDGET ({p.user.username}) {p.max_spend}")

    for w in wishes:
        if w.want_group.duplicate_protection:
            lines.append(f"#! DUP-PROTECT ({w.user.username}) wish={w.id}")
        if not event.money_enabled:
            continue
        # Buy side (P): max the user pays to receive a wanted game.
        for it in w.want_group.items.all():
            if it.money_amount is None:
                continue
            if it.target_type == WantGroupItem.TargetType.BOARD_GAME:
                token = f"game={it.board_game_id}"
            else:
                el = by_id.get(it.event_listing_id)
                token = f"listing={el.copy.listing_code}" if el else f"listing_id={it.event_listing_id}"
            lines.append(f"#! MONEY-WANT ({w.user.username}) {token} max={it.money_amount}")
        # Sell side (Q): min the user accepts to give one of their listings.
        for ogi in w.offer_group.items.all():
            if ogi.money_amount is None:
                continue
            lines.append(
                f"#! MONEY-OFFER ({w.user.username}) "
                f"listing={ogi.event_listing.copy.listing_code} min={ogi.money_amount}"
            )

    return ("\n".join(lines) + "\n") if lines else ""


def _build_onetoone(listings, wishes, by_game, by_id, block_pairs) -> str:
    """OLWLG: one `(user) CODE : wishlist` line per active listing."""
    blocked_cache = {}
    wishlist_map = defaultdict(set)  # listing_id -> set(codes)
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id, _blocked_with(w.user_id, block_pairs)
        )
        exp = set(_expand(w.want_group.items.all(), w.user_id, by_game, by_id, blocked))
        for ogi in w.offer_group.items.all():
            el = ogi.event_listing
            if el.active:
                wishlist_map[el.id] |= exp

    lines = ["#! REQUIRE-COLONS REQUIRE-USERNAMES"]
    for el in listings:
        code = el.copy.listing_code
        user = el.copy.owner.username
        wl = [c for c in sorted(wishlist_map.get(el.id, ())) if c != code]
        suffix = (" " + " ".join(wl)) if wl else ""
        lines.append(f"({user}) {code} :{suffix}")
    return "\n".join(lines) + "\n"


def _build_xtoy(wishes, by_game, by_id, block_pairs) -> str:
    """gurobi: one `(NforM) give -> take` line per active wish."""
    blocked_cache = {}
    lines = []
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id, _blocked_with(w.user_id, block_pairs)
        )
        give = sorted(
            ogi.event_listing.copy.listing_code
            for ogi in w.offer_group.items.all()
            if ogi.event_listing.active
        )
        take = [c for c in _expand(w.want_group.items.all(), w.user_id, by_game, by_id, blocked)
                if c not in give]
        if not give or not take:
            continue
        n = w.offer_group.max_give
        m = w.want_group.min_receive
        lines.append(f"({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    return ("\n".join(lines) + "\n") if lines else ""


# ---------------------------------------------------------------------------
# Online solver call (ONETOONE / production)
# ---------------------------------------------------------------------------

def call_online_solver(wants_text: str) -> str:
    """POST the wants file to the hosted modal endpoint; return solver stdout."""
    import requests
    from django.conf import settings

    base = getattr(
        settings, "SOLVER_URL",
        "https://juanigsrz--fasttrademaximizer-web.modal.run",
    ).rstrip("/")
    timeout = getattr(settings, "SOLVER_TIMEOUT", 250)

    resp = requests.post(
        base + "/solve",
        data=wants_text.encode("utf-8"),
        headers={"Content-Type": "text/plain"},
        timeout=timeout,
    )
    if resp.status_code != 200:
        try:
            detail = str(resp.json())[:2000]
        except ValueError:
            detail = resp.text[:2000]
        raise RuntimeError(f"Solver returned HTTP {resp.status_code}: {detail}")
    return resp.json().get("output", "")


# ---------------------------------------------------------------------------
# Parsers — solver stdout -> edges (moved_code, receiver_anchor_code, group)
# ---------------------------------------------------------------------------

_FTM_LINE = re.compile(
    r"^\(([^)]*)\)\s+(\S+)\s+receives\s+\(([^)]*)\)\s+(\S+)\s*$"
)


def parse_ftm(output: str):
    """ftm OLWLG output -> edges. `(recv) RT receives (give) GT`:
    moved listing = GT (the given item), received by the owner of RT.
    Blank lines delimit trade loops -> one group index per loop.
    """
    edges = []
    lines = output.splitlines()
    i, n = 0, len(lines)
    while i < n and not lines[i].lstrip().startswith("TRADE LOOPS"):
        i += 1
    i += 1  # skip the header line itself
    group = -1
    in_block = False
    while i < n:
        line = lines[i].strip()
        i += 1
        if line.startswith("ITEM SUMMARY"):
            break
        if not line:
            in_block = False
            continue
        m = _FTM_LINE.match(line)
        if not m:
            continue
        if not in_block:
            group += 1
            in_block = True
        recv_tag, give_tag = m.group(2), m.group(4)
        edges.append((give_tag, recv_tag, group))
    return edges


def parse_gurobi(output: str):
    """gurobi output -> edges. `G... -> T...`: the wisher = owner(G[0]) receives
    each taken item T from owner(T). Group is None (recovered as components).
    """
    edges = []
    in_results = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Trade Results"):
            in_results = True
            continue
        if not in_results or "->" not in line:
            continue
        lhs, _, rhs = line.partition("->")
        gives, takes = lhs.split(), rhs.split()
        if not gives or not takes:
            continue
        anchor = gives[0]
        for t in takes:
            edges.append((t, anchor, None))
    return edges


def _assign_components(resolved):
    """Weakly-connected components over users joined by each move (XTOY)."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for _el, giver, receiver, _g in resolved:
        union(giver.id, receiver.id)

    roots = {}
    for row in resolved:
        r = find(row[1].id)
        roots.setdefault(r, len(roots))
        row[3] = roots[r]


# ---------------------------------------------------------------------------
# Load a parsed solution onto a MatchRun
# ---------------------------------------------------------------------------

@transaction.atomic
def load_solution(match_run, raw_output: str):
    """Parse solver stdout, build the result JSON + TradeAssignment rows.

    Returns (result, summary, log). Raises ValueError on an unresolvable token.
    """
    from matching.models import TradeAssignment

    event = match_run.event
    listings, by_code, by_game, by_id = _listing_index(event)

    if event.matching_mode == TradeEvent.MatchingMode.XTOY:
        parsed = parse_gurobi(raw_output)
    else:
        parsed = parse_ftm(raw_output)

    # Resolve tokens -> [moved_el, giver_user, receiver_user, group]
    resolved = []
    for moved_code, recv_code, group in parsed:
        moved_el = by_code.get(moved_code)
        if moved_el is None:
            raise ValueError(f"Unknown listing code in solution: {moved_code!r}")
        recv_el = by_code.get(recv_code)
        if recv_el is None:
            raise ValueError(f"Unknown listing code in solution: {recv_code!r}")
        resolved.append([moved_el, moved_el.copy.owner, recv_el.copy.owner, group])

    # XTOY came back without groups -> recover connected components.
    if resolved and resolved[0][3] is None:
        _assign_components(resolved)

    # Best-effort: which of the receiver's active wishes this move satisfies.
    wish_index = _build_wish_index(event, by_game, by_id)

    rows = []  # (moved_el, giver, receiver, cycle_id, wish_id)
    for moved_el, giver, receiver, group in resolved:
        wid = _match_wish(wish_index, receiver.id, moved_el.copy.listing_code)
        rows.append((moved_el, giver, receiver, (group or 0) + 1, wid))

    cycles = defaultdict(list)
    for moved_el, giver, receiver, cid, wid in rows:
        cycles[cid].append({
            "listing_code": moved_el.copy.listing_code,
            "board_game": moved_el.copy.board_game.name,
            "from_user": giver.username,
            "to_user": receiver.username,
            "wish_id": wid,
        })
    cycle_list = [
        {"id": cid, "length": len(steps), "steps": steps}
        for cid, steps in sorted(cycles.items())
    ]

    active_wishes = _active_wishes(event)
    received_user_ids = {r[2].id for r in rows}
    unmatched = [
        {"wish_id": w.id, "reason": "no items received"}
        for w in active_wishes if w.user_id not in received_user_ids
    ]
    matched_wish_ids = {s["wish_id"] for c in cycle_list for s in c["steps"] if s["wish_id"]}

    result = {
        "algorithm": match_run.algorithm,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cycles": cycle_list,
        "unmatched": unmatched,
        "stats": {
            "users": len({w.user_id for w in active_wishes}),
            "listings": len(listings),
            "matched": len(rows),
            "cycles": len(cycle_list),
        },
    }
    summary = {
        "matched_wishes": len(matched_wish_ids),
        "cycles": len(cycle_list),
        "unmatched": len(unmatched),
    }

    TradeAssignment.objects.bulk_create([
        TradeAssignment(
            match_run=match_run,
            event_listing=moved_el,
            giver=giver,
            receiver=receiver,
            wish_id=wid,
            cycle_id=cid,
        )
        for moved_el, giver, receiver, cid, wid in rows
    ])

    log = (
        f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] "
        f"loaded {len(rows)} moves in {len(cycle_list)} groups "
        f"({len(unmatched)} wishes unmatched)"
    )
    return result, summary, log


def _build_wish_index(event, by_game, by_id):
    """receiver_user_id -> [(expanded_codes:set, wish_id), ...]."""
    block_pairs = _block_pairs()
    idx = defaultdict(list)
    for w in _active_wishes(event):
        blocked = _blocked_with(w.user_id, block_pairs)
        codes = set(_expand(w.want_group.items.all(), w.user_id, by_game, by_id, blocked))
        idx[w.user_id].append((codes, w.id))
    return idx


def _match_wish(idx, receiver_id, moved_code):
    for codes, wid in idx.get(receiver_id, []):
        if moved_code in codes:
            return wid
    return None
