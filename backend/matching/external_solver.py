"""
matching/external_solver.py

Bridge to the external Pareto (gurobi) solver.

  build_wants(event) -> str
      Export the event's active wishes as a wants file in `(NforM) give -> take`
      format for the local gurobi solver.

  load_solution(match_run, raw_output) -> (result, summary, log)
      Parse solver stdout into the standard result JSON and create the
      TradeAssignment rows on the MatchRun. Mirrors FakeMatcher.run()'s return.

The item token in every file AND in the parsed result is Copy.listing_code; it
round-trips unchanged. giver/receiver are always derived from listing ownership
— never from usernames in the file.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction



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
    for el in listings:
        by_code[el.copy.listing_code] = el
        by_id[el.id] = el
    return listings, by_code, by_id


def _active_wishes(event):
    from trades.models import TradeWish

    return list(
        TradeWish.objects
        .filter(event=event, active=True)
        .select_related("user", "offer_group", "want_group")
        .prefetch_related(
            "offer_group__items__event_listing__copy",
            "offer_group__items__combo",
            "want_group__items",
            "want_group__items__event_listing__copy",
            "want_group__items__combo",
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


def _load_coords():
    """user_id -> (lat, lng, max_trade_distance_km) for users with a Profile."""
    from accounts.models import Profile
    return {
        p.user_id: (p.latitude, p.longitude, p.max_trade_distance_km)
        for p in Profile.objects.all()
    }


def _location_lines(listings, wishes) -> str:
    """`location <username> <lat> <lng>` for every user who owns an active
    listing or has an active wish AND has Profile coordinates. Sorted, '' if none.

    Covers both ends of every possible move (owner + receiver) so the solver's
    distance objective can price each shipment. Users without coordinates are
    skipped; the solver tolerates moves with a missing location on either end.
    """
    coords = _load_coords()  # user_id -> (lat, lng, max_km)
    names = {}               # user_id -> username
    for el in listings:
        names[el.copy.owner_id] = el.copy.owner.username
    for w in wishes:
        names[w.user_id] = w.user.username

    lines = []
    for uid, username in names.items():
        c = coords.get(uid)
        if not c:
            continue
        lat, lng, _max = c
        if lat is None or lng is None:
            continue
        lines.append(f"location {username} {lat} {lng}")
    return ("\n".join(sorted(lines)) + "\n") if lines else ""


def _distance_blocked(user_id, coords):
    """Owner ids too far from this wisher (per the wisher's max_trade_distance_km)."""
    from accounts.geo import haversine_km
    me = coords.get(user_id)
    if not me or me[2] is None:  # (lat, lng, max_km); no self-limit -> block nobody
        return set()
    lat, lng, max_km = me
    if lat is None or lng is None:
        return set()
    blocked = set()
    for other_id, (olat, olng, _omax) in coords.items():
        if other_id == user_id:
            continue
        if olat is None or olng is None:
            continue
        if haversine_km(lat, lng, olat, olng) > max_km:
            blocked.add(other_id)
    return blocked


def _combo_index(event):
    """Active Combos of the event, indexed by code / id, members prefetched."""
    from events.models import Combo

    combos = list(
        Combo.objects.filter(event=event, active=True)
        .select_related("owner")
        .prefetch_related("items__event_listing__copy")
    )
    by_code, by_id = {}, {}
    for c in combos:
        by_code[c.combo_code] = c
        by_id[c.id] = c
    return combos, by_code, by_id


def _expand(want_items, user_id, by_id, blocked, combo_by_id=None):
    """Canonical wants -> concrete tokens (others' active listings / combos).

    Binary wants — no priority. Returns a deterministic, sorted list, excluding
    the wisher's own items and any owned by a blocked user.
    """
    codes = set()
    for it in want_items:
        if getattr(it, "combo_id", None):
            c = (combo_by_id or {}).get(it.combo_id)
            if c and c.owner_id != user_id and c.owner_id not in blocked:
                codes.add(c.combo_code)
            continue
        el = by_id.get(it.event_listing_id)
        if el and el.copy.owner_id != user_id and el.copy.owner_id not in blocked:
            codes.add(el.copy.listing_code)
    return sorted(codes)


# ---------------------------------------------------------------------------
# Export — build_wants
# ---------------------------------------------------------------------------

def build_wants(event, include_locations: bool = False) -> str:
    listings, by_code, by_id = _listing_index(event)
    combos, _combo_by_code, combo_by_id = _combo_index(event)  # by_code used by load_solution
    block_pairs = _block_pairs()
    wishes = _active_wishes(event)

    money_block = (
        _build_xtoy_money_directives(
            event, listings, combos, wishes, by_id, combo_by_id, block_pairs)
        if event.money_enabled else ""
    )
    body = _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs)
    givecap_block = _build_givecaps(combos)
    caps_block = _build_user_caps(event, by_id, combo_by_id)
    location_block = _location_lines(listings, wishes) if include_locations else ""
    return money_block + body + givecap_block + caps_block + location_block


