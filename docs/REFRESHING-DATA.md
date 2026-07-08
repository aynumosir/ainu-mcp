# Refreshing the reference data

The hosted MCP serves two kinds of data:

| Data | Source at runtime | Freshness |
| --- | --- | --- |
| **Glossary** (`glossary_*`, `entry_research`) | **live Google Sheets** every call | always current — no scheduler needed |
| **Corpus / dictionaries / grammar / frequency / localizations** | **Turso** (libSQL; schema in `worker/migrations`, data built into `worker/seed`) | a snapshot built by `etl/build_d1.py` |

The **localization** tables (`l10n_*`) are gathered from public GitHub message
catalogues (inlang / next-intl / MediaWiki) by `src/ainu_mcp/localizations.py`,
so they refresh on the same monthly cycle — no clone needed.

The reference store is **Turso** (libSQL) — it moved off Cloudflare D1 when the
D1 Free-plan per-database size cap (~500 MB) blocked writes at ~615 MB. The
Worker reads it through a libSQL shim (`worker/src/libsql.ts`).

Only the Turso snapshot can go stale. It changes when the upstream
[`aynumosir/ainu-corpora`](https://github.com/aynumosir/ainu-corpora),
[`aynumosir/ainu-dictionaries`](https://github.com/aynumosir/ainu-dictionaries),
and [`aynumosir/ainu-grammar`](https://github.com/aynumosir/ainu-grammar) repos do; when the vendored `src/ainu_mcp/data/authored_grammar_texts.json` snapshot is updated from `aynumosir/ainu-grammar-hokkaido` / `mkpoli/ainu-itah`; or when any of the localization upstreams gathered by
`src/ainu_mcp/localizations.py` (the `l10n_*` tables) change. The
[`refresh-reference-data`](../.github/workflows/refresh-reference-data.yml)
workflow keeps it current automatically on the same monthly cycle.

## Project-authored grammar fast refresh

For pushes to `ainu-grammar-hokkaido` or `aynu-itah`, use the smaller authored-grammar refresh path documented in [`AUTHORED-GRAMMAR-REFRESH.md`](AUTHORED-GRAMMAR-REFRESH.md). It updates only the vendored authored grammar snapshot and the `hokkaido`/`sakhalin` rows in Turso, rather than rebuilding the full corpus/dictionary reference store.

## What the workflow does

Monthly (and on demand), it:

1. Clones the private data repos. The public authored Hokkaido/Sakhalin grammar text comes from the committed snapshot unless those sibling repos are present locally.
2. Builds `ainu-corpora/data.jsonl` with the Rust builder (`cargo run`) — that
   file is a build artifact, not committed.
3. Runs the Python ETL (`etl/build_d1.py`) to regenerate `worker/seed/`.
4. **Validates** the built data (aborts if the corpus or seed is implausibly
   small — so a broken upstream build can never wipe the live DB).
5. Clears the reference tables (`worker/seed/reset.sql`) and re-applies the
   fresh seed **in place**, via the batched libSQL loader
   (`worker/scripts/load-turso.mjs`) — the same Turso DB, so the live Worker
   keeps reading it with no redeploy.
6. The loader sanity-checks row counts afterward (aborts if they look wrong).

> **Why a loader, not `turso db shell`?** `turso db shell < bigfile.sql` drops
> its HTTP stream on the large seed files (`error 404: stream not found`), and
> `turso db create --from-file` 502s on the ~600 MB `.db`. The loader executes
> quote-aware statements in batched transactions, which is robust. FTS5 `trigram`
> works on Turso.

> **In-place reseed window.** While step 5 runs (a few minutes, monthly, at
> ~03:30 JST), reference-data searches may return partial/empty results. The
> glossary is unaffected (it's live from Sheets). If a run fails midway, just
> re-run it — reset+reload brings the DB back to a clean state.

## One-time setup

### Add the GitHub Actions secrets

**Repo → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | The `libsql://ainu-mcp-…turso.io` URL | `turso db show ainu-mcp --url`. |
| `TURSO_AUTH_TOKEN` | A **write** token for the Turso DB | `turso db tokens create ainu-mcp` (the Worker itself uses a separate **read-only** token). |
| `DATA_REPOS_TOKEN` | A token that can **read** the three private data repos | A fine-grained PAT (Contents: Read on the three repos) or a GitHub App installation token. The default `GITHUB_TOKEN` can't reach other repos. |

### (Optional) Refresh on upstream push

To rebuild as soon as a data repo changes instead of waiting for the monthly
run, add a tiny workflow to each upstream repo that fires a `repository_dispatch`
at this repo:

```yaml
# in aynumosir/ainu-corpora (and ainu-dictionaries, ainu-grammar; update this repo’s authored_grammar_texts.json snapshot when grammar-site source changes)
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
            -d '{"event_type":"upstream-data-changed"}'
```

(`AINU_MCP_DISPATCH_TOKEN` = a token with `Contents: write` / `repository_dispatch`
on this repo.)

## Running it manually

**Repo → Actions → Refresh Turso reference data → Run workflow.** Use this after
a known upstream update, or to recover from a failed run. (Run it manually once
after first setting the secrets, to confirm the end-to-end path.)

## If you ever need to rebuild from empty

The workflow assumes the schema already exists. For a brand-new Turso database,
create it and apply the migrations first, then the workflow's reseed populates it:

```bash
turso db create ainu-mcp --group default
turso db shell ainu-mcp < worker/migrations/0001_init.sql
turso db shell ainu-mcp < worker/migrations/0002_frequency.sql
turso db shell ainu-mcp < worker/migrations/0003_localizations.sql
turso db shell ainu-mcp < worker/migrations/0004_grammar_public_text.sql
```

You can also load the data locally without the workflow:

```bash
cd worker
TURSO_DATABASE_URL=$(turso db show ainu-mcp --url) \
TURSO_AUTH_TOKEN=$(turso db tokens create ainu-mcp) \
  bun scripts/load-turso.mjs seed/reset.sql $(grep -oE 'seed/data/[A-Za-z0-9_./-]+\.sql' seed/MANIFEST.txt)
```
