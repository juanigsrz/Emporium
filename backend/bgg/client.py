"""Scrapes public BGG HTML (collection browser) and fetches geeklists via geekdo JSON API."""

import json
import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from django.conf import settings

GEEKDO_API_BASE = "https://api.geekdo.com"

_THING_HREF = re.compile(r"/(?:boardgame|boardgameexpansion)/(\d+)\b")

_KIND_QUERY = {
    "WISHLIST": "subtype=boardgame&wishlist=1&columns=status|thumbnail|title|wishlistcomment|shop&ff=1",
    "OWNED": "subtype=boardgame&own=1&ff=1",
    "OWNED_EXPANSIONS": "subtype=boardgameexpansion&own=1&ff=1",
    "RATED": "subtype=boardgame&rated=1&columns=status|thumbnail|title|rating&ff=1",
}


@dataclass
class CollectionRow:
    bgg_id: int
    name: str
    thumbnail: str = ""
    my_rating: Decimal | None = None
    language: str | None = None
    wishlist_comment: str | None = None


class BggClient:
    def __init__(self, base_url=None, delay=None, user_agent=None):
        self.base_url = base_url or settings.BGG_BASE_URL
        self.delay = settings.BGG_REQUEST_DELAY if delay is None else delay
        self.user_agent = user_agent or settings.BGG_USER_AGENT

    def fetch_collection(self, username: str, kind: str) -> list[CollectionRow]:
        query = _KIND_QUERY[kind]
        url = f"{self.base_url}/collection/user/{username}?{query}"
        return self._paginated(url)

    def fetch_geeklist(self, geeklist_id: str) -> list[CollectionRow]:
        out: list[CollectionRow] = []
        seen: set[int] = set()
        total = None
        for page in range(1, settings.BGG_MAX_PAGES + 1):
            url = f"{GEEKDO_API_BASE}/api/listitems?listid={geeklist_id}&pageid={page}"
            payload = json.loads(self._get(url))
            data = payload.get("data") or []
            if not data:
                break
            if total is None:
                total = payload.get("pagination", {}).get("total", 0)
            for entry in data:
                item = entry.get("item") or {}
                if item.get("type") != "things":
                    continue
                try:
                    bgg_id = int(item["id"])
                except (KeyError, TypeError, ValueError):
                    continue
                if bgg_id in seen:
                    continue
                seen.add(bgg_id)
                out.append(CollectionRow(bgg_id=bgg_id, name=item.get("name") or ""))
            if total is not None and len(out) >= total:
                break
        return out

    def _paginated(self, first_url: str) -> list[CollectionRow]:
        rows: list[CollectionRow] = []
        seen: set[int] = set()
        url = first_url
        for _ in range(settings.BGG_MAX_PAGES):
            html = self._get(url)
            for r in self._parse_rows(html):
                if r.bgg_id not in seen:
                    seen.add(r.bgg_id)
                    rows.append(r)
            nxt = self._next_page(html, url)
            if not nxt:
                break
            url = nxt
        return rows

    def _get(self, url: str) -> str:
        if self.delay:
            time.sleep(self.delay)
        resp = requests.get(url, headers={"User-Agent": self.user_agent}, timeout=30)
        resp.raise_for_status()
        return resp.text

    def _next_page(self, html: str, current_url: str) -> str | None:
        soup = BeautifulSoup(html, "html.parser")
        a = soup.find("a", attrs={"title": "next page"})
        if a and a.get("href"):
            return urljoin(current_url, a["href"])
        return None

    def _parse_rows(self, html: str) -> list[CollectionRow]:
        soup = BeautifulSoup(html, "html.parser")
        out: list[CollectionRow] = []
        seen: set[int] = set()
        for anchor in soup.find_all("a", href=_THING_HREF):
            m = _THING_HREF.search(anchor.get("href", ""))
            if not m:
                continue
            bgg_id = int(m.group(1))
            if bgg_id in seen:
                continue
            name = anchor.get_text(strip=True)
            if not name:  # thumbnail anchor wraps an <img>, no text — the title anchor carries the name
                continue
            seen.add(bgg_id)
            out.append(self._enrich(anchor, bgg_id, name))
        return out

    def _enrich(self, anchor, bgg_id, name) -> CollectionRow:
        container = anchor
        for _ in range(6):
            if container is None:
                break
            if getattr(container, "name", None) in ("tr", "li") or (
                getattr(container, "get", None) and "geekitem" in (container.get("class") or [])
            ):
                break
            container = container.parent
        return CollectionRow(
            bgg_id=bgg_id,
            name=name,
            my_rating=self._cell_decimal(container, "collection_rating"),
            wishlist_comment=self._cell_text(container, "collection_wishlistcomment"),
            language=None,  # collection browser does not expose version language in these columns
        )

    @staticmethod
    def _cell_text(container, css_class):
        if container is None:
            return None
        cell = container.find(class_=css_class)
        if not cell:
            return None
        text = cell.get_text(strip=True)
        return text or None

    @classmethod
    def _cell_decimal(cls, container, css_class):
        text = cls._cell_text(container, css_class)
        if not text:
            return None
        try:
            return Decimal(text)
        except (InvalidOperation, ValueError):
            return None
