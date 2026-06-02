"""Find vocabulary gaps in the glossary.

Surfaces Ainu words that appear frequently in the corpus but aren't in the
glossary yet — useful for proposing high-value additions.
"""

from __future__ import annotations

import re
from collections import Counter
from functools import cache
from typing import Any

from . import corpus, dictionaries, glossary

# Aynu word tokens — letters (incl. diacritics) plus the apostrophe used for ’ (glottal stop)
_TOKEN = re.compile(r"[A-Za-zÀ-ɏ'’]+")
# Personal-affix clitics to strip when normalizing
_AFFIX_PREFIX = re.compile(r"^(?:a=|ku=|ci=|eci=|e=|c=|en=|i=|un=)")


def _normalize(tok: str) -> str:
    t = tok.lower()
    t = _AFFIX_PREFIX.sub("", t)
    # strip the intransitive-subject suffix
    if t.endswith("=an"):
        t = t[:-3]
    t = t.strip("'’")
    return t


# Stopwords (extremely common particles/auxiliaries that don't merit glossary
# entries) come from the shared aynumosir/ainu-stopwords list — see
# ainu_mcp.stopwords. Imported lazily where used to avoid a module-load cycle
# (stopwords imports gaps for _normalize).


@cache
def _glossary_aynu_index() -> set[str]:
    """All Aynu words/forms currently in the glossary (normalized, including
    multiword)."""
    out: set[str] = set()
    cats = [c["sheetName"] for c in glossary.list_categories() if c["isContent"]]
    data = glossary._batch_read_tabs(cats)
    for cat, (headers, rows) in data.items():
        if "Aynu" not in headers:
            continue
        ai = headers.index("Aynu")
        for row in rows:
            if ai >= len(row):
                continue
            cell = row[ai]
            if not cell:
                continue
            # split on commas (alt forms)
            for form in cell.split(","):
                f = form.strip()
                if not f:
                    continue
                out.add(_normalize(f))
                # also add the raw last-token (verb stem)
                toks = _TOKEN.findall(f)
                if toks:
                    out.add(_normalize(toks[-1]))
                # add each token (for multi-word forms)
                for t in toks:
                    n = _normalize(t)
                    if n:
                        out.add(n)
    return {x for x in out if x}


@cache
def _dict_lemma_index() -> dict[str, set[str]]:
    """Per-dictionary lemma sets (normalized)."""
    out: dict[str, set[str]] = {}
    for name in dictionaries._list_dicts():
        s: set[str] = set()
        for e in dictionaries._load_dict(name):
            le = (e.get("lemma") or "").strip().lower()
            if le:
                s.add(_normalize(le))
        out[name] = s
    return out


def missing_high_frequency(top_n: int = 200, min_count: int = 20) -> list[dict[str, Any]]:
    """Return the most-frequent corpus tokens that aren't in the glossary.

    Each entry includes: token, count, in_dicts (list of dicts that attest it),
    sample sentence (for context).
    """
    from . import stopwords  # local import avoids a module-load cycle (stopwords → gaps)

    stops = stopwords.normalized_set()
    counter: Counter[str] = Counter()
    sample: dict[str, tuple[str, str]] = {}
    for row in corpus._load():
        text = row.get("text") or ""
        if not text:
            continue
        for tok in _TOKEN.findall(text):
            n = _normalize(tok)
            if not n or n in stops or len(n) <= 1:
                continue
            counter[n] += 1
            if n not in sample:
                sample[n] = (text[:120], row.get("translation", "")[:120])

    in_glossary = _glossary_aynu_index()
    dict_idx = _dict_lemma_index()
    dict_short = {
        "1996_Kayano_Kayanos-Ainu-Dictionary": "Kayano",
        "1996_Tamura_Ainu-Saru-Dialect-Dictionary": "Tamura",
        "1987_Chiri_Categorized-Ainu-Dictionary": "Chiri",
        "1995_Nakagawa_Ainu-Chitose-Dialect-Dictionary": "Nakagawa",
        "2022_Ota_Japanese-Ainu_Dictionary": "Ota",
    }

    results: list[dict[str, Any]] = []
    for tok, count in counter.most_common():
        if count < min_count:
            break
        if tok in in_glossary:
            continue
        attested = [
            dict_short[d] for d in dict_idx if d in dict_short and tok in dict_idx[d]
        ]
        if not attested:
            continue  # skip rare/dubious — only propose if at least one dict attests
        text, tr = sample.get(tok, ("", ""))
        results.append(
            {
                "token": tok,
                "count": count,
                "attested_in": attested,
                "sample_text": text,
                "sample_translation": tr,
            }
        )
        if len(results) >= top_n:
            break
    return results
