#!/usr/bin/env python
"""Mine the アイヌタイムズ (Ainu Times) sub-corpus for modern vocabulary.

Ainu Times (the Ainu-go Pen Club newspaper) is the single richest source of
*modern* Ainu usage in ainu-corpora/data.jsonl — a living newspaper. But it has
a critical editorial caveat for our glossary:

    For concepts it has no Ainu word for, Ainu Times writes the term INLINE IN
    JAPANESE (katakana), e.g. the sentence for "use a computer" literally
    contains「コンピューター」. We must NOT copy these code-switches into the
    glossary — they are not Ainu coinages.

So this miner only surfaces rows whose Ainu side is *pure Ainu* (no kana/kanji),
where the Japanese translation names a modern concept. Those are the cases where
Ainu Times actually rendered the concept in Ainu — the harvest worth vetting.

CORPUS SCHEMA (verified 2026-05): each JSONL row has keys
    id, collection_lv1, collection_lv2, collection_lv3, document, uri,
    pronoun, author, dialect, dialect_lv1/2/3, text, translation,
    recorded_at, published_at
The Ainu text is `text` (NOT `sentence`); Japanese is `translation`; the source
is in `collection_lv*` / `id` (there is NO `book` field). Ainu Times rows are
detected by `is_ainu_times()` below — adjust the markers if the id scheme
changes (`texts/ainu-times/NNN/N.yaml` is the on-disk source tree).

Output: pass --out PATH to write results to a file (recommended — terminal
output may be large). Otherwise prints to stdout.

Usage:
    uv run python scripts/mine_ainu_times.py --diagnose
    uv run python scripts/mine_ainu_times.py --concepts --out /tmp/at_concepts.txt
    uv run python scripts/mine_ainu_times.py --gap --glossary /tmp/gl_aynu_set.txt --out /tmp/at_gap.txt
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

AINU_ROOT = Path(__file__).resolve().parents[2]
CORPUS = AINU_ROOT / "ainu-corpora" / "data.jsonl"

# kana + kanji + half-width katakana → marks Japanese code-switching
CJK = re.compile(r"[぀-ヿ㐀-鿿ｦ-ﾟ]")

MODERN_CONCEPTS = [
    "パソコン", "インターネット", "ウェブ", "電話", "携帯", "テレビ", "ラジオ",
    "新聞", "学校", "大学", "病院", "銀行", "会社", "政府", "国家", "世界",
    "選挙", "議会", "憲法", "法律", "権利", "飛行機", "自動車", "電車", "電気",
    "写真", "時計", "お金", "仕事", "機械", "工場", "会議", "計画", "文化",
    "歴史", "未来", "平和", "自然", "環境", "科学", "技術", "教育", "経済",
    "社会", "情報", "放送", "地球", "宇宙", "民族", "言語", "国連", "条約",
    "裁判", "税金", "保険", "年金", "予算", "産業", "農業", "漁業",
]


def is_ainu_times(o: dict) -> bool:
    """Detect an Ainu Times row from the corpus metadata.

    Markers (any one): the romanized id/uri references the ainu-times source
    tree, or a collection level names アイヌタイムズ (kana タイㇺ or kanji-free
    タイムズ form). Kept liberal so a schema tweak doesn't silently drop rows.
    """
    i = (o.get("id") or "").lower()
    uri = (o.get("uri") or "").lower()
    if "ainu-times" in i or "ainu_times" in i or "ainu-times" in uri:
        return True
    blob = "".join(str(o.get(k, "")) for k in ("collection_lv1", "collection_lv2", "collection_lv3", "document"))
    return "タイㇺ" in blob or "タイムズ" in blob


def load_ainu_times() -> list[dict]:
    rows = []
    with CORPUS.open(encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            if is_ainu_times(o):
                rows.append(o)
    return rows


def is_pure_ainu(text: str) -> bool:
    return bool(text.strip()) and not CJK.search(text)


def diagnose(rows: list[dict], w) -> None:
    """Print sanity stats so the AT filter can be verified despite loose schema."""
    w.write(f"Ainu Times rows matched: {len(rows)}\n")
    pure = sum(1 for o in rows if is_pure_ainu(o.get("text") or ""))
    w.write(f"  pure-Ainu text rows: {pure}\n")
    coll = collections.Counter((o.get("collection_lv1") or "(none)") for o in rows)
    w.write("  top collection_lv1:\n")
    for k, v in coll.most_common(5):
        w.write(f"    {v:6d} {k}\n")
    for o in rows[:3]:
        w.write(f"  e.g. id={o.get('id')!r}\n        text={ (o.get('text') or '')[:80]!r}\n        tr={ (o.get('translation') or '')[:60]!r}\n")


def concepts_mode(rows: list[dict], w) -> None:
    by_kw: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for o in rows:
        s = (o.get("text") or "").strip()
        tr = (o.get("translation") or "").strip()
        if not is_pure_ainu(s):
            continue
        for k in MODERN_CONCEPTS:
            if k in tr:
                by_kw[k].append((s, tr))
    total = sum(len(v) for v in by_kw.values())
    w.write(f"# pure-Ainu Ainu Times rows naming a modern concept: {total}\n")
    for k in MODERN_CONCEPTS:
        hits = by_kw.get(k)
        if not hits:
            continue
        w.write(f"\n===== {k} ({len(hits)}) =====\n")
        for s, tr in sorted(hits, key=lambda x: len(x[0]))[:6]:
            w.write(f"AIN {s}\nJPN {tr}\n")


def gap_mode(rows: list[dict], glossary_set: Path, w) -> None:
    gl = {l.strip().lower() for l in glossary_set.read_text(encoding="utf-8").splitlines() if l.strip()}
    gl_tokens = set()
    for f in gl:
        for t in re.split(r"[\s=]+", f):
            t = t.strip("()[],.;:!?\"'’")
            if t:
                gl_tokens.add(t.lower())
    freq: collections.Counter[str] = collections.Counter()
    example: dict[str, tuple[str, str]] = {}
    for o in rows:
        s = o.get("text") or ""
        tr = (o.get("translation") or "").strip()
        for raw in s.split():
            t = raw.strip("()[]{}.,;:!?\"'’“”…・").lower()
            if not t or CJK.search(raw):
                continue
            if not re.fullmatch(r"[a-zâîûêôáíúéó'’=-]+", t) or len(t) < 2:
                continue
            freq[t] += 1
            if t not in example and tr:
                example[t] = (s.strip(), tr)
    w.write("# Ainu Times tokens not in glossary, by frequency\n")
    shown = 0
    for t, c in freq.most_common():
        if t in gl or t in gl_tokens:
            continue
        _, tr = example.get(t, ("", ""))
        w.write(f"{c:5d}  {t:20s}  {tr[:50]}\n")
        shown += 1
        if shown >= 250:
            break


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--diagnose", action="store_true", help="filter sanity stats")
    ap.add_argument("--concepts", action="store_true", help="modern-concept renderings")
    ap.add_argument("--gap", action="store_true", help="glossary-gap tokens by frequency")
    ap.add_argument("--glossary", type=Path, help="newline-separated glossary Aynu-form set (for --gap)")
    ap.add_argument("--out", type=Path, help="write results here instead of stdout")
    args = ap.parse_args()

    rows = load_ainu_times()
    w = args.out.open("w", encoding="utf-8") if args.out else sys.stdout
    try:
        w.write(f"# Ainu Times rows: {len(rows)}\n")
        if args.diagnose:
            diagnose(rows, w)
        if args.concepts:
            concepts_mode(rows, w)
        if args.gap:
            if not args.glossary:
                ap.error("--gap requires --glossary <path>")
            gap_mode(rows, args.glossary, w)
        if not any((args.diagnose, args.concepts, args.gap)):
            ap.print_help()
    finally:
        if args.out:
            w.close()
            print(f"wrote {args.out} ({args.out.stat().st_size} bytes); AT rows={len(rows)}")


if __name__ == "__main__":
    main()
