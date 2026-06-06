# ainu-mcp-worker

The **hosted** edition of the Ainu MCP server: a Cloudflare Worker that exposes
the full toolchain over the network, gated behind **GitHub OAuth**. It runs
entirely on Cloudflare's **free tier**.

- **Auth:** any GitHub user who signs in gets the read/reference tools; members
  of the **`aynumosir`** org (or anyone in `ALLOWED_USERS`) additionally get the
  glossary **write + maintenance** tools.
- **Data:** corpus / dictionaries / grammar / frequency live in **Turso**
  (libSQL) with FTS5 **trigram** indexes for fast, indexed substring search,
  reached through a small libSQL shim (`src/libsql.ts`). Seeded from the same
  source repos via `etl/build_d1.py` — no logic is re-implemented. (Moved off
  Cloudflare D1, which capped a Free-plan database at ~500 MB.)
- **Glossary:** read/write straight against the Google Sheet via the Sheets REST
  API (service-account JWT signed with Web Crypto — no Google SDK).
- **Site cache:** `glossary_refresh_site_cache` writes `table.json`/`sheets.json`
  to the bound R2 bucket the website reads.
- **Scripts:** `ainconv` (npm) runs natively in the Worker.

Architecture: `MCP client → Worker (OAuth 2.1 provider, "Sign in with GitHub",
aynumosir org check) → AinuMCP Durable Object (SQLite-backed, free-tier) →
Turso (reference data) / Sheets / R2`.

## Hosting cost

The Worker itself runs on Cloudflare's **free tier** (Workers requests, Durable
Objects, KV for OAuth tokens, R2 for the site cache are all comfortably within
free allowances). The **reference data lives in Turso** (libSQL) on a paid plan —
it outgrew D1's Free-plan ~500 MB per-database cap (the store is ~615 MB, mostly
FTS5 trigram indexes). The Worker uses a **read-only** Turso token.

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
turso db create ainu-mcp --group default     # the reference store (libSQL)
# R2: use the EXISTING itak.aynu.org cache bucket; set its name in wrangler.jsonc
```

Edit `wrangler.jsonc`: replace `<REPLACE_WITH_KV_NAMESPACE_ID>` and the R2
`bucket_name`. (There is no D1 binding — the reference store is Turso, reached
via the `DATABASE_URL` / `DATABASE_AUTH_TOKEN` secrets below.)

### 3. Set secrets

```bash
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put COOKIE_ENCRYPTION_KEY      # openssl rand -hex 32
bunx wrangler secret put GOOGLE_SA_CLIENT_EMAIL     # ainu-glossary@…iam.gserviceaccount.com
bunx wrangler secret put GOOGLE_SA_PRIVATE_KEY      # the full PEM (paste, incl. BEGIN/END)
bunx wrangler secret put SOURCES_WRITE_TOKEN        # shared secret for source_add/source_update; set the SAME value on the ainu-sources Worker
bunx wrangler secret put DATABASE_URL               # Turso: turso db show ainu-mcp --url
bunx wrangler secret put DATABASE_AUTH_TOKEN         # Turso READ-ONLY token: turso db tokens create ainu-mcp --read-only
```

The service account needs **Editor** on the glossary sheet for the write tools.
`SOURCES_WRITE_TOKEN` authorizes the `source_add`/`source_update` tools' calls to
the ainu-sources write API — generate one (`openssl rand -hex 32`) and set the
identical value here and on the `ainu-sources` Worker. `DATABASE_URL` /
`DATABASE_AUTH_TOKEN` point the Worker at the Turso reference store (a read-only
token suffices — the Worker only reads it).

### 4. Build + load the reference data (Turso)

```bash
# from the repo root — reuses the Python loaders to emit worker/seed/data/*.sql
AINU_ROOT=/path/to/Ainu uv run python etl/build_d1.py

cd worker
# apply the schema, then load the seed via the batched libSQL loader:
turso db shell ainu-mcp < migrations/0001_init.sql
turso db shell ainu-mcp < migrations/0002_frequency.sql
turso db shell ainu-mcp < migrations/0003_localizations.sql
TURSO_DATABASE_URL=$(turso db show ainu-mcp --url) \
TURSO_AUTH_TOKEN=$(turso db tokens create ainu-mcp) \
  bun scripts/load-turso.mjs seed/reset.sql $(grep -oE 'seed/data/[A-Za-z0-9_./-]+\.sql' seed/MANIFEST.txt)
```

> **Why the loader, not `turso db shell < seed`?** The shell drops its HTTP
> stream on the large seed files, and `turso db create --from-file` 502s on the
> ~600 MB `.db`. `scripts/load-turso.mjs` executes the SQL as batched
> transactions (robust) and sanity-checks the row counts. `dict_entries_*` must
> precede `dict_fts_*` — `seed/MANIFEST.txt` already records that order.

### 5. Deploy

```bash
bunx wrangler deploy
```

## Caveats

- **Search ≥3 chars is indexed; 1–2 chars is a scan.** FTS5 trigram needs ≥3
  characters, so 1–2-char substring searches fall back to a `LIKE`/`instr` scan
  of the table. These are bounded by the result `limit` but can read many rows;
  prefer ≥3-char queries. (Faithful to the Python substring semantics.)
- **Store size.** Trigram indexes over the corpus, every dictionary field, and
  the OCR grammar transcripts are sizeable (~615 MB) — which is why the reference
  store is **Turso**, not D1 (D1's Free-plan per-database cap is ~500 MB).
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

## Health check

`GET /health` (no auth) is a liveness/readiness probe for uptime monitors. It
pings the Turso reference store with a cheap precomputed-`meta` lookup and returns
JSON:

```
200  {"status":"ok","store":"turso","data_loaded":true}        reachable + seeded
503  {"status":"degraded","store":"turso","data_loaded":false}  reachable, not seeded
503  {"status":"error","store":"turso"}                          unreachable
```

The response carries no error detail (a libSQL failure can echo the database
URL); the cause is logged server-side only.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in, incl. DATABASE_URL / DATABASE_AUTH_TOKEN
# `wrangler dev` reads the Turso reference store directly via those vars (point
# them at the live DB, or a throwaway you seed with scripts/load-turso.mjs):
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
    db.ts               query helpers (FTS5 trigram substring search)
    libsql.ts           libSQL-backed D1-shaped shim → Turso (env.DB)
    sheets.ts           Google Sheets v4 REST + service-account JWT (Web Crypto)
    tools/              one module per tool group (faithful ports of ainu_mcp/*)
  scripts/load-turso.mjs         batched libSQL loader (seed → Turso; used by CI)
  migrations/0001_init.sql       schema (FTS5 trigram + precomputed aggregates), applied to Turso
  migrations/0002_frequency.sql  token_freq + stopwords tables (word-frequency tools)
  seed/                          generated by etl/build_d1.py (gitignored)
```
