# ainu-mcp

A hosted [Model Context Protocol](https://modelcontextprotocol.io) server for the
Ainu-language toolchain (`aynumosir/ainu-mcp`). It lets an LLM (Claude Code,
Claude Desktop, etc.):

- **Edit the [Itak-uoeroskip glossary](https://itak.aynu.org)** directly in its
  Google Sheets source of truth — search, add, and update entries from chat.
- **Reference all the other Ainu materials** in one place — search ~195 k
  aligned corpus sentences, look up words across 11 dictionaries, scan the
  grammar bibliography, and convert between Latin/Katakana/Cyrillic scripts.
- **Research an entry in one call** — `entry_research(word)` composes all of
  the above into a single structured response, so the model can draft a
  well-grounded glossary entry without round-tripping.

## How this repo is laid out

There is **one** MCP server — the hosted Cloudflare Worker — and a Python ETL
that feeds it. (An earlier local stdio server was retired; the Worker is now the
single MCP surface.)

| Part | What it is |
| --- | --- |
| [`worker/`](worker/) | The MCP server: a Cloudflare Worker (Streamable-HTTP MCP) at **`mcp.aynu.org`**, GitHub-OAuth gated, reading a **D1** (FTS5 trigram) reference store. See [`worker/README.md`](worker/README.md) for the deploy guide. |
| `src/ainu_mcp/` + [`etl/build_d1.py`](etl/build_d1.py) | The Python ETL: corpus / dictionary / grammar / glossary **loaders** that bake the reference data into the Worker's D1. Not a server. |

**Access model:** any GitHub user who authenticates gets the read/reference
tools; members of the **`aynumosir`** org (or anyone in `ALLOWED_USERS`)
additionally get the glossary **write + maintenance** tools. Non-members never
see the write tools at all.

## Connecting

The server speaks Streamable-HTTP MCP and authenticates over GitHub OAuth (your
client opens a browser the first time).

Project-scoped (`.mcp.json` in any project where you want it available — this is
what this repo ships):

```json
{
  "mcpServers": {
    "ainu": {
      "type": "http",
      "url": "https://mcp.aynu.org/mcp"
    }
  }
}
```

Or user-scoped — add the same block to `~/.claude.json` under `mcpServers`.

## Building / refreshing the reference data

The corpus, dictionaries, and grammar tables in D1 are built by the Python ETL,
which the Worker only reads. To rebuild the seed:

Requires **Python ≥ 3.13** and [`uv`](https://github.com/astral-sh/uv).

```bash
uv sync
AINU_ROOT=/home/mkpoli/projects/Ainu uv run python etl/build_d1.py
```

`AINU_ROOT` (default `/home/mkpoli/projects/Ainu`) must contain:

- `ainu-corpora/data.jsonl`
- `ainu-dictionaries/<dict-name>/*.tsv`
- `ainu-grammar/{books,articles}/...`

The seed is applied to D1 with `wrangler d1 execute` (see
[`docs/REFRESHING-DATA.md`](docs/REFRESHING-DATA.md)). A scheduled GitHub Action
([`refresh-reference-data.yml`](.github/workflows/refresh-reference-data.yml))
rebuilds and reseeds D1 monthly. The live glossary is read straight from Google
Sheets, so glossary edits do not depend on this refresh.

## Tool surface

### Glossary (read + write — the editing loop)

| Tool | Purpose |
| --- | --- |
| `glossary_list_categories` | List sheet tabs with description and entry count |
| `glossary_list_entries(category, limit, offset)` | Page through entries in a category |
| `glossary_get_entry(category, row)` | Read one entry (returns `row_hash` for safe editing) |
| `glossary_search(query, fields?, category?, limit?)` | Substring search; optionally scoped to columns / one category |
| `glossary_add_entry(category, fields)` | Append a new row |
| `glossary_update_entry(category, row, fields, expected_row_hash?)` | Update cells, with optimistic locking |
| `glossary_untranslated(category?, langs?, limit?)` | Find rows missing 日本語/English/中文 — translation worklist |
| `glossary_audit()` | Find inconsistencies: `=an + N1`, parens, transitivity mismatch, duplicates, …  |
| `glossary_missing_high_frequency(top_n?, min_count?)` | Frequent corpus tokens that are dictionary-attested but not in glossary — vocab-gap worklist |
| `glossary_refresh_site_cache(dry_run?)` | Republish `table.json`/`sheets.json` to Cloudflare R2 so itak.aynu.org reflects edits immediately (instead of waiting for the weekly cron) |

Write + maintenance tools (`glossary_add_entry`, `glossary_update_entry`,
`glossary_audit`, `glossary_missing_high_frequency`,
`glossary_refresh_site_cache`) are only available to `aynumosir` org members.

Optimistic locking: pass the `row_hash` you got from `glossary_get_entry` or
`glossary_search` as `expected_row_hash` when updating. If someone else edited
the row since, the update is refused — re-read and retry.

### Reference (corpus, dictionaries, grammar)

| Tool | Purpose |
| --- | --- |
| `corpus_search(query, lang, dialect?, author?, limit?)` | Search aligned Ainu/Japanese sentences (`lang`: `ain`, `jpn`, `any`) |
| `corpus_stats` | Total sentences + top dialect distribution |
| `dictionary_list` | List dictionaries with entry counts |
| `dictionary_lookup(word, dicts?, fields?, limit?)` | Multi-dictionary lookup (any field; supports substring) |
| `dictionary_reverse_lookup(aynu, dicts?, limit?)` | Ainu → Japanese/English by exact lemma first then substring; Ota's reverse index included |
| `grammar_list(kind?)` | List grammar books / articles |
| `grammar_search(query, include_transcribed?, limit?)` | Filename/title/author search + fulltext over transcribed sources |

### Script conversion

| Tool | Purpose |
| --- | --- |
| `convert_script(text, from, to)` | Convert between `latn` / `kana` / `cyrl` |
| `detect_script(text)` | Detect script of a string |
| `script_all(text)` | Return all three script renditions in one call |

### Composed

| Tool | Purpose |
| --- | --- |
| `entry_research(word, ...)` | One-shot: scripts + syllables + glossary hits + dictionary hits + corpus examples |

## Example session

Typical edit flow Claude would run:

1. `entry_research("kunne")` → see existing dictionary defs, corpus contexts, current glossary entries
2. `glossary_search("kunne")` → confirm the row(s) and grab `row_hash`
3. `glossary_update_entry("色", 47, {"English": "black"}, expected_row_hash="…")`

For the full editing convention (transitivity, gloss style, sources), see
[`AGENTS.md`](AGENTS.md).
