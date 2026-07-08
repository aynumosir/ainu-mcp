#!/usr/bin/env python3
"""Build a small Turso seed that replaces only authored grammar rows.

The generated SQL deletes and reinserts rows whose source is `hokkaido` or
`sakhalin` in grammar_materials / grammar_fts. It does not touch corpus,
dictionaries, legacy ainu-grammar OCR, token frequencies, localizations, etc.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from etl.build_d1 import TEXT_CHUNK, chunk_text, q  # noqa: E402

SNAPSHOT = ROOT / "src" / "ainu_mcp" / "data" / "authored_grammar_texts.json"
DEFAULT_OUT = ROOT / "worker" / "seed" / "data" / "authored_grammar_refresh.sql"
SOURCES = ("hokkaido", "sakhalin")


def insert_row(table: str, cols: list[str], values: list[Any]) -> str:
    return f"INSERT INTO {table}({', '.join(cols)}) VALUES ({', '.join(q(v) for v in values)});\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    docs = json.loads(args.snapshot.read_text(encoding="utf-8"))
    docs = [d for d in docs if d.get("source") in SOURCES]
    if not docs:
        raise SystemExit(f"No authored grammar docs found in {args.snapshot}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        f.write("-- Replace only project-authored Hokkaido/Sakhalin grammar text.\n")
        f.write("DELETE FROM grammar_materials WHERE source IN ('hokkaido', 'sakhalin');\n")
        f.write("DELETE FROM grammar_fts WHERE source IN ('hokkaido', 'sakhalin');\n")

        material_cols = [
            "source",
            "kind",
            "path",
            "filename",
            "year",
            "author",
            "title",
            "summary",
            "part",
            "variant",
            "license",
            "plain_text_available",
        ]
        fts_cols = [
            "content",
            "path",
            "source",
            "kind",
            "title",
            "summary",
            "part",
            "variant",
            "license",
            "plain_text_available",
            "repo_path",
        ]

        fts_rows = 0
        for d in docs:
            f.write(
                insert_row(
                    "grammar_materials",
                    material_cols,
                    [
                        d.get("source"),
                        d.get("kind"),
                        d.get("path"),
                        d.get("filename"),
                        None,
                        None,
                        d.get("title"),
                        d.get("summary"),
                        d.get("part"),
                        d.get("variant"),
                        d.get("license"),
                        1,
                    ],
                )
            )
            for chunk in chunk_text(d.get("text") or "", TEXT_CHUNK, 0):
                f.write(
                    insert_row(
                        "grammar_fts",
                        fts_cols,
                        [
                            chunk,
                            d.get("path"),
                            d.get("source"),
                            d.get("kind"),
                            d.get("title"),
                            d.get("summary"),
                            d.get("part"),
                            d.get("variant"),
                            d.get("license"),
                            1,
                            d.get("repo_path"),
                        ],
                    )
                )
                fts_rows += 1

    print(f"wrote {args.out} ({len(docs)} grammar_materials rows, {fts_rows} grammar_fts rows)")


if __name__ == "__main__":
    main()
