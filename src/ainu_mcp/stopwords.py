"""Ainu stopwords, sourced from aynumosir/ainu-stopwords (one word per line).

The list is loaded once and cached. It is resolved in this order:

1. A local sibling checkout (``$AINU_ROOT/ainu-stopwords/ainu-stopwords.txt``) if
   present — keeps CI reproducible and works offline / against a pinned copy.
2. Otherwise it is fetched straight from the public GitHub repo, so the ETL
   needs no manual clone (the repo is public and the file is tiny).

If neither source is reachable the list is simply empty — every helper degrades
gracefully (nothing is a stopword) rather than raising, so the rest of the
toolchain keeps working.
"""

from __future__ import annotations

import urllib.request
from functools import cache

from . import gaps
from .config import get_config

SOURCE = "aynumosir/ainu-stopwords"
RAW_URL = "https://raw.githubusercontent.com/aynumosir/ainu-stopwords/main/ainu-stopwords.txt"


@cache
def _raw_text() -> str:
    """Raw contents of ainu-stopwords.txt — local checkout first, else fetched
    from GitHub. Returns "" if neither is available."""
    path = get_config().stopwords_file
    if path.exists():
        return path.read_text(encoding="utf-8")
    try:
        with urllib.request.urlopen(RAW_URL, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except OSError:
        # Network/HTTP failure (URLError/HTTPError are OSError subclasses) —
        # degrade to an empty list; the CI seed build guards against this.
        return ""


@cache
def all_stopwords() -> list[str]:
    """The published stopword list (trimmed, blank lines + duplicates removed),
    in source order."""
    seen: set[str] = set()
    out: list[str] = []
    for line in _raw_text().splitlines():
        w = line.strip()
        if not w or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


@cache
def normalized_set() -> frozenset[str]:
    """Stopwords reduced to their gaps-normalized forms — the set used to match
    against normalized corpus tokens."""
    return frozenset(
        n for w in all_stopwords() if (n := gaps._normalize(w))
    )


def is_stopword(word: str) -> bool:
    """Whether ``word`` (normalized like a corpus token) is a stopword."""
    return gaps._normalize(word) in normalized_set()
