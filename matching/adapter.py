from django.utils import timezone
from events.models import EventEntry, EntryStatus


def build_input(event):
    entries = EventEntry.objects.filter(
        event=event, status=EntryStatus.ENTERED
    ).select_related('listing__owner', 'listing__game')

    items = []
    token_to_entry = {}
    for entry in entries:
        items.append({
            'token': entry.item_token,
            'owner': entry.listing.owner.username,
            'bgg_id': entry.listing.game.bgg_id,
            'name': entry.listing.game.name,
        })
        token_to_entry[entry.item_token] = entry

    from wishlists.models import TradeStatement
    statements_qs = TradeStatement.objects.filter(
        event=event
    ).prefetch_related('offer_entries__listing__owner', 'want_games')

    compiled_statements = []
    dsl_lines = []
    header_items = ' '.join(
        f"{it['token']}={it['owner']}/{it['name'].replace(' ', '_')}"
        for it in items
    )
    dsl_lines.append(f'# event: {event.slug}  | items: {header_items}')

    for stmt in statements_qs:
        offer_tokens = [e.item_token for e in stmt.offer_entries.all() if e.item_token]
        want_game_ids = {g.bgg_id for g in stmt.want_games.all()}

        filters = stmt.want_filters or {}
        min_cond = filters.get('min_condition')
        lang = filters.get('language')

        want_tokens = []
        for entry in entries:
            if entry.listing.game.bgg_id not in want_game_ids:
                continue
            if entry.listing.owner == stmt.owner:
                continue
            if min_cond and _condition_rank(entry.listing.condition) < _condition_rank(min_cond):
                continue
            if lang and entry.listing.language.upper() != lang.upper():
                continue
            if entry.item_token:
                want_tokens.append(entry.item_token)

        if not offer_tokens or not want_tokens:
            continue

        compiled_statements.append({
            'owner': stmt.owner.username,
            'offer': offer_tokens,
            'want': want_tokens,
            'give_at_most': stmt.give_at_most,
            'get_at_least': stmt.get_at_least,
        })

        offer_str = ' '.join(offer_tokens)
        want_str = ' '.join(want_tokens)
        mn = f' ({stmt.give_at_most}-to-{stmt.get_at_least})' \
            if stmt.give_at_most != 1 or stmt.get_at_least != 1 else ''
        dsl_lines.append(f'{offer_str} -> {want_str}{mn}')

    input_json = {
        'event': event.slug,
        'items': items,
        'statements': compiled_statements,
    }
    return input_json, '\n'.join(dsl_lines)


def _condition_rank(cond):
    order = {'NEW': 5, 'LIKE_NEW': 4, 'VERY_GOOD': 3, 'GOOD': 2, 'ACCEPTABLE': 1, 'FOR_PARTS': 0}
    return order.get(cond, 0)


class FakeMatcher:
    """Greedy mutual single-item matcher — satisfies mutual wants for testing."""

    def run(self, input_json):
        items = {it['token']: it for it in input_json['items']}
        statements = input_json['statements']

        # index: owner -> set of wanted tokens
        owner_wants = {}
        for stmt in statements:
            if stmt['give_at_most'] == 1 and stmt['get_at_least'] == 1:
                owner = stmt['owner']
                owner_wants.setdefault(owner, set()).update(stmt['want'])

        # build token -> owner map
        token_owner = {t: d['owner'] for t, d in items.items()}

        # build offer map: owner -> list of offered tokens
        owner_offers = {}
        for stmt in statements:
            if stmt['give_at_most'] == 1:
                owner = stmt['owner']
                owner_offers.setdefault(owner, []).extend(stmt['offer'])

        assignments = []
        assigned_tokens = set()
        satisfied_recipients = set()

        for stmt in statements:
            if stmt['give_at_most'] != 1 or stmt['get_at_least'] != 1:
                continue
            giver = stmt['owner']
            for offer_token in stmt['offer']:
                if offer_token in assigned_tokens:
                    continue
                for want_token in stmt['want']:
                    if want_token in assigned_tokens:
                        continue
                    want_owner = token_owner.get(want_token)
                    if not want_owner or want_owner == giver:
                        continue
                    # check mutual want
                    if offer_token in owner_wants.get(want_owner, set()):
                        assignments.append({'token': offer_token, 'to': want_owner})
                        assignments.append({'token': want_token, 'to': giver})
                        assigned_tokens.add(offer_token)
                        assigned_tokens.add(want_token)
                        break
                if offer_token in assigned_tokens:
                    break

        users = {a['to'] for a in assignments}
        users.update(token_owner[a['token']] for a in assignments)

        return {
            'event': input_json['event'],
            'assignments': assignments,
            'summary': {
                'items_traded': len(assignments),
                'users_trading': len(users),
            }
        }


def run_match(event):
    from matching.models import MatchResult, MatchResultStatus
    result = MatchResult.objects.filter(event=event).order_by('-started_at').first()
    if not result:
        input_json, input_text = build_input(event)
        result = MatchResult.objects.create(
            event=event,
            input_json=input_json,
            input_text=input_text,
            output_json={},
            status=MatchResultStatus.PENDING,
        )

    result.status = MatchResultStatus.RUNNING
    result.save()
    try:
        matcher = FakeMatcher()
        output = matcher.run(result.input_json)
        result.output_json = output
        result.status = MatchResultStatus.DONE
        result.items_traded = output['summary']['items_traded']
        result.users_trading = output['summary']['users_trading']
        result.finished_at = timezone.now()
        result.save()
        parse_output(result)
        event.status = 'MATCH_REVIEW'
        event.save()
    except Exception as e:
        result.status = MatchResultStatus.FAILED
        result.output_json = {'error': str(e)}
        result.finished_at = timezone.now()
        result.save()
    return result


def parse_output(match_result):
    from matching.models import Assignment
    from events.models import EventEntry
    from django.contrib.auth.models import User

    output = match_result.output_json
    event = match_result.event
    assignments_data = output.get('assignments', [])

    token_map = {
        e.item_token: e
        for e in EventEntry.objects.filter(event=event).select_related('listing__owner')
        if e.item_token
    }
    username_map = {u.username: u for u in User.objects.all()}

    Assignment.objects.filter(match_result=match_result).delete()
    for a in assignments_data:
        token = a['token']
        recipient_name = a['to']
        entry = token_map.get(token)
        recipient = username_map.get(recipient_name)
        if entry and recipient:
            Assignment.objects.get_or_create(
                match_result=match_result,
                entry=entry,
                defaults={'recipient': recipient},
            )
