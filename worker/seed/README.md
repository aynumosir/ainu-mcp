# Reference-data seed (Turso)

The actual seed SQL (`data/*.sql`, `MANIFEST.txt`) is **generated, not
committed** — it's ~270 MB derived from the source data repos. It is loaded into
the **Turso** (libSQL) reference store via the batched loader
(`../scripts/load-turso.mjs`).

Build it from the repo root:

```bash
AINU_ROOT=/path/to/Ainu uv run python etl/build_d1.py
```

This reuses the Python loaders in `src/ainu_mcp/` (corpus, dictionaries,
grammar, gaps, stopwords) so the hosted server serves byte-identical data, and
writes:

- `data/corpus_*.sql` — corpus_fts rows (chunked at 50k)
- `data/dict_entries_*.sql` + `data/dict_fts.sql` — dictionary rows then the
  external-content FTS rebuild (apply entries **before** the rebuild)
- `data/dictionaries_list.sql` — per-dictionary counts
- `data/grammar_materials_0001.sql` + `data/grammar_fts_0001.sql` — legacy grammar snippets plus public authored Hokkaido/Sakhalin chapter text
- `data/stopwords.sql` — Ainu stopword list (from `aynumosir/ainu-stopwords`)
- `data/token_freq_*.sql` — every corpus token with its count + stopword flag
- `data/vocab_candidates.sql` — precomputed gap candidates (count ≥ 5)
- `data/meta.sql` — precomputed corpus stats + token totals
- `MANIFEST.txt` — the exact apply order

Apply order matters (dict_entries → dict_fts) — `MANIFEST.txt` records it, and
the loader applies files in the given order. See `../README.md` (§4) and
`docs/REFRESHING-DATA.md` for the load commands.
