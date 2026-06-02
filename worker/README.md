# ainu-mcp-worker

The **hosted** edition of the Ainu MCP server: a Cloudflare Worker that exposes
the full toolchain over the network, gated behind **GitHub OAuth**. It runs
entirely on Cloudflare's **free tier**.

- **Auth:** any GitHub user who signs in gets the read/reference tools; members
  of the **`aynumosir`** org (or anyone in `ALLOWED_USERS`) additionally get the
  glossary **write + maintenance** tools.
- **Data:** corpus / dictionaries / grammar live in **D1** (SQLite) with FTS5
  **trigram** indexes for fast, indexed substring search. Seeded from the same
  source repos via `etl/build_d1.py` — no logic is re-implemented.
- **Glossary:** read/write straight against the Google Sheet via the Sheets REST
  API (service-account JWT signed with Web Crypto — no Google SDK).
- **Site cache:** `glossary_refresh_site_cache` writes `table.json`/`sheets.json`
  to the bound R2 bucket the website reads.
- **Scripts:** `ainconv` (npm) runs natively in the Worker.

Architecture: `MCP client → Worker (OAuth 2.1 provider, "Sign in with GitHub",
aynumosir org check) → AinuMCP Durable Object (SQLite-backed, free-tier) → D1 /
Sheets / R2`.

## Why this is free

| Resource | Free-plan allowance | Our usage |
| --- | --- | --- |
| Workers requests | 100k/day | tiny |
| Durable Objects (SQLite) | 5 GB, no SQLite-storage charge | one object class |
| D1 storage | 5 GB total, 10 GB/db | ~a few hundred MB |
| D1 rows read | 5M/day | FTS keeps reads ≈ matches+LIMIT |
| D1 rows written | **100k/day** | only matters at **seed** time (see below) |
| KV | 100k reads/day | OAuth tokens |
| R2 | 10 GB + 1M/10M ops/mo | occasional cache publish |

## One-time setup

Prereqs: a Cloudflare account, `bun install` in this directory, and
`bunx wrangler login`.

### 1. Create a GitHub App

GitHub's recommended path (fine-grained permissions, expiring tokens). GitHub →
Settings → Developer settings → **GitHub Apps** → New GitHub App.

- **Homepage URL:** `https://ainu-mcp.<your-subdomain>.workers.dev`
- **Callback URL:** `https://ainu-mcp.<your-subdomain>.workers.dev/callback`
  (also add `http://localhost:8788/callback` for local dev)
- **Webhook:** uncheck **Active** (not used).
- **Permissions → Organization → Members:** **Read-only** (to verify aynumosir membership).
- **Permissions → Account → Email addresses:** Read-only (optional — for the user's email).
- Create the app, note the **Client ID**, and generate a **client secret**.
- **Install** the app on the **`aynumosir`** organization (org owner action). This
  is what makes the membership check authoritative, including for members whose
  org membership is private.

The Worker uses GitHub's user-authorization (OAuth) flow, which is identical for a
GitHub App and a classic OAuth App — so the same `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` secrets are used either way. (If you ever swap to an OAuth
App instead, the only difference is you'd request the `read:org` scope rather than
granting the App the Members permission; the code handles both.)

### 2. Create the Cloudflare resources

```bash
bunx wrangler kv namespace create OAUTH_KV   # → copy id into wrangler.jsonc
bunx wrangler d1 create ainu-mcp             # → copy database_id into wrangler.jsonc
# R2: use the EXISTING itak.aynu.org cache bucket; set its name in wrangler.jsonc
```

Edit `wrangler.jsonc`: replace `<REPLACE_WITH_KV_NAMESPACE_ID>`,
`<REPLACE_WITH_D1_DATABASE_ID>`, and the R2 `bucket_name`.

### 3. Set secrets

```bash
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put COOKIE_ENCRYPTION_KEY      # openssl rand -hex 32
bunx wrangler secret put GOOGLE_SA_CLIENT_EMAIL     # ainu-glossary@…iam.gserviceaccount.com
bunx wrangler secret put GOOGLE_SA_PRIVATE_KEY      # the full PEM (paste, incl. BEGIN/END)
```

The service account needs **Editor** on the glossary sheet for the write tools.

### 4. Build + load the D1 data

```bash
# from the repo root — reuses the Python loaders to emit worker/seed/data/*.sql
AINU_ROOT=/path/to/Ainu uv run python etl/build_d1.py

cd worker
bunx wrangler d1 migrations apply ainu-mcp --remote
# then apply the seed files (see seed/MANIFEST.txt for the exact list/order):
#   wrangler d1 execute ainu-mcp --remote --file=seed/data/<file>.sql
```

> **Free-plan seed note:** the seed writes ~284k dictionary rows + ~284k FTS
> rows + ~195k corpus rows, while D1 free allows 100k row-writes/day. Either
> apply the chunks over several days (order in `seed/MANIFEST.txt`;
> `dict_entries_*` must precede `dict_fts_*`), or enable Workers Paid for the
> seed window and downgrade after — runtime is free either way. `--local` dev has
> no such limit.

### 5. Deploy

```bash
bunx wrangler deploy
```

## Caveats

- **Search ≥3 chars is indexed; 1–2 chars is a scan.** FTS5 trigram needs ≥3
  characters, so 1–2-char substring searches fall back to a `LIKE`/`instr` scan
  of the table. These are bounded by the result `limit` but can read many rows;
  prefer ≥3-char queries. (Faithful to the Python substring semantics.)
- **D1 size.** Trigram indexes over the corpus, every dictionary field, and the
  OCR grammar transcripts are sizeable; after seeding, confirm the database fits
  your account's D1 per-database limit (`PRAGMA page_count * page_size`). Comfortably
  within the 5 GB free allowance in practice.
- **`dictionary_lookup` with a `fields` filter** pages the trigram candidates and
  confirms per-field, so results match the Python full-scan; very high-frequency
  substrings just read more pages.

## Connect an MCP client

Add the server URL to your client (Claude Desktop/Code, ChatGPT connectors, …):

```
https://ainu-mcp.<your-subdomain>.workers.dev/mcp
```

The client opens a browser for "Sign in with GitHub" once, then stores the token
and uses every tool transparently. Org members additionally see the write tools.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in
bunx wrangler d1 migrations apply ainu-mcp --local
# apply a seed subset locally, then:
bun run dev
```

## Layout

```
worker/
  src/
    index.ts            OAuth provider wiring (the entry point)
    github-handler.ts   GitHub OAuth + aynumosir org-membership check
    mcp.ts              AinuMCP Durable Object; least-privilege tool registration
    auth.ts             org-member guard for write tools
    db.ts               D1 query helpers (FTS5 trigram substring search)
    sheets.ts           Google Sheets v4 REST + service-account JWT (Web Crypto)
    tools/              one module per tool group (faithful ports of ainu_mcp/*)
  migrations/0001_init.sql       D1 schema (FTS5 trigram + precomputed aggregates)
  migrations/0002_frequency.sql  token_freq + stopwords tables (word-frequency tools)
  seed/                          generated by etl/build_d1.py (gitignored)
```
