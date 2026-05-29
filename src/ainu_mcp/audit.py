"""Find inconsistencies and likely errors in the glossary.

Each check returns a list of `Finding`s with a category-row pointer, the
rule it violates, and the offending text so they can be reviewed and fixed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from . import glossary

# Patterns
_AN_VERB_WITH_N1 = re.compile(r"\bN\d+\s+\S*=an\b")  # "N1 verb=an" — intransitive can't take N1 obj
_PAREN_JP = re.compile(r"[（(][^）)]*[）)]")  # 全角 or 半角 parens
_PAREN_AYNU = re.compile(r"[(][^)]*[)]")
# Match `N1`/`N2` as a standalone token, regardless of adjacent kana/kanji (so
# `全体のN1` counts as containing N1). Word-boundary `\b` doesn't work here
# because Japanese chars are word chars in Python's regex. Also treat `～`/`〜`
# (full-width tildes) and `~` as N-placeholder equivalents — they're a
# long-standing JP dictionary convention for "argument slot".
_N1_TOKEN = re.compile(r"(?<![A-Za-z])N\d+(?![A-Za-z])|[～〜~]")
# Morphological / variant notation we tolerate inside Aynu cells:
# - `etu(-hu)`, `(=an)`: explicit suffix/clitic markers
# - `topa(ha)`, `nokkew(e)`, `cikir(i)`: bare letters in parens = optional
#   suffix (dict shorthand for "possessed form"/"variant ending")
# - `tumpu (tunpu)`, `(hine) orano`: short alternate spelling/optional particle
# Anything else (free-form text, kana, comments) gets flagged.
_AYNU_MORPH_PAREN = re.compile(r"\(\s*(?:-|=)?[a-zA-Z'’\-]+\s*\)")


@dataclass(frozen=True, slots=True)
class Finding:
    category: str
    row: int
    rule: str
    detail: str
    aynu: str = ""
    fields: dict[str, str] = field(default_factory=dict)


def _all_data() -> dict[str, tuple[list[str], list[list[str]]]]:
    cats = [c["sheetName"] for c in glossary.list_categories() if c["isContent"]]
    return glossary._batch_read_tabs(cats)


def find_intransitive_with_n1(rows_by_cat: dict) -> list[Finding]:
    """Aynu cell with `N1 ... verb=an` — intransitive verb taking a direct-object N1."""
    out: list[Finding] = []
    for cat, (headers, rows) in rows_by_cat.items():
        if "Aynu" not in headers:
            continue
        ai = headers.index("Aynu")
        for i, row in enumerate(rows):
            aynu = row[ai] if ai < len(row) else ""
            if not aynu:
                continue
            # check each comma-alternative independently
            for form in aynu.split(","):
                f = form.strip()
                if _AN_VERB_WITH_N1.search(f):
                    # but allow `N1 <locative_noun> <postposition> verb=an`:
                    # spatial noun + postposition between N1 and verb
                    toks = f.split()
                    if len(toks) >= 4:
                        # heuristic: presence of any postposition between N1 and verb
                        if any(t in {"ta", "peka", "wa", "un", "or", "orowa", "pakno"} for t in toks[1:-1]):
                            continue
                    out.append(
                        Finding(
                            category=cat,
                            row=i + 2,
                            rule="intransitive_with_n1",
                            detail=f"`{f}` — `=an` is intransitive; N1 cannot be its direct object",
                            aynu=aynu,
                            fields=dict(zip(headers, row)),
                        )
                    )
                    break
    return out


def find_parens_in_text(rows_by_cat: dict, columns: tuple[str, ...] = ("日本語", "中文")) -> list[Finding]:
    """Parens in JA/中 columns — glossary convention forbids them."""
    out: list[Finding] = []
    for cat, (headers, rows) in rows_by_cat.items():
        col_idx = [(c, headers.index(c)) for c in columns if c in headers]
        if not col_idx:
            continue
        for i, row in enumerate(rows):
            for col, ci in col_idx:
                if ci >= len(row):
                    continue
                cell = row[ci]
                if _PAREN_JP.search(cell):
                    out.append(
                        Finding(
                            category=cat,
                            row=i + 2,
                            rule="parens_in_text",
                            detail=f"`{col}` contains parens: {cell!r}",
                            aynu=row[headers.index("Aynu")] if "Aynu" in headers else "",
                            fields=dict(zip(headers, row)),
                        )
                    )
    return out


def find_transitivity_mismatch(rows_by_cat: dict) -> list[Finding]:
    """Aynu has `N1`/`N2` but JA gloss never mentions N1/N2 (or vice versa).

    Indicates the gloss doesn't reflect the verb's frame.
    """
    out: list[Finding] = []
    for cat, (headers, rows) in rows_by_cat.items():
        if "Aynu" not in headers or "日本語" not in headers:
            continue
        ai = headers.index("Aynu")
        ji = headers.index("日本語")
        for i, row in enumerate(rows):
            if ai >= len(row) or ji >= len(row):
                continue
            aynu = row[ai]
            jp = row[ji]
            if not aynu or not jp:
                continue
            aynu_has_n = bool(_N1_TOKEN.search(aynu))
            jp_has_n = bool(_N1_TOKEN.search(jp))
            if aynu_has_n and not jp_has_n:
                out.append(
                    Finding(
                        category=cat,
                        row=i + 2,
                        rule="transitivity_mismatch_aynu_has_n_jp_doesnt",
                        detail=f"Aynu mentions N-arg but JA doesn't — JA: {jp!r}",
                        aynu=aynu,
                        fields=dict(zip(headers, row)),
                    )
                )
            elif jp_has_n and not aynu_has_n:
                out.append(
                    Finding(
                        category=cat,
                        row=i + 2,
                        rule="transitivity_mismatch_jp_has_n_aynu_doesnt",
                        detail=f"JA mentions N-arg but Aynu doesn't — Aynu: {aynu!r}",
                        aynu=aynu,
                        fields=dict(zip(headers, row)),
                    )
                )
    return out


def find_duplicate_aynu(rows_by_cat: dict) -> list[Finding]:
    """Same Aynu form appears in 2+ categories — sometimes intentional (verb/noun
    pair), often an oversight."""
    index: dict[str, list[tuple[str, int, dict]]] = defaultdict(list)
    for cat, (headers, rows) in rows_by_cat.items():
        if "Aynu" not in headers:
            continue
        ai = headers.index("Aynu")
        for i, row in enumerate(rows):
            aynu = row[ai] if ai < len(row) else ""
            if not aynu:
                continue
            # normalise: strip whitespace, lowercase first alternative
            key = aynu.split(",")[0].strip().lower()
            if not key:
                continue
            index[key].append((cat, i + 2, dict(zip(headers, row))))
    out: list[Finding] = []
    for key, hits in index.items():
        cats = {h[0] for h in hits}
        if len(cats) < 2:
            continue
        # Only flag if JA glosses are also very similar — true accidental dupes.
        # Cross-category placement (verb in general_verb + noun in computer_noun)
        # is intentional and shouldn't be flagged.
        jas = [(h[2].get("日本語") or "").strip() for h in hits]
        nonempty = [j for j in jas if j]
        if len(set(nonempty)) > 1:
            continue  # different glosses → intentional polysemy across cats
        for cat, row_no, fields in hits:
            others = sorted({(h[0], h[1]) for h in hits if (h[0], h[1]) != (cat, row_no)})
            out.append(
                Finding(
                    category=cat,
                    row=row_no,
                    rule="duplicate_aynu_across_categories",
                    detail=f"`{key}` also appears at: " + ", ".join(f"{c} row {r}" for c, r in others),
                    aynu=key,
                    fields=fields,
                )
            )
    return out


def find_aynu_with_parens(rows_by_cat: dict) -> list[Finding]:
    """Disabled per user decision — all Aynu paren patterns are intentional
    dictionary-style notation (morphological suffixes like `topa(ha)`, variant
    spellings like `tumpu (tunpu)`, uncertainty marks like `asur(kampi?)`,
    nested templates like `(anak(ne))`, inline trilingual comments in
    interjections, etc.). The check stays as a no-op so the audit shape is
    stable, but never returns findings."""
    return []


def run_all() -> dict[str, Any]:
    """Run every audit check; return findings grouped by rule + summary counts."""
    rows = _all_data()
    checks = [
        ("intransitive_with_n1", find_intransitive_with_n1),
        ("parens_in_text", find_parens_in_text),
        ("transitivity_mismatch", find_transitivity_mismatch),
        ("duplicate_aynu_across_categories", find_duplicate_aynu),
        ("aynu_has_parens", find_aynu_with_parens),
    ]
    by_rule: dict[str, list[dict[str, Any]]] = {}
    for name, fn in checks:
        findings = fn(rows)
        by_rule[name] = [
            {
                "category": f.category,
                "row": f.row,
                "rule": f.rule,
                "detail": f.detail,
                "aynu": f.aynu,
                "fields": f.fields,
            }
            for f in findings
        ]
    summary = {k: len(v) for k, v in by_rule.items()}
    summary["total"] = sum(summary.values())
    return {"summary": summary, "findings": by_rule}
