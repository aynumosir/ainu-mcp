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

1. chooses the changed source from `client_payload.repo` (`ainu-grammar-hokkaido` → `hokkaido`, `aynu-itah` → `sakhalin`), or `all` for manual runs;
2. clones only the selected grammar source repo(s);
3. regenerates and commits `authored_grammar_texts.json` if it changed, preserving the non-selected source from the existing snapshot;
4. builds `worker/seed/data/authored_grammar_refresh.sql` and applies the small authored-row refresh to Turso.

Manual run:

```bash
# Refresh both sources
gh workflow run "Refresh authored grammar text" --ref main -f source=all -f reason="grammar source update"

# Or refresh only one source
gh workflow run "Refresh authored grammar text" --ref main -f source=sakhalin -f reason="aynu-itah update"
gh workflow run "Refresh authored grammar text" --ref main -f source=hokkaido -f reason="ainu-grammar-hokkaido update"
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

- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`: write access to the Turso reference
  store.

It does not need `DATA_REPOS_TOKEN`; both authored grammar source repositories
are public and are cloned over unauthenticated HTTPS. Keep `DATA_REPOS_TOKEN` for
the full reference-data refresh if other private data repositories still need it.

## Why not update only one changed chapter?

The workflow updates one **source** at a time (`hokkaido` or `sakhalin`) when it can infer the source from the dispatch payload, but the generated SQL replaces all authored rows (`hokkaido` + `sakhalin`) from the combined snapshot. The authored grammar slice is small (~203 chapters; generated SQL ~3.6 MB), so replacing both authored sources in Turso is simpler and safer than diffing individual chapter slugs, deleted chapters, split large rows, and title/TOC metadata changes. It still avoids the expensive full corpus/dictionary rebuild.
