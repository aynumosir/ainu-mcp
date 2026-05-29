/**
 * Shared types for the Ainu MCP Worker.
 *
 * `@cloudflare/workers-types` provides D1Database / R2Bucket / KVNamespace /
 * DurableObjectNamespace as globals, so they need no import here.
 */

export interface Env {
  // Bindings (wrangler.jsonc)
  DB: D1Database;
  SITE_CACHE: R2Bucket;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;

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