def _to_cents(amount) -> int:
    """Convert a Decimal money amount to integer cents."""
    return int((Decimal(str(amount)) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _build_xtoy_money_directives(event, listings, combos, wishes, by_id, combo_by_id, block_pairs) -> str:
    """Emit user/item/bid directives for main.py when money is enabled on an XTOY event.

    Returns a string block (ending with newline) or empty string if nothing to emit.
    Lines emitted (all amounts in integer cents):
      user <username> budget <cents>   — per participant with budget > 0
      item <code> owner <username>     — every active listing; + ask <cents> if sell price set
      bid <username> <code> <cents>    — per buy-side want item with a resolved bid price
    """
    from events.models import EventParticipation
    from trades.pricing import (
        load_bids, load_combo_bids, load_combo_members, load_game_prices,
        resolve_ask, resolve_ask_target, resolve_bid,
    )
    combo_bids = load_combo_bids(event)
    combo_members = load_combo_members(event)

    # Preload pricing rows once; resolve_ask/resolve_bid below run per item.
    bids = load_bids(event)
    game_prices = load_game_prices(event)

    lines = []

    # --- user budget lines ---
    default_cap = event.max_money_per_user
    participations = list(
        EventParticipation.objects.filter(event=event).select_related("user")
    )
    # Build a map username -> max_spend so we can fall back to event default
    part_by_user = {p.user.username: p for p in participations}

    # Collect all usernames that appear in wishes
    wish_usernames = {w.user.username for w in wishes}
    for username in sorted(wish_usernames):
        p = part_by_user.get(username)
        if p and p.max_spend and p.max_spend > 0:
            # Participation with null/zero max_spend is treated as unconstrained (no budget line).
            lines.append(f"user {username} budget {_to_cents(p.max_spend)}")
        elif not p and default_cap and default_cap > 0:
            lines.append(f"user {username} budget {_to_cents(default_cap)}")

    # --- item lines ---
    for el in sorted(listings, key=lambda e: e.copy.listing_code):
        code = el.copy.listing_code
        owner_username = el.copy.owner.username
        ask = resolve_ask(el, game_prices)
        if ask is not None:
            lines.append(f"item {code} owner {owner_username} ask {_to_cents(ask)}")
        else:
            lines.append(f"item {code} owner {owner_username}")

    # --- combo item lines ---
    for c in sorted(combos, key=lambda x: x.combo_code):
        owner_username = c.owner.username
        ask = resolve_ask_target(c)
        if ask is not None:
            lines.append(f"item {c.combo_code} owner {owner_username} ask {_to_cents(ask)}")
        else:
            lines.append(f"item {c.combo_code} owner {owner_username}")

    # --- bid lines ---
    # De-duplicate: (username, code) -> max bid in cents
    bid_map = {}
    blocked_cache = {}
    coords = _load_coords()
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        username = w.user.username
        give_codes = set()
        for ogi in w.offer_group.items.all():
            if ogi.combo_id:
                c = combo_by_id.get(ogi.combo_id)
                if c:
                    give_codes.add(c.combo_code)
            elif ogi.event_listing and ogi.event_listing.active:
                give_codes.add(ogi.event_listing.copy.listing_code)
        for it in w.want_group.items.all():
            bid = resolve_bid(w.user, event, it, bids, game_prices, combo_bids, combo_members)
            if bid is None:
                continue
            bid_cents = _to_cents(bid)
            codes = _expand([it], w.user_id, by_id, blocked, combo_by_id)
            codes = [c for c in codes if c not in give_codes]
            for code in codes:
                key = (username, code)
                if key not in bid_map or bid_cents > bid_map[key]:
                    bid_map[key] = bid_cents

    for (username, code) in sorted(bid_map):
        lines.append(f"bid {username} {code} {bid_map[(username, code)]}")

    return ("\n".join(lines) + "\n") if lines else ""


def _build_xtoy(wishes, by_id, by_code, combo_by_id, block_pairs) -> str:
    """gurobi: one `username : (NforM) give -> take` line per active wish.

    Give/take tokens are listing_codes or combo_codes. A duplicate-protected
    wish contributes `dupcap` over its multi-copy *listing* takes (combos are
    not game-grouped — see the combos spec, out-of-scope note).
    """
    blocked_cache = {}
    coords = _load_coords()
    lines = []
    dup_groups = {}  # (username, board_game_id) -> set of copy codes
    for w in wishes:
        blocked = blocked_cache.setdefault(
            w.user_id,
            _blocked_with(w.user_id, block_pairs) | _distance_blocked(w.user_id, coords),
        )
        give = set()
        for ogi in w.offer_group.items.all():
            if ogi.combo_id:
                combo = combo_by_id.get(ogi.combo_id)
                if combo:
                    give.add(combo.combo_code)
            elif ogi.event_listing and ogi.event_listing.active:
                give.add(ogi.event_listing.copy.listing_code)
        give = sorted(give)
        take = [c for c in _expand(w.want_group.items.all(), w.user_id, by_id,
                                   blocked, combo_by_id)
                if c not in give]
        if not give or not take:
            continue
        n = w.offer_group.max_give
        m = w.want_group.min_receive
        if w.want_group.duplicate_protection:
            for code in take:
                el = by_code.get(code)
                if el is None:   # combo token: not game-grouped
                    continue
                key = (w.user.username, el.copy.board_game_id)
                dup_groups.setdefault(key, set()).add(code)
        lines.append(f"{w.user.username} : ({n}for{m}) {' '.join(give)} -> {' '.join(take)}")
    for (username, _bg_id), codes in sorted(dup_groups.items()):
        if len(codes) >= 2:
            lines.append(f"dupcap {username} {' '.join(sorted(codes))}")
    return ("\n".join(lines) + "\n") if lines else ""


def _build_user_caps(event, by_id, combo_by_id) -> str:
    """User-defined caps: one `takecap`/`givecap <user> <n> <tokens>` line per
    active TradeCap. Tokens resolve to active listing/combo codes; items whose
    listing/combo is inactive are skipped, and a cap with no live tokens is
    dropped. Additive to the auto dupcap/combo-givecap lines."""
    from trades.models import TradeCap

    caps = (
        TradeCap.objects.filter(event=event)
        .select_related("user")
        .prefetch_related("items")   # only the FK ids are read; codes come from by_id/combo_by_id
        .order_by("id")
    )
    decls = []          # `item <token> owner <user>` declarations for GIVE tokens
    decl_seen = set()
    lines = []
    for cap in caps:
        username = cap.user.username
        tokens = []
        for it in cap.items.all():
            if it.event_listing_id:
                el = by_id.get(it.event_listing_id)
                if el:
                    tokens.append(el.copy.listing_code)
            elif it.combo_id:
                c = combo_by_id.get(it.combo_id)
                if c:
                    tokens.append(c.combo_code)
        if not tokens:
            continue
        if cap.kind == TradeCap.Kind.GIVE:
            # Declare each token's owner so the solver's givecap ownership check
            # never hits an undeclared (None-owner) item and raises. The user owns
            # all GIVE-cap items (serializer-validated); a redundant declaration is
            # harmless (same-owner set_owner; no ask = no money).
            for tok in tokens:
                if tok not in decl_seen:
                    decl_seen.add(tok)
                    decls.append(f"item {tok} owner {username}")
            lines.append(f"givecap {username} {cap.n} {' '.join(sorted(tokens))}")
        else:
            lines.append(f"takecap {username} {cap.n} {' '.join(sorted(tokens))}")
    out = decls + lines
    return ("\n".join(out) + "\n") if out else ""


def _build_givecaps(combos) -> str:
    """One `givecap <owner> 1 <member_code> <combo_code>` per combo member, so a
    physical copy leaves at most once — standalone or inside the combo."""
    lines = []
    for c in combos:
        owner = c.owner.username
        for ci in c.items.all():
            member_code = ci.event_listing.copy.listing_code
            lines.append(f"givecap {owner} 1 {member_code} {c.combo_code}")
    return ("\n".join(sorted(lines)) + "\n") if lines else ""


# ---------------------------------------------------------------------------
# Parsers — solver stdout -> edges (moved_code, receiver_anchor_code, group)
# ---------------------------------------------------------------------------

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
        # Cash lines also contain '->' — end the swap section so they aren't
        # mis-parsed as barter edges (see parse_gurobi_cash).
        if line.startswith("Cash Purchases") or line.startswith("Cash Summary"):
            in_results = False
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


_CASH_LINE = re.compile(r"^(\S+):\s+\S+\s+->\s+(\S+)\s+\(\S+ pays \S+ \$(\d+)")


def parse_gurobi_cash(output: str):
    """gurobi `Cash Purchases:` section -> [(moved_code, buyer_username, amount_cents), ...].

    Line form: `CODE: seller -> buyer  (buyer pays seller $N)`. The seller is the
    owner of CODE (resolved downstream); the buyer is named only here, so it must
    be carried out as a username (no listing code identifies the receiver).
    Amount is in integer cents as emitted by the solver.
    """
    moves = []
    in_cash = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Cash Purchases"):
            in_cash = True
            continue
        if line.startswith("Cash Summary"):
            break
        if not in_cash or not line:
            continue
        m = _CASH_LINE.match(line)
        if m:
            moves.append((m.group(1), m.group(2), int(m.group(3))))
    return moves


_CASH_SUMMARY_LINE = re.compile(
    r"^(\S+):\s+spent\s+\$-?\d+,\s+earned\s+\$-?\d+,\s+net\s+\$(-?\d+)\b"
)


def parse_gurobi_cash_summary(output: str):
    """gurobi `Cash Summary:` section -> {username: net_cents}.

    Line form: `  <user>: spent $A, earned $B, net $N ...` with amounts in integer
    cents (net may be negative). The trailing `(direction)`/`(cap ...)` are ignored.
    Used only to cross-check the per-item money reconstruction in load_solution.
    """
    nets = {}
    in_summary = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Cash Summary"):
            in_summary = True
            continue
        if line.startswith("Payments") or line.startswith("Settlement plan"):
            break
        if not in_summary or not line:
            continue
        m = _CASH_SUMMARY_LINE.match(line)
        if m:
            nets[m.group(1)] = int(m.group(2))
    return nets


_SETTLEMENT_LINE = re.compile(r"^(\S+)\s+pays\s+(\S+)\s+\$(\d+)$")


def parse_gurobi_settlement(output: str):
    """gurobi `Settlement plan:` section -> [(from_user, to_user, amount_cents), ...].

    Line form: `  <from> pays <to> $<cents>`. The minimal-transfer settlement; the
    section runs to end of output. Amounts are integer cents.
    """
    transfers = []
    in_plan = False
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Settlement plan"):
            in_plan = True
            continue
        if not in_plan or not line:
            continue
        m = _SETTLEMENT_LINE.match(line)
        if m:
            transfers.append((m.group(1), m.group(2), int(m.group(3))))
    return transfers


def _assign_components_v2(resolved):
    """Weakly-connected components for rows [kind, target, giver, receiver, group]."""
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

    for _kind, _target, giver, receiver, _g in resolved:
        union(giver.id, receiver.id)

    roots = {}
    for row in resolved:
        r = find(row[2].id)
        roots.setdefault(r, len(roots))
        row[4] = roots[r]


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
    listings, by_code, by_id = _listing_index(event)
    _combos, combo_by_code, combo_by_id = _combo_index(event)

    parsed = parse_gurobi(raw_output)

    def _resolve_token(code):
        """Return (target, owner) where target is an EventListing or Combo."""
        el = by_code.get(code)
        if el is not None:
            return ("listing", el, el.copy.owner)
        combo = combo_by_code.get(code)
        if combo is not None:
            return ("combo", combo, combo.owner)
        raise ValueError(f"Unknown token in solution: {code!r}")

    resolved = []  # [kind, target, giver, receiver, group]
    for moved_code, recv_code, group in parsed:
        moved_kind, moved_target, moved_owner = _resolve_token(moved_code)
        _recv_kind, _recv_target, recv_owner = _resolve_token(recv_code)
        resolved.append([moved_kind, moved_target, moved_owner, recv_owner, group])

    # Cash purchases (money mode): the buyer (receiver) is named only by
    # username in the `Cash Purchases:` section, so it can't be resolved via a
    # listing-code anchor like a swap. Resolve the buyer directly.
    cash_by_listing = {}  # event_listing.id -> Decimal dollars
    cash_by_combo = {}    # combo.id -> Decimal dollars
    cash_moves = parse_gurobi_cash(raw_output)
    if cash_moves:
        from django.contrib.auth import get_user_model

        names = {bn for _, bn, _ in cash_moves}
        users_by_name = {
            u.username: u
            for u in get_user_model().objects.filter(username__in=names)
        }
        for moved_code, buyer_username, amount_cents in cash_moves:
            moved_kind, moved_target, moved_owner = _resolve_token(moved_code)
            buyer = users_by_name.get(buyer_username)
            if buyer is None:
                raise ValueError(f"Unknown buyer in cash purchase: {buyer_username!r}")
            cash_amt = Decimal(amount_cents) / 100
            if moved_kind == "listing":
                cash_by_listing[moved_target.id] = cash_amt
            else:
                cash_by_combo[moved_target.id] = cash_amt
            resolved.append([moved_kind, moved_target, moved_owner, buyer, None])

    # XTOY came back without groups -> recover connected components by user.
    if resolved and resolved[0][4] is None:
        _assign_components_v2(resolved)

    # Best-effort: which of the receiver's active wishes this move satisfies.
    wish_index = _build_wish_index(event, by_id, combo_by_id)

    from trades.pricing import resolve_ask_target

    rows = []  # (kind, target, giver, receiver, cycle_id, wish_id, cash_amount, item_value)
    for kind, target, giver, receiver, group in resolved:
        if kind == "listing":
            token = target.copy.listing_code
            amt = cash_by_listing.get(target.id)
        else:
            token = target.combo_code
            amt = cash_by_combo.get(target.id)
        wid = _match_wish(wish_index, receiver.id, token)
        val = amt if amt is not None else resolve_ask_target(target)
        rows.append((kind, target, giver, receiver, (group or 0) + 1, wid, amt, val))

    cycles = defaultdict(list)
    for kind, target, giver, receiver, cid, wid, amt, val in rows:
        if kind == "listing":
            step = {
                "listing_code": target.copy.listing_code,
                "board_game": target.copy.board_game.name,
                "combo_code": None,
            }
        else:
            members = list(target.items.all())
            step = {
                "listing_code": None,
                "board_game": ", ".join(
                    ci.event_listing.copy.board_game.name for ci in members
                ),
                "combo_code": target.combo_code,
                "combo_name": target.name,
                "members": [ci.event_listing.copy.listing_code for ci in members],
            }
        step.update({
            "from_user": giver.username,
            "to_user": receiver.username,
            "wish_id": wid,
            "cash_amount": str(amt) if amt is not None else None,
        })
        cycles[cid].append(step)
    cycle_list = [
        {"id": cid, "length": len(steps), "steps": steps}
        for cid, steps in sorted(cycles.items())
    ]

    # Money cross-check + settlement plan (money mode only). Reconstruct each
    # user's net from the CASH legs only (paid by buyer, received by seller) and
    # require it to equal the solver's Cash Summary net; a mismatch means stale
    # prices or a parse error, so fail loudly rather than ship wrong money.
    # Barter swaps move no money even when the item carries an ask, so they must
    # not enter the net -- mirrors the solver's cash-only budget accounting.
    settlement = []
    summary_net = parse_gurobi_cash_summary(raw_output)
    if summary_net:
        recon = defaultdict(int)  # username -> net cents (spent - earned)
        for kind, target, giver, receiver, cid, wid, amt, val in rows:
            if amt is not None:
                cents = _to_cents(amt)
                recon[receiver.username] += cents
                recon[giver.username] -= cents
        for username, net_cents in summary_net.items():
            if recon.get(username, 0) != net_cents:
                raise ValueError(
                    f"Money reconstruction mismatch for {username!r}: "
                    f"reconstructed {recon.get(username, 0)}c != solver {net_cents}c"
                )
    for from_u, to_u, cents in parse_gurobi_settlement(raw_output):
        settlement.append({
            "from_user": from_u,
            "to_user": to_u,
            "amount": str((Decimal(cents) / 100).quantize(Decimal("0.01"))),
        })

    active_wishes = _active_wishes(event)
    received_user_ids = {r[3].id for r in rows}
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
        "settlement": settlement,
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
            event_listing=(target if kind == "listing" else None),
            combo=(target if kind == "combo" else None),
            giver=giver,
            receiver=receiver,
            wish_id=wid,
            cycle_id=cid,
            cash_amount=amt,
            item_value=val,
        )
        for kind, target, giver, receiver, cid, wid, amt, val in rows
    ])

    log = (
        f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] "
        f"loaded {len(rows)} moves in {len(cycle_list)} groups "
        f"({len(unmatched)} wishes unmatched)"
    )
    return result, summary, log


def _build_wish_index(event, by_id, combo_by_id=None):
    """receiver_user_id -> [(expanded_codes:set, wish_id), ...]."""
    block_pairs = _block_pairs()
    idx = defaultdict(list)
    for w in _active_wishes(event):
        blocked = _blocked_with(w.user_id, block_pairs)
        codes = set(_expand(w.want_group.items.all(), w.user_id, by_id, blocked, combo_by_id))
        idx[w.user_id].append((codes, w.id))
    return idx


def _match_wish(idx, receiver_id, moved_code):
    for codes, wid in idx.get(receiver_id, []):
        if moved_code in codes:
            return wid
    return None
