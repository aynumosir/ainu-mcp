# ainu-mcp-full

A unified [Model Context Protocol](https://modelcontextprotocol.io) server for the
Ainu-language toolchain (`aynumosir/ainu-mcp-full`). It lets an LLM (Claude Code,
Claude Desktop, etc.):

- **Edit the [Itak-uoeroskip glossary](https://itak.aynu.org)** directly in its
  Google Sheets source of truth — search, add, and update entries from chat.
- **Reference all the other Ainu materials** in one place — search ~195 k
  aligned corpus sentences, look up words across 11 dictionaries, scan the
  grammar bibliography, and convert between Latin/Katakana/Cyrillic scripts.
- **Research an entry in one call** — `entry_research(word)` composes all of
  the above into a single structured response, so the model can draft a
  well-grounded glossary entry without round-tripping.

## Setup

Requires **Python ≥ 3.13** and [`uv`](https://github.com/astral-sh/uv).

```bash
cd /home/mkpoli/projects/Ainu/ainu-mcp
uv sync
cp .env.example .env
# then edit .env with your real paths/credentials
```

### Google Sheets credentials

The glossary tools use the existing `ainu-glossary` service account.

1. Copy the service-account JSON file from the `ainu-glossary` project (the one
   referenced in `ainu-glossary/.env` as `PRIVATE_GOOGLE_APPLICATION_CREDENTIALS`).
2. Set `GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/that.json` in `.env`.
3. **Share the sheet with the service account as Editor** (the
   `ainu-glossary@ainu-glossary.iam.gserviceaccount.com` address) — it
   currently only has read access, since the website only reads. Without Editor,
   `glossary_add_entry` and `glossary_update_entry` will fail with a 403.

### Resource paths

`AINU_ROOT` (default `/home/mkpoli/projects/Ainu`) must contain:

- `ainu-corpora/data.jsonl`
- `ainu-dictionaries/<dict-name>/*.tsv`
- `ainu-grammar/{books,articles}/...`

If your layout differs, set `AINU_ROOT` accordingly.

## Wiring into Claude Code

Project-scoped (`.mcp.json` in any project where you want it available):

```json
{
  "mcpServers": {
    "ainu": {
      "command": "uv",
      "args": ["--directory", "/home/mkpoli/projects/Ainu/ainu-mcp", "run", "ainu-mcp"]
    }
  }
}
```

Or user-scoped — add the same block to `~/.claude.json` under `mcpServers`.

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
| `convert_script(text, from, to)` | Convert between `latn` / `kana` / `cyrl` (ainconv) |
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

## Development notes

- The corpus is held in process memory after first access (`functools.cache`).
  First `corpus_search` takes a few seconds; subsequent calls are fast.
- `ainconv` prints debug output to stdout; all calls are wrapped in a
  stdout-suppression context (`script._muted`) to keep MCP stdio clean.
- The Google Sheets client uses the full `spreadsheets` scope (not
  `spreadsheets.readonly` like the website), since this server writes.
