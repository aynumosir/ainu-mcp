"""FastMCP server exposing Ainu-language editing and reference tools."""

from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import audit, corpus, dictionaries, gaps, glossary, grammar, research, script, site_cache

mcp = FastMCP("ainu-mcp")


# ──────────────────────────── Glossary (write side) ──────────────────────────── #

@mcp.tool()
def glossary_list_categories() -> list[dict[str, Any]]:
    """List every category (sheet tab) in the Itak-uoeroskip glossary, including
    metadata (description, entry count, sheet gid). Use this first to discover
    what categories exist before searching or adding entries."""
    return glossary.list_categories()


@mcp.tool()
def glossary_list_entries(
    category: str,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Page through entries in a category. Returns headers, total row count,
    and a slice of entries (each with row number and row_hash for safe editing)."""
    return glossary.list_entries(category, limit=limit, offset=offset)


@mcp.tool()
def glossary_get_entry(category: str, row: int) -> dict[str, Any]:
    """Fetch one glossary entry by category + 1-indexed sheet row (row 1 is the
    header, so the first data row is 2). Returns fields and a row_hash to pass
    to glossary_update_entry for optimistic-locking safety."""
    return glossary.get_entry(category, row)


@mcp.tool()
def glossary_search(
    query: str,
    fields: list[str] | None = None,
    category: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Substring-search the glossary. Optionally restrict to specific columns
    (`fields`) or one category. Returns matching entries with row numbers and
    row_hashes."""
    return glossary.search(query, fields=fields, category=category, limit=limit)


@mcp.tool()
def glossary_add_entry(category: str, fields: dict[str, str]) -> dict[str, Any]:
    """Append a new entry to a category tab. `fields` keys must match the tab's
    column headers (e.g., `Aynu`, `日本語`, `English`, `中文`, `註 / Notes`);
    unknown keys are silently ignored. Returns the new row number and row_hash."""
    return glossary.add_entry(category, fields)


@mcp.tool()
def glossary_update_entry(
    category: str,
    row: int,
    fields: dict[str, str],
    expected_row_hash: str | None = None,
) -> dict[str, Any]:
    """Update specific cells in an existing row. If `expected_row_hash` is
    supplied (recommended — get it from glossary_get_entry/search) and the row
    has changed in the sheet since you read it, the update is refused so you can
    re-read and re-decide."""
    return glossary.update_entry(category, row, fields, expected_row_hash=expected_row_hash)


@mcp.tool()
def glossary_untranslated(
    category: str | None = None,
    langs: list[str] | None = None,
    require_aynu: bool = True,
    limit: int = 200,
) -> dict[str, Any]:
    """Find rows where one or more of the target language columns is empty.

    `langs` defaults to `['日本語', 'English', '中文']`. Rows missing the Aynu
    cell are skipped by default (you can't translate from nothing). Use this
    to enumerate translation gaps before drafting fills. Result is grouped by
    category; each entry includes its `row`, `row_hash` (for safe updates),
    `missing` column list, and full current `fields`."""
    return glossary.untranslated(
        category, langs=langs, require_aynu=require_aynu, limit=limit
    )


# ──────────────────────────── Reference (read side) ──────────────────────────── #

@mcp.tool()
def corpus_search(
    query: str,
    lang: Literal["ain", "jpn", "any"] = "any",
    dialect: str | None = None,
    author: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Search ~195k aligned Ainu/Japanese sentences from ainu-corpora for
    example usages. `lang='ain'` matches the Ainu text, `'jpn'` the translation,
    `'any'` either. Filter by `dialect` substring (e.g., '樺太', '沙流') or
    `author`. Returns text + translation + source metadata."""
    return corpus.search(query, lang=lang, dialect=dialect, author=author, limit=limit)


@mcp.tool()
def corpus_stats() -> dict[str, Any]:
    """Return total sentence count and top dialect distribution in the corpus."""
    return corpus.stats()


@mcp.tool()
def dictionary_list() -> list[dict[str, Any]]:
    """List every dictionary in the ainu-dictionaries collection with entry counts."""
    return dictionaries.list_dictionaries()


@mcp.tool()
def dictionary_lookup(
    word: str,
    dicts: list[str] | None = None,
    fields: list[str] | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Look up a word across one or more Ainu dictionaries (Kayano, Tamura,
    Chiri, Nakagawa, Ota, Tane, Wiktionary, etc.). `dicts` filters to specific
    dictionary names from dictionary_list; `fields` restricts which columns
    to search within (default: all). For a clean Ainu → Japanese/English
    lookup specifically, prefer `dictionary_reverse_lookup`."""
    return dictionaries.lookup(word, dicts=dicts, fields=fields, limit=limit)


@mcp.tool()
def dictionary_reverse_lookup(
    aynu: str,
    dicts: list[str] | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Look up an Aynu form across every dictionary's lemma index — returns
    Japanese/English definitions for that exact Ainu word. Exact matches first,
    then substring matches. Use this when you know the Aynu form and want all
    glosses (Ota in particular only exposes meanings through this surface)."""
    return dictionaries.reverse_lookup(aynu, dicts=dicts, limit=limit)


@mcp.tool()
def grammar_list(kind: Literal["books", "articles"] | None = None) -> list[dict[str, Any]]:
    """List grammar materials (books and/or articles) with year, author, title
    parsed from filenames where possible."""
    return grammar.list_materials(kind=kind)


@mcp.tool()
def grammar_search(
    query: str,
    include_transcribed: bool = True,
    limit: int = 30,
) -> dict[str, Any]:
    """Search grammar materials: substring-match filenames/titles/authors, and
    (when `include_transcribed=True`) also fulltext-grep any transcribed
    markdown/text under the grammar repo. Returns filename hits and snippet hits
    separately."""
    return grammar.search_materials(query, include_transcribed=include_transcribed, limit=limit)


# ──────────────────────────── Script utilities ──────────────────────────── #

@mcp.tool()
def convert_script(
    text: str,
    from_script: Literal["latn", "kana", "cyrl"],
    to_script: Literal["latn", "kana", "cyrl"],
) -> str:
    """Convert Ainu text between Latin, Katakana, and Cyrillic scripts (via ainconv)."""
    return script.convert(text, from_script, to_script)


@mcp.tool()
def detect_script(text: str) -> str:
    """Detect the script of an Ainu string. Returns one of `latn`, `kana`, `cyrl`."""
    return script.detect_script(text)


@mcp.tool()
def script_all(text: str) -> dict[str, Any]:
    """Detect the input's script and return its renditions in all three scripts."""
    return script.all_scripts(text)


# ──────────────────────────── Composed ──────────────────────────── #

@mcp.tool()
def glossary_audit() -> dict[str, Any]:
    """Run all inconsistency checks across the glossary. Reports per-rule
    findings: intransitive verbs taking N1 directly, parens in JA/中, Aynu/JA
    transitivity mismatches, duplicate Aynu forms across categories, parens
    inside Aynu cells. Returns a summary + the full finding list grouped by
    rule."""
    return audit.run_all()


@mcp.tool()
def glossary_missing_high_frequency(
    top_n: int = 200, min_count: int = 20
) -> list[dict[str, Any]]:
    """Surface vocabulary gaps: Ainu tokens that appear ≥ `min_count` times in
    the corpus, are attested in at least one dictionary, and aren't yet in the
    glossary. Returns top-N candidates with frequency, attesting dictionaries,
    and a sample sentence for each — use as a worklist for new entries."""
    return gaps.missing_high_frequency(top_n=top_n, min_count=min_count)


@mcp.tool()
def glossary_refresh_site_cache(dry_run: bool = False) -> dict[str, Any]:
    """Rebuild and upload `table.json` and `sheets.json` to the Cloudflare R2
    bucket the itak.aynu.org website reads from. Call this after edits to make
    changes live without waiting for the weekly cron. With `dry_run=True`,
    builds payloads and reports sizes without uploading. Requires the
    PRIVATE_CLOUDFLARE_R2_S3_* env vars."""
    return site_cache.refresh_site_cache(dry_run=dry_run)


@mcp.tool()
def entry_research(
    word: str,
    corpus_limit: int = 8,
    dict_limit: int = 12,
    glossary_limit: int = 10,
) -> dict[str, Any]:
    """One-shot lookup composing: script conversions + syllable separation +
    existing glossary entries + multi-dictionary lookups + corpus examples.
    Call this when drafting a new glossary entry or vetting an existing one —
    one call returns everything needed to make a high-quality edit."""
    return research.entry_research(
        word,
        corpus_limit=corpus_limit,
        dict_limit=dict_limit,
        glossary_limit=glossary_limit,
    )


def run() -> None:
    mcp.run()


if __name__ == "__main__":
    run()
