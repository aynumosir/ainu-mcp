#!/usr/bin/env python3
"""Regenerate the vendored authored-grammar plain-text snapshot.

Inputs are sibling source checkouts under AINU_ROOT:
  - ainu-grammar-hokkaido/ (source: hokkaido)
  - aynu-itah/              (source: sakhalin)

By default both sources are refreshed. With --source, only that source is
required and replaced in the snapshot; the other source is kept from the existing
snapshot. This lets an `aynu-itah` push update only Sakhalin rows without needing
credentials for the private Hokkaido grammar repo.
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
SOURCE_ORDER = {"hokkaido": 0, "sakhalin": 1}
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


def load_existing() -> list[dict]:
    if not SNAPSHOT.exists():
        return []
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def stable_payload(docs: list[dict]) -> tuple[str, dict[str, int]]:
    stable = [{k: d.get(k, "") for k in KEEP_FIELDS} for d in docs]
    stable.sort(key=lambda d: (SOURCE_ORDER.get(d.get("source"), 99), d.get("path", "")))
    counts = {source: sum(1 for d in stable if d.get("source") == source) for source in REQUIRED}
    return json.dumps(stable, ensure_ascii=False, separators=(",", ":")) + "\n", counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="do not write; fail if the snapshot would change")
    ap.add_argument(
        "--source",
        choices=["all", "hokkaido", "sakhalin"],
        default="all",
        help="which authored grammar source(s) to refresh; non-selected sources are kept from the existing snapshot",
    )
    args = ap.parse_args()

    selected = set(REQUIRED) if args.source == "all" else {args.source}
    root = get_config().ainu_root
    missing = [REQUIRED[source] for source in selected if not (root / REQUIRED[source]).exists()]
    if missing:
        raise SystemExit(
            "Missing authored grammar source checkout(s) under "
            f"{root}: {', '.join(missing)}. Clone them first or set AINU_ROOT."
        )

    # Force collection from source checkouts, not any cached fallback.
    grammar._written_plain_texts.cache_clear()  # type: ignore[attr-defined]
    extracted = grammar._written_plain_texts()  # noqa: SLF001 - internal ETL helper
    replacement = [d for d in extracted if d.get("source") in selected]
    replacement_counts = {source: sum(1 for d in replacement if d.get("source") == source) for source in selected}
    if any(n == 0 for n in replacement_counts.values()):
        raise SystemExit(f"Authored grammar extraction returned incomplete selected counts: {replacement_counts}")

    existing = load_existing()
    combined = [d for d in existing if d.get("source") not in selected] + replacement
    payload, counts = stable_payload(combined)
    if any(counts.get(source, 0) == 0 for source in REQUIRED):
        raise SystemExit(f"Combined snapshot would be incomplete: {counts}")

    old = SNAPSHOT.read_text(encoding="utf-8") if SNAPSHOT.exists() else ""
    if args.check:
        if old != payload:
            raise SystemExit(
                "authored grammar snapshot is stale; run "
                f"scripts/update_authored_grammar_snapshot.py --source {args.source}"
            )
        print(f"snapshot up to date: {SNAPSHOT} ({sum(counts.values())} chapters; {counts})")
        return

    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(payload, encoding="utf-8")
    print(f"wrote {SNAPSHOT} ({sum(counts.values())} chapters; {counts}; {len(payload.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
