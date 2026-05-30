import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone as dt_timezone
from django.conf import settings
from django.utils import timezone
import requests

BASE_URL = getattr(settings, 'BGG_BASE_URL', 'https://boardgamegeek.com/xmlapi2')
_last_request_time = 0
_min_interval = 60.0 / getattr(settings, 'BGG_REQUESTS_PER_MINUTE', 30)


def _get(path, params=None, retries=5):
    global _last_request_time
    url = f'{BASE_URL}{path}'
    for attempt in range(retries):
        elapsed = time.time() - _last_request_time
        if elapsed < _min_interval:
            time.sleep(_min_interval - elapsed)
        try:
            resp = requests.get(url, params=params, timeout=15)
            _last_request_time = time.time()
        except requests.RequestException:
            time.sleep(2 ** attempt)
            continue
        if resp.status_code == 429:
            time.sleep(2 ** (attempt + 1))
            continue
        if resp.status_code == 202:
            time.sleep(2 ** attempt + 1)
            continue
        if resp.status_code == 401:
            # BGG XML API now requires OAuth — caller must handle None.
            return None
        if resp.status_code == 200:
            return resp.text
        return None
    return None


def search_games(query):
    xml = _get('/search', {'query': query, 'type': 'boardgame'})
    if not xml:
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    results = []
    for item in root.findall('item'):
        bgg_id = int(item.get('id', 0))
        if not bgg_id:
            continue
        name_el = item.find('name')
        name = name_el.get('value', '') if name_el is not None else ''
        year_el = item.find('yearpublished')
        year = int(year_el.get('value', 0)) if year_el is not None else None
        results.append({'bgg_id': bgg_id, 'name': name, 'year_published': year})
    return results


# Sentinel: stubs are seeded with this timestamp so needs_sync() returns True
# on next access, triggering a full /thing fetch at that point.
_STUB_EPOCH = datetime(2000, 1, 1, tzinfo=dt_timezone.utc)


def bulk_create_stubs(results):
    """Create minimal Game rows (id + name + year only) for unknown games.

    Never downgrades a fully-synced game. Safe to call repeatedly.
    """
    from .models import Game

    if not results:
        return

    existing_ids = set(
        Game.objects.filter(
            bgg_id__in=[r['bgg_id'] for r in results]
        ).values_list('bgg_id', flat=True)
    )

    new_stubs = [
        Game(
            bgg_id=r['bgg_id'],
            name=r['name'] or f'BGG #{r["bgg_id"]}',
            year_published=r.get('year_published'),
            thumbnail_url=r.get('thumbnail_url', ''),
            last_synced_at=_STUB_EPOCH,
        )
        for r in results
        if r['bgg_id'] not in existing_ids and r.get('name')
    ]
    if new_stubs:
        Game.objects.bulk_create(new_stubs, ignore_conflicts=True)


def fetch_hot_games():
    """Fetch BGG's /hot list — one request, ~50 games, lightweight."""
    xml = _get('/hot', {'type': 'boardgame'})
    if not xml:
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    results = []
    for item in root.findall('item'):
        bgg_id = int(item.get('id', 0))
        if not bgg_id:
            continue
        name_el = item.find('name')
        name = name_el.get('value', '') if name_el is not None else ''
        year_el = item.find('yearpublished')
        year = None
        if year_el is not None:
            try:
                year = int(year_el.get('value', 0))
            except (ValueError, TypeError):
                pass
        thumbnail_el = item.find('thumbnail')
        thumbnail = thumbnail_el.get('value', '') if thumbnail_el is not None else ''
        results.append({
            'bgg_id': bgg_id,
            'name': name,
            'year_published': year,
            'thumbnail_url': thumbnail,
        })
    return results


def _text(el, path, default=''):
    node = el.find(path)
    if node is None:
        return default
    return node.get('value', node.text or default)


