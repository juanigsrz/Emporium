"""Importer registry. Each feature registers `IMPORTERS[kind] = fn(job) -> dict`.

An importer returns {"summary": {...}, "result": {...}, "log": "..."}.
"""

IMPORTERS = {}


def register(kind):
    def deco(fn):
        IMPORTERS[kind] = fn
        return fn
    return deco
