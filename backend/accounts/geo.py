"""Distance + geocoding helpers. No GeoDjango — plain floats + haversine."""

import logging
import math

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

_EARTH_KM = 6371.0088


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return round(2 * _EARTH_KM * math.asin(math.sqrt(a)), 2)


def geocode(address: str):
    """Return (lat, lng) or None. Calls public Nominatim; patched in tests."""
    if not address.strip():
        return None
    resp = requests.get(
        f"{settings.NOMINATIM_BASE_URL}/search",
        params={"q": address, "format": "json", "limit": 1},
        headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


def geocode_search(query: str, limit: int = 5):
    """Return up to `limit` [{display_name, lat, lon}] suggestions, or []. Best-effort."""
    if len(query.strip()) < 3:
        return []
    try:
        resp = requests.get(
            f"{settings.NOMINATIM_BASE_URL}/search",
            params={"q": query, "format": "json", "limit": limit},
            headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — geocoding is best-effort
        # Log so silent failures (e.g. Nominatim 403 on a blocked User-Agent) are
        # diagnosable instead of looking like "no results".
        logger.warning("Nominatim geocode_search(%r) failed: %s", query, exc)
        return []
    return [
        {"display_name": d["display_name"], "lat": float(d["lat"]), "lon": float(d["lon"])}
        for d in data
    ]
