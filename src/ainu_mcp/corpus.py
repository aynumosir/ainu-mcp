"""Search across the ainu-corpora JSONL (~195k aligned sentences).

The file is loaded once and cached for the process lifetime. Searches are plain
case-insensitive substring matches against `text`, `translation`, or both.
"""

from __future__ import annotations

import json
from functools import cache
from typing import Any, Literal

from .config import get_config

Lang = Literal["ain", "jpn", "any"]


@cache
def _load() -> list[dict[str, Any]]:
    path = get_config().corpora_jsonl
    if not path.exists():
        raise RuntimeError(f"corpus file not found: {path}")
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def search(
    query: str,
    *,
    lang: Lang = "any",
    dialect: str | None = None,
    author: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    q = query.lower().strip()
    if not q:
        return []
    out: list[dict[str, Any]] = []
    for row in _load():
        text = (row.get("text") or "").lower()
        translation = (row.get("translation") or "").lower()
        match lang:
            case "ain":
                if q not in text:
                    continue
            case "jpn":
                if q not in translation:
                    continue
            case "any":
                if q not in text and q not in translation:
                    continue
        if dialect and dialect not in (row.get("dialect") or ""):
            continue
        if author and author not in (row.get("author") or ""):
            continue
        out.append(
            {
                "id": row.get("id"),
                "text": row.get("text"),
                "translation": row.get("translation"),
                "dialect": row.get("dialect"),
                "author": row.get("author"),
                "collection": row.get("collection_lv1"),
                "document": row.get("document"),
                "uri": row.get("uri"),
            }
        )
        if len(out) >= limit:
            break
    return out


def stats() -> dict[str, Any]:
    rows = _load()
    dialects: dict[str, int] = {}
    for r in rows:
        d = r.get("dialect") or "(unknown)"
        dialects[d] = dialects.get(d, 0) + 1
    top_dialects = dict(sorted(dialects.items(), key=lambda kv: -kv[1])[:10])
    return {
        "sentences": len(rows),
        "top_dialects": top_dialects,
    }
