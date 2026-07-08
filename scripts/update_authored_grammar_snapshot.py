#!/usr/bin/env python3
"""Regenerate the vendored authored-grammar plain-text snapshot.

Inputs are sibling source checkouts under AINU_ROOT:
  - ainu-grammar-hokkaido/
  - aynu-itah/

The normal Turso refresh workflow intentionally does not need to clone those
repos: it can use the committed JSON snapshot. This script is the update path for
when either authored grammar site changes.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ainu_mcp import grammar
from ainu_mcp.config import get_config

SNAPSHOT = Path(__file__).resolve().parent.parent / "src" / "ainu_mcp" / "data" / "authored_grammar_texts.json"
REQUIRED = {
    "hokkaido": "ainu-grammar-hokkaido",
    "sakhalin": "aynu-itah",
}
KEEP_FIELDS = [
    "source",
    "kind",
    "path",
    "repo_path",
    "filename",
    "slug",
    "title",
    "summary",
    "part",
    "variant",
    "text",
    "license",
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="do not write; fail if the snapshot would change")
    args = ap.parse_args()

    root = get_config().ainu_root
    missing = [name for name in REQUIRED.values() if not (root / name).exists()]
    if missing:
        raise SystemExit(
            "Missing authored grammar source checkout(s) under "
            f"{root}: {', '.join(missing)}. Clone them first or set AINU_ROOT."
        )

    # Force collection from the source checkouts, not from any previously cached
    # snapshot fallback.
    grammar._written_plain_texts.cache_clear()  # type: ignore[attr-defined]
    docs = grammar._written_plain_texts()  # noqa: SLF001 - internal ETL helper
    counts = {source: sum(1 for d in docs if d.get("source") == source) for source in REQUIRED}
    if any(n == 0 for n in counts.values()):
        raise SystemExit(f"Authored grammar extraction returned incomplete counts: {counts}")

    stable = [{k: d.get(k, "") for k in KEEP_FIELDS} for d in docs]
    payload = json.dumps(stable, ensure_ascii=False, separators=(",", ":")) + "\n"

    old = SNAPSHOT.read_text(encoding="utf-8") if SNAPSHOT.exists() else ""
    if args.check:
        if old != payload:
            raise SystemExit("authored grammar snapshot is stale; run scripts/update_authored_grammar_snapshot.py")
        print(f"snapshot up to date: {SNAPSHOT} ({len(stable)} chapters; {counts})")
        return

    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(payload, encoding="utf-8")
    print(f"wrote {SNAPSHOT} ({len(stable)} chapters; {counts}; {len(payload.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
