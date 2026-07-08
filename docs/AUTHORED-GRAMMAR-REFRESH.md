# Refreshing project-authored grammar text

The MCP grammar surface includes full plain text for two project-authored grammar
sites:

- `aynumosir/ainu-grammar-hokkaido` → `source: hokkaido`, `kind: hokkaido_grammar`
- `mkpoli/ainu-itah` → `source: sakhalin`, `kind: sakhalin_grammar`

The hosted Worker reads these from Turso tables (`grammar_materials` and
`grammar_fts`). To keep the normal monthly reference-data refresh self-contained,
this repo also commits a compact snapshot:

```text
src/ainu_mcp/data/authored_grammar_texts.json
```

When either grammar site changes, use the small authored-grammar refresh workflow
instead of the full corpus/dictionary/grammar reseed.

## Local update path

From this repo, with sibling source checkouts under `AINU_ROOT`:

```bash
AINU_ROOT=/home/mkpoli/projects/Ainu \
  uv run python scripts/update_authored_grammar_snapshot.py

uv run python scripts/build_authored_grammar_seed.py

cd worker
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  bun scripts/load-turso.mjs seed/data/authored_grammar_refresh.sql
```

`build_authored_grammar_seed.py` creates SQL that only replaces rows whose
`source` is `hokkaido` or `sakhalin`; it does **not** touch corpus, dictionaries,
legacy OCR grammar, token frequencies, or localizations.

## GitHub Actions update path

This repo has a dedicated workflow:

```text
.github/workflows/refresh-authored-grammar.yml
```

It does four things:

1. clones `aynumosir/ainu-grammar-hokkaido` and `mkpoli/ainu-itah`;
2. regenerates and commits `authored_grammar_texts.json` if it changed;
3. builds `worker/seed/data/authored_grammar_refresh.sql`;
4. applies the small authored-row refresh to Turso.

Manual run:

```bash
gh workflow run "Refresh authored grammar text" --ref main -f reason="grammar source update"
```

## Hooking upstream pushes

Add a repository-dispatch workflow to each upstream grammar repository.

### In `aynumosir/ainu-grammar-hokkaido`

```yaml
name: Notify ainu-mcp authored grammar refresh

on:
  push:
    branches: [main]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sf -X POST \
            -H "Authorization: Bearer ${{ secrets.AINU_MCP_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/aynumosir/ainu-mcp/dispatches \
            -d '{"event_type":"authored-grammar-changed","client_payload":{"repo":"ainu-grammar-hokkaido"}}'
```

### In `mkpoli/ainu-itah`

```yaml
name: Notify ainu-mcp authored grammar refresh

on:
  push:
    branches: [main]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sf -X POST \
            -H "Authorization: Bearer ${{ secrets.AINU_MCP_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/aynumosir/ainu-mcp/dispatches \
            -d '{"event_type":"authored-grammar-changed","client_payload":{"repo":"aynu-itah"}}'
```

`AINU_MCP_DISPATCH_TOKEN` should be a fine-grained token with permission to
create `repository_dispatch` events on `aynumosir/ainu-mcp` (Contents: write is
sufficient for repository dispatch on fine-grained tokens).

## Secrets required in `aynumosir/ainu-mcp`

The authored-grammar refresh workflow needs:

- `DATA_REPOS_TOKEN`: can read private `aynumosir/ainu-grammar-hokkaido` and the
  normal private data repos.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`: write access to the Turso reference
  store.

## Why not update only one changed chapter?

Possible, but not currently worth the complexity. The authored grammar slice is
small (~203 chapters; generated SQL ~3.6 MB). Replacing all `hokkaido`/`sakhalin`
rows is simple, deterministic, and avoids diffing chapter slugs, deleted
chapters, split large rows, and title/TOC metadata changes.
