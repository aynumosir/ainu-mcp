"""Grammar bibliography + transcribed text search over ainu-grammar.

The repo holds PDFs of grammar books and articles, plus selectively transcribed
plaintext/markdown sources. We expose two surfaces:

- `list_materials()` — list all PDFs (filename is structured as `YEAR_Author_Title`).
- `search_materials(query)` — substring search over filenames AND over any
  transcribed text under `books/*/transcribed/**` and `books/*/markdown/**`.
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path
from typing import Any

from .config import get_config

_FILENAME_RE = re.compile(r"^(?P<year>\d{4})_(?P<author>[^_]+)_(?P<title>.+)\.(pdf|md|txt)$")


@cache
def _walk_materials() -> list[dict[str, Any]]:
    root = get_config().grammar_dir
    if not root.exists():
        return []
    out: list[dict[str, Any]] = []
    for kind in ("books", "articles"):
        base = root / kind
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in {".pdf", ".md", ".txt"}:
                continue
            rel = p.relative_to(root)
            meta: dict[str, Any] = {
                "kind": kind,
                "path": str(rel),
                "filename": p.name,
            }
            m = _FILENAME_RE.match(p.name)
            if m:
                meta["year"] = int(m["year"])
                meta["author"] = m["author"]
                meta["title"] = m["title"]
            out.append(meta)
    return out


def list_materials(kind: str | None = None) -> list[dict[str, Any]]:
    mats = _walk_materials()
    if kind:
        mats = [m for m in mats if m["kind"] == kind]
    return mats


def _scan_transcribed(q: str, limit: int) -> list[dict[str, Any]]:
    """Search inside any transcribed markdown/text files."""
    root = get_config().grammar_dir
    hits: list[dict[str, Any]] = []
    if not root.exists():
        return hits
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in {".md", ".txt"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lower = text.lower()
        if q not in lower:
            continue
        # collect up to 3 short snippets per file
        snippets: list[str] = []
        start = 0
        while len(snippets) < 3:
            i = lower.find(q, start)
            if i < 0:
                break
            s = max(0, i - 80)
            e = min(len(text), i + len(q) + 80)
            snippets.append(text[s:e].replace("\n", " ").strip())
            start = i + len(q)
        hits.append(
            {
                "path": str(p.relative_to(root)),
                "snippets": snippets,
            }
        )
        if len(hits) >= limit:
            break
    return hits


def search_materials(
    query: str,
    *,
    include_transcribed: bool = True,
    limit: int = 30,
) -> dict[str, Any]:
    q = query.lower().strip()
    if not q:
        return {"filename_hits": [], "transcribed_hits": []}
    name_hits = [
        m
        for m in _walk_materials()
        if q in m["filename"].lower()
        or q in (m.get("title", "").lower())
        or q in (m.get("author", "").lower())
    ][:limit]
    transcribed_hits = _scan_transcribed(q, limit) if include_transcribed else []
    return {"filename_hits": name_hits, "transcribed_hits": transcribed_hits}
