#!/usr/bin/env python3
"""Enrich boardgames_ranks.csv with live data from the BGG XML API.

Standalone, stdlib-only, resumable scraper. For each game id in the source dump
it fetches ``xmlapi2/thing?id=<ids>&stats=1&versions=1`` (up to 20 ids per
request) and writes two CSVs:

  * boardgames_enriched.csv  -- source columns + thumbnail, minplayers,
    maxplayers, averageweight, languagedependence(+label)
  * boardgame_versions.csv   -- one row per edition/version

Reads the bearer token from $BGG_API_KEY. Resumes from a sidecar cursor file
after interruption. Adapts the request delay to the server's rate limit (AIMD
with a ratcheting floor). See docs/superpowers/specs/2026-06-10-bgg-enrich-scraper-design.md
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

API_URL = "https://boardgamegeek.com/xmlapi2/thing"

ENRICHED_EXTRA_COLS = [
    "thumbnail",
    "minplayers",
    "maxplayers",
    "averageweight",
    "languagedependence",
    "languagedependence_label",
]
VERSION_COLS = [
    "boardgame_id",
    "id",
    "name",
    "thumbnail",
    "language",
    "publisher",
    "yearpublished",
    "width",
    "length",
    "depth",
    "weight",
]


class RateLimited(Exception):
    """Server asked us to slow down (429/503/202/throttle page)."""


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------
def fetch_xml(ids, token, timeout=60):
    url = f"{API_URL}?id={','.join(str(i) for i in ids)}&stats=1&versions=1"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status == 202:  # queued; not ready yet
            raise RateLimited("HTTP 202 queued")
        body = resp.read().decode("utf-8", "replace")
    if "<items" not in body[:500]:  # HTML throttle page / error body
        raise RateLimited("non-XML body")
    return body


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def _val(el):
    return el.get("value", "") if el is not None else ""


def _langdep(item):
    """Return (level, label) of the most-voted language_dependence result.

    Ties break to the lowest level. ("", "") if the poll has no votes."""
    for poll in item.findall("poll"):
        if poll.get("name") != "language_dependence":
            continue
        best = None  # (level, votes, label)
        for res in poll.iter("result"):
            try:
                level = int(res.get("level", ""))
                votes = int(res.get("numvotes", "0"))
            except ValueError:
                continue
            if best is None or votes > best[1] or (votes == best[1] and level < best[0]):
                best = (level, votes, res.get("value", ""))
        if best and best[1] > 0:
            return best[0], best[2]
        return "", ""
    return "", ""


def _parse_version(v, parent_id):
    name = ""
    for n in v.findall("name"):
        if n.get("type") == "primary":
            name = n.get("value", "")
            break
    else:
        first = v.find("name")
        if first is not None:
            name = first.get("value", "")
    langs = [l.get("value", "") for l in v.findall("link") if l.get("type") == "language"]
    pubs = [l.get("value", "") for l in v.findall("link") if l.get("type") == "boardgamepublisher"]
    return {
        "boardgame_id": parent_id,
        "id": v.get("id"),
        "name": name,
        "thumbnail": (v.findtext("thumbnail") or "").strip(),
        "language": "|".join(langs),
        "publisher": "|".join(pubs),
        "yearpublished": _val(v.find("yearpublished")),
        "width": _val(v.find("width")),
        "length": _val(v.find("length")),
        "depth": _val(v.find("depth")),
        "weight": _val(v.find("weight")),
    }


def parse_things(xml):
    """Parse a thing response into ({game_id: extra_cols}, [version_rows])."""
    root = ET.fromstring(xml)
    games = {}
    versions = []
    for item in root.findall("item"):
        if item.get("type") not in ("boardgame", "boardgameexpansion"):
            continue
        gid = item.get("id")
        level, label = _langdep(item)
        games[gid] = {
            "thumbnail": (item.findtext("thumbnail") or "").strip(),
            "minplayers": _val(item.find("minplayers")),
            "maxplayers": _val(item.find("maxplayers")),
            "averageweight": _val(item.find("statistics/ratings/averageweight")),
            "languagedependence": level,
            "languagedependence_label": label,
        }
        vers_el = item.find("versions")
        if vers_el is not None:
            for v in vers_el.findall("item"):
                if v.get("type") == "boardgameversion":
                    versions.append(_parse_version(v, gid))
    return games, versions


# ---------------------------------------------------------------------------
# CSV / cursor IO
# ---------------------------------------------------------------------------
def read_source(path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    return header, rows


def cursor_path(out_path):
    return os.path.splitext(out_path)[0] + ".progress.json"


def load_cursor(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("next", 0)


def save_cursor(path, next_index):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"next": next_index}, f)
    os.replace(tmp, path)  # atomic


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Enrich boardgames_ranks.csv via the BGG XML API.")
    p.add_argument("--source", default="boardgames_ranks.csv")
    p.add_argument("--out", default="boardgames_enriched.csv")
    p.add_argument("--versions-out", default="boardgame_versions.csv")
    p.add_argument("--batch-size", type=int, default=20)
    p.add_argument("--min-delay", type=float, default=1)
    p.add_argument("--max-delay", type=float, default=10.0)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--no-resume", action="store_true", help="ignore cursor; start fresh")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    token = os.environ.get("BGG_API_KEY")
    if not token:
        sys.exit("BGG_API_KEY not set in environment")

    header, rows = read_source(args.source)
    total = len(rows) if args.limit is None else min(len(rows), args.limit)

    cpath = cursor_path(args.out)
    fresh = args.no_resume or not os.path.exists(cpath)
    start = 0 if fresh else load_cursor(cpath)

    out_f = open(args.out, "w" if fresh else "a", newline="", encoding="utf-8")
    ver_f = open(args.versions_out, "w" if fresh else "a", newline="", encoding="utf-8")
    out_w = csv.writer(out_f)
    ver_w = csv.DictWriter(ver_f, fieldnames=VERSION_COLS)
    if fresh:
        out_w.writerow(header + ENRICHED_EXTRA_COLS)
        ver_w.writeheader()

    # Adaptive delay: monotonically increasing. Each throttle proves the current
    # rate is too fast, so we step up and never come back down -- this converges
    # to the smallest sustainable delay without ever re-probing (and re-hitting)
    # the rate limit.
    current = args.min_delay
    i = start
    print(f"start at row {i}/{total} (delay {current}s)", flush=True)

    while i < total:
        batch = rows[i:i + args.batch_size]
        ids = [r[0] for r in batch]

        net_attempts = 0
        while True:
            time.sleep(current)
            try:
                games, versions = parse_things(fetch_xml(ids, token))
                break
            except (RateLimited, ET.ParseError) as e:
                current = min(current + 1.0, args.max_delay)
                print(f"  throttled ({e}); delay -> {current}s", flush=True)
            except urllib.error.HTTPError as e:
                sys.exit(f"fatal HTTP {e.code} on ids {ids[:3]}...: {e}")
            except urllib.error.URLError as e:
                net_attempts += 1
                if net_attempts > 10:
                    sys.exit(f"network failed after {net_attempts} retries: {e}")
                current = min(current + 1.0, args.max_delay)
                print(f"  network error (retry {net_attempts}): {e}", flush=True)

        # versions first, then game rows, then durable, then advance cursor
        for v in versions:
            ver_w.writerow(v)
        for r in batch:
            extra = games.get(r[0], {})
            out_w.writerow(r + [extra.get(c, "") for c in ENRICHED_EXTRA_COLS])
        out_f.flush()
        os.fsync(out_f.fileno())
        ver_f.flush()
        os.fsync(ver_f.fileno())

        i += len(batch)
        save_cursor(cpath, i)
        print(f"  {i}/{total} games | +{len(versions)} versions | delay {current}s", flush=True)

    out_f.close()
    ver_f.close()
    print(f"done: {total} games -> {args.out}, {args.versions_out}", flush=True)


if __name__ == "__main__":
    main()
