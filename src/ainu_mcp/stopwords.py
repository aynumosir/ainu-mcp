"""Ainu stopwords, sourced from aynumosir/ainu-stopwords.

The list lives in a sibling repo (``$AINU_ROOT/ainu-stopwords/ainu-stopwords.txt``,
one word per line). It is loaded once and cached. If the repo isn't checked out
the list is simply empty — every helper degrades gracefully (nothing is a
stopword) rather than raising, so the rest of the toolchain keeps working.
"""

from __future__ import annotations

from functools import cache

from . import gaps
from .config import get_config

SOURCE = "aynumosir/ainu-stopwords"


@cache
def all_stopwords() -> list[str]:
    """The published stopword list (trimmed, blank lines + duplicates removed),
    in source order."""
    path = get_config().stopwords_file
    if not path.exists():
        return []
    seen: set[str] = set()
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
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
