# D1 seed

The actual seed SQL (`data/*.sql`, `MANIFEST.txt`) is **generated, not
committed** — it's ~270 MB derived from the source data repos.

Build it from the repo root:

```bash
AINU_ROOT=/path/to/Ainu uv run python etl/build_d1.py
```

This reuses the Python loaders in `src/ainu_mcp/` (corpus, dictionaries,
grammar, gaps) so the hosted server serves byte-identical data, and writes:

- `data/corpus_*.sql` — corpus_fts rows (chunked at 50k)
- `data/dict_entries_*.sql` + `data/dict_fts.sql` — dictionary rows then the
  external-content FTS rebuild (apply entries **before** the rebuild)
- `data/dictionaries_list.sql` — per-dictionary counts
- `data/grammar_materials_0001.sql` + `data/grammar_fts_0001.sql`
- `data/vocab_candidates.sql` — precomputed gap candidates (count ≥ 5)
- `data/meta.sql` — precomputed corpus stats
- `MANIFEST.txt` — the exact apply order

Apply order matters (dict_entries → dict_fts). See `MANIFEST.txt`, and the
free-plan seed note in `../README.md`.