def _int(el, path, default=None):
    v = _text(el, path, None)
    if v is None:
        return default
    try:
        return int(v)
    except (ValueError, TypeError):
        return default


def _float(el, path, default=None):
    v = _text(el, path, None)
    if v is None:
        return default
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def fetch_game_detail(bgg_id):
    xml = _get('/thing', {'id': bgg_id, 'type': 'boardgame', 'stats': 1})
    if not xml:
        return None
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    item = root.find('item')
    if item is None:
        return None

    primary_name = ''
    alt_names = []
    for name_el in item.findall('name'):
        val = name_el.get('value', '')
        if name_el.get('type') == 'primary':
            primary_name = val
        else:
            alt_names.append(val)

    stats = item.find('.//ratings')
    avg_rating = None
    if stats is not None:
        avg_el = stats.find('average')
        if avg_el is not None:
            try:
                avg_rating = float(avg_el.get('value', 0))
            except (ValueError, TypeError):
                pass

    weight_el = item.find('.//averageweight')
    weight = None
    if weight_el is not None:
        try:
            weight = float(weight_el.get('value', 0))
        except (ValueError, TypeError):
            pass

    desc_el = item.find('description')
    description = desc_el.text if desc_el is not None else ''

    return {
        'bgg_id': int(item.get('id')),
        'name': primary_name,
        'year_published': _int(item, 'yearpublished'),
        'thumbnail_url': _text(item, 'thumbnail'),
        'image_url': _text(item, 'image'),
        'min_players': _int(item, 'minplayers'),
        'max_players': _int(item, 'maxplayers'),
        'playing_time': _int(item, 'playingtime'),
        'weight': weight,
        'avg_rating': avg_rating,
        'description': description or '',
        'alternate_names': alt_names,
    }


def get_or_sync_game(bgg_id, force=False):
    from .models import Game, GameAlternateName
    ttl = getattr(settings, 'BGG_SYNC_TTL_DAYS', 7)
    try:
        game = Game.objects.get(bgg_id=bgg_id)
        if not force and not game.needs_sync(ttl):
            return game
    except Game.DoesNotExist:
        game = None

    data = fetch_game_detail(bgg_id)
    if not data:
        return game

    alt_names = data.pop('alternate_names', [])
    data['last_synced_at'] = timezone.now()

    if game:
        for k, v in data.items():
            setattr(game, k, v)
        game.save()
    else:
        game = Game.objects.create(**data)

    if alt_names:
        GameAlternateName.objects.filter(game=game).delete()
        GameAlternateName.objects.bulk_create(
            [GameAlternateName(game=game, name=n) for n in alt_names]
        )
    return game


def get_user(username):
    xml = _get('/user', {'name': username})
    if not xml:
        return None
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    if root.tag != 'user' or not root.get('id'):
        return None
    return {
        'bgg_id': root.get('id'),
        'username': root.get('name'),
        'firstname': _text(root, 'firstname'),
        'lastname': _text(root, 'lastname'),
    }


def import_collection(user, bgg_username):
    from .models import Game, GameAlternateName
    from inventory.models import Listing

    xml = None
    for attempt in range(6):
        xml = _get('/collection', {'username': bgg_username, 'own': 1})
        if xml:
            break
        time.sleep(2 ** attempt)

    if not xml:
        return {'error': 'Could not fetch BGG collection.', 'created': 0, 'skipped': 0}

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return {'error': 'BGG returned invalid XML.', 'created': 0, 'skipped': 0}

    created = 0
    skipped = 0
    for item in root.findall('item'):
        if item.get('subtype') != 'boardgame':
            continue
        bgg_id = int(item.get('objectid', 0))
        if not bgg_id:
            continue
        game = get_or_sync_game(bgg_id)
        if not game:
            skipped += 1
            continue
        if Listing.objects.filter(owner=user, game=game).exists():
            skipped += 1
            continue
        Listing.objects.create(owner=user, game=game)
        created += 1

    return {'created': created, 'skipped': skipped}
