# Refreshing the D1 reference data

The hosted MCP serves two kinds of data:

| Data | Source at runtime | Freshness |
| --- | --- | --- |
| **Glossary** (`glossary_*`, `entry_research`) | **live Google Sheets** every call | always current — no scheduler needed |
| **Corpus / dictionaries / grammar / vocab** | **D1** (`worker/migrations` + `worker/seed`) | a snapshot built by `etl/build_d1.py` |

Only the D1 snapshot can go stale. It changes only when the upstream
[`aynumosir/ainu-corpora`](https://github.com/aynumosir/ainu-corpora),
[`aynumosir/ainu-dictionaries`](https://github.com/aynumosir/ainu-dictionaries),
and [`aynumosir/ainu-grammar`](https://github.com/aynumosir/ainu-grammar) repos
do. The [`refresh-reference-data`](../.github/workflows/refresh-reference-data.yml)
workflow keeps it current automatically.

## What the workflow does

Monthly (and on demand), it:

1. Clones the three private data repos.
2. Builds `ainu-corpora/data.jsonl` with the Rust builder (`cargo run`) — that
   file is a build artifact, not committed.
3. Runs the Python ETL (`etl/build_d1.py`) to regenerate `worker/seed/`.
4. **Validates** the built data (aborts if the corpus or seed is implausibly
   small — so a broken upstream build can never wipe the live DB).
5. Clears the reference tables (`worker/seed/reset.sql`) and re-applies the
   fresh seed **in place** — the `database_id` never changes, so the live
   Worker keeps reading the same DB with no redeploy.
6. Sanity-checks row counts afterward.

A full rebuild is **~1.5M D1 row-writes** (clear + reload). That exceeds the
Free plan's 100k writes/day cap, so **Workers Paid is required** — the metered
cost of a monthly reseed is effectively $0 (well within the 50M/month included),
leaving only the ~$5/month plan base.

> **In-place reseed window.** While step 5 runs (a few minutes, monthly, at
> ~03:30 JST), reference-data searches may return partial/empty results. The
> glossary is unaffected (it's live from Sheets). If a run fails midway, just
> re-run it — the reset+reload is idempotent and brings the DB back to a clean
> state.

## One-time setup

### 1. Enable Workers Paid

In the Cloudflare dashboard: **Workers & Pages → Plans → Workers Paid**. Without
it the reseed will fail once the daily 100k-write cap is hit.

### 2. Add three GitHub Actions secrets

**Repo → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token | Permissions: **Account → D1 → Edit**. Nothing else is needed (no Workers deploy — the reseed is in-place). |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Dashboard URL, or `wrangler whoami`. |
| `DATA_REPOS_TOKEN` | A token that can **read** the three private data repos | A fine-grained PAT (Contents: Read on the three repos) or a GitHub App installation token. The default `GITHUB_TOKEN` can't reach other repos. |

### 3. (Optional) Refresh on upstream push

To rebuild as soon as a data repo changes instead of waiting for the monthly
run, add a tiny workflow to each upstream repo that fires a `repository_dispatch`
at this repo:

```yaml
# in aynumosir/ainu-corpora (and ainu-dictionaries, ainu-grammar)
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
            https://api.github.com/repos/aynumosir/ainu-mcp-full/dispatches \
            -d '{"event_type":"upstream-data-changed"}'
```

(`AINU_MCP_DISPATCH_TOKEN` = a token with `Contents: write` / `repository_dispatch`
on this repo.)

## Running it manually

**Repo → Actions → Refresh D1 reference data → Run workflow.** Use this after a
known upstream update, or to recover from a failed run.

## If you ever need to rebuild from empty

The workflow assumes the schema already exists (migrations applied). For a
brand-new database, apply the migration first, then the workflow's reseed will
populate it:

```bash
cd worker
bunx wrangler d1 migrations apply ainu-mcp --remote
```
