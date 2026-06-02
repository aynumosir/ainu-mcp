/**
 * Shared types for the Ainu MCP Worker.
 *
 * `@cloudflare/workers-types` provides D1Database / R2Bucket / KVNamespace /
 * DurableObjectNamespace as globals, so they need no import here.
 */

export interface Env {
  // Reference store. NOT a Cloudflare D1 binding anymore — env.DB is a
  // libSQL-backed shim (see libsql.ts) pointed at Turso, set in mcp.ts init().
  // Typed as D1Database so the query layer (db.ts + tools) is unchanged.
  DB: D1Database;

  // Bindings (wrangler.jsonc)
  SITE_CACHE: R2Bucket;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;

  // Service bindings to sibling Aynu.org Workers (same account) — Worker-to-Worker,
  // no public hop. Their apps own the data + logic; we proxy read endpoints.
  MDB: Fetcher; // ainu-mdb — morpheme/lexeme explorer + decompose API (mdb.aynu.org)
  SOURCES: Fetcher; // ainu-sources — textual sources database (db.aynu.org)

  // Plain vars
  ALLOWED_ORG: string; // GitHub org whose members get write/maintenance tools
  ALLOWED_USERS: string; // comma-separated GitHub logins granted the same, in addition to the org
  GLOSSARY_SHEET_ID: string;

  // Secrets (wrangler secret put)
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  GOOGLE_SA_CLIENT_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  // Shared bearer secret for the ainu-sources write API (POST/PATCH /api/sources).
  // Must match `SOURCES_WRITE_TOKEN` on the ainu-sources Worker. Gates the
  // source_add / source_update tools' service-binding calls.
  SOURCES_WRITE_TOKEN: string;
  // Turso (libSQL) connection for the reference store (replaces the D1 binding).
  DATABASE_URL: string; // libsql://ainu-mcp-…turso.io
  DATABASE_AUTH_TOKEN: string;
}

/**
 * Per-connection identity, derived during the GitHub OAuth callback and carried
 * by the OAuth provider into every MCP request as `this.props`.
 *
 * Everyone who authenticates with GitHub gets the read/reference tools.
 * `isOrgMember` (aynumosir membership or an ALLOWED_USERS entry) additionally
 * unlocks the glossary write + maintenance tools.
 */
export type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
  isOrgMember: boolean;
};
