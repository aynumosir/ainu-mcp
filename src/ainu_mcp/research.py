"""Composed lookup: gather everything we know about a word in one call.

This is the killer tool — instead of Claude making 5 separate calls to draft a
glossary entry, it asks for `entry_research(word)` once and gets:

- All script renditions (Latin / Katakana / Cyrillic)
- Existing glossary entries (any category)
- Dictionary hits across all dictionaries
- Up to N corpus example sentences
"""

from __future__ import annotations

from typing import Any

from . import corpus, dictionaries, glossary, script


def entry_research(
    word: str,
    *,
    corpus_limit: int = 8,
    dict_limit: int = 12,
    glossary_limit: int = 10,
) -> dict[str, Any]:
    scripts = script.all_scripts(word)
    try:
        syllables = script.separate_syllables(scripts.get("latn", word))
    except Exception as e:
        syllables = [f"(error: {e})"]

    # build a set of query forms — Latin and Kana both useful for corpus/dict hits
    forms = {word, scripts.get("latn", ""), scripts.get("kana", "")} - {""}

    glossary_hits: list[dict[str, Any]] = []
    seen_rows: set[tuple[str, int]] = set()
    for form in forms:
        try:
            for hit in glossary.search(form, limit=glossary_limit):
                key = (hit["category"], hit["row"])
                if key in seen_rows:
                    continue
                seen_rows.add(key)
                glossary_hits.append(hit)
        except Exception as e:
            glossary_hits.append({"error": f"glossary search failed for '{form}': {e}"})

    dict_hits: list[dict[str, Any]] = []
    for form in forms:
        try:
            dict_hits.extend(dictionaries.lookup(form, limit=dict_limit))
        except Exception as e:
            dict_hits.append({"error": f"dictionary lookup failed for '{form}': {e}"})

    corpus_hits: list[dict[str, Any]] = []
    for form in forms:
        try:
            corpus_hits.extend(corpus.search(form, lang="ain", limit=corpus_limit))
        except Exception as e:
            corpus_hits.append({"error": f"corpus search failed for '{form}': {e}"})

    return {
        "query": word,
        "scripts": scripts,
        "syllables": syllables,
        "glossary": glossary_hits[:glossary_limit],
        "dictionaries": dict_hits[:dict_limit],
        "corpus": corpus_hits[:corpus_limit],
    }
