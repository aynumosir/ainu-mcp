"""Multi-dictionary lookup over the ainu-dictionaries collection.

Each subdirectory is one dictionary; data lives in `*.tsv` (and occasionally
`*.jsonl`/`*.json`) files. Most have a `lemma` column. A few are special-cased:

- **Ota (2022)** is a Japanese→Ainu dictionary; the Ainu form is buried inside
  a `description` cell of `original.tsv`. The repo also ships `reversed.tsv`
  with explicit `ainu_word | region | japanese_description` columns, so we load
  THAT instead and present it with `lemma = ainu_word` for uniform searching.
- **Nakagawa (1995)** uses `latn` as the headword (no `lemma` column); we
  normalize it to `lemma` at load time so it indexes consistently.

We load lazily per-dict and cache.
"""

from __future__ import annotations

import csv
import json
import sys
from functools import cache
from pathlib import Path
from typing import Any

from .config import get_config

# Some dictionary entries (e.g. Compilation_Ainu-Dialect-Database) have huge
# concatenated fields; the default 128KB csv field limit truncates with an
# error. Raise it to whatever the platform allows.
csv.field_size_limit(sys.maxsize)

_SKIP_DIRS = {"schemas", "__pycache__"}

# Per-dictionary load overrides: directory name → preferred filename to load.
# If set, only this file is loaded (not all *.tsv).
_PREFERRED_FILE: dict[str, str] = {
    "2022_Ota_Japanese-Ainu_Dictionary": "reversed.tsv",
}

# Per-dictionary column renames: directory name → {file column → canonical key}.
# Applied after rows are read so downstream code can rely on `lemma`.
_COLUMN_ALIASES: dict[str, dict[str, str]] = {
    "1995_Nakagawa_Ainu-Chitose-Dialect-Dictionary": {"latn": "lemma"},
    "2022_Ota_Japanese-Ainu_Dictionary": {
        "ainu_word": "lemma",
        "japanese_description": "definition",
    },
    "1903_Torii_Kuril-Ainu_wordlist": {
        "ain": "lemma",
        "jpn": "definition",
    },
    # 1990_Shibatani already uses `lemma` + `meaning_en` — no alias needed but
    # we map meaning_en → definition for uniform field access.
    "1990_Shibatani_RaccoonBend-Ainu-English-Wordlist": {
        "meaning_en": "definition",
    },
    # Chiba's Mukawa-Dialect dict already uses `lemma` + `translation`.
    "XXXX_Chiba_Mukawa-Dialect-Japanese-Ainu-Dictionary": {
        "translation": "definition",
    },
}


@cache
def _list_dicts() -> list[str]:
    root = get_config().dictionaries_dir
    if not root.exists():
        return []
    return sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and p.name not in _SKIP_DIRS and not p.name.endswith(".egg-info")
    )


@cache
def _load_dict(name: str) -> list[dict[str, Any]]:
    root = get_config().dictionaries_dir / name
    if not root.is_dir():
        return []
    aliases = _COLUMN_ALIASES.get(name, {})
    preferred = _PREFERRED_FILE.get(name)
    entries: list[dict[str, Any]] = []

    def _apply_aliases(row: dict[str, Any]) -> dict[str, Any]:
        if not aliases:
            return row
        for src, dst in aliases.items():
            if src in row and dst not in row:
                row[dst] = row[src]
        return row

    if preferred:
        p = root / preferred
        if not p.is_file():
            return []
        with p.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                row = _apply_aliases(row)
                row["_file"] = p.name
                entries.append(row)
        return entries

    for tsv in sorted(root.glob("*.tsv")):
        with tsv.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                row = _apply_aliases(row)
                row["_file"] = tsv.name
                entries.append(row)
    for csvp in sorted(root.glob("*.csv")):
        with csvp.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row = _apply_aliases(row)
                row["_file"] = csvp.name
                entries.append(row)
    for jl in sorted(root.glob("*.jsonl")):
        with jl.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                obj = json.loads(line)
                if isinstance(obj, dict):
                    obj = _apply_aliases(obj)
                    obj["_file"] = jl.name
                    entries.append(obj)
    return entries


def reverse_lookup(
    aynu: str,
    *,
    dicts: list[str] | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Dictionaries indexed by Ainu lemma — return Japanese/English definitions.

    Searches the `lemma` field for exact (case-insensitive) match first, then
    falls back to substring. Useful when you have an Aynu word and want every
    dictionary's gloss for it.
    """
    q = aynu.strip().lower()
    if not q:
        return []
    target = dicts or _list_dicts()
    exact: list[dict[str, Any]] = []
    substr: list[dict[str, Any]] = []
    for name in target:
        for e in _load_dict(name):
            le = (e.get("lemma") or "").strip().lower()
            if not le:
                continue
            if le == q:
                exact.append(
                    {
                        "dictionary": name,
                        "lemma": e.get("lemma"),
                        "definition": e.get("definition", ""),
                        "source_file": e.get("_file"),
                    }
                )
            elif q in le and len(substr) < limit:
                substr.append(
                    {
                        "dictionary": name,
                        "lemma": e.get("lemma"),
                        "definition": e.get("definition", ""),
                        "source_file": e.get("_file"),
                    }
                )
    return (exact + substr)[:limit]


def list_dictionaries() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name in _list_dicts():
        try:
            count = len(_load_dict(name))
        except Exception as e:
            count = -1  # error placeholder
            out.append({"name": name, "entries": count, "error": str(e)})
            continue
        out.append({"name": name, "entries": count})
    return out


def _entry_matches(entry: dict[str, Any], q: str, fields: list[str] | None) -> str | None:
    """Return the field name that matched, or None."""
    targets = fields or [k for k in entry if k != "_file"]
    for k in targets:
        v = entry.get(k)
        if isinstance(v, str) and q in v.lower():
            return k
    return None


def lookup(
    word: str,
    *,
    dicts: list[str] | None = None,
    fields: list[str] | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    q = word.lower().strip()
    if not q:
        return []
    target_dicts = dicts or _list_dicts()
    out: list[dict[str, Any]] = []
    for name in target_dicts:
        for entry in _load_dict(name):
            matched = _entry_matches(entry, q, fields)
            if not matched:
                continue
            out.append(
                {
                    "dictionary": name,
                    "matched_in": matched,
                    "entry": {k: v for k, v in entry.items() if k != "_file"},
                    "source_file": entry.get("_file"),
                }
            )
            if len(out) >= limit:
                return out
    return out
