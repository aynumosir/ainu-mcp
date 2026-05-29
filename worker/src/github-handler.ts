/**
 * GitHub OAuth handler for the OAuth provider's non-API routes (/authorize,
 * /callback). Authenticates the user with GitHub, determines whether they are a
 * member of ALLOWED_ORG (or listed in ALLOWED_USERS), and hands the resulting
 * identity to the OAuth provider as `props`.
 *
 * Access model:
 *   - Any GitHub user who authenticates → read/reference tools.
 *   - aynumosir org members (+ ALLOWED_USERS) → also glossary write + maintenance.
 */
import { Hono } from "hono";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env, Props } from "./types.js";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
// read:org is required so we can read the user's (possibly private) org membership.
const SCOPES = "read:user read:org user:email";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

function encodeState(info: AuthRequest): string {
  return btoa(JSON.stringify(info)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeState(raw: string): AuthRequest {
  return JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
}

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) return c.text("Invalid OAuth request", 400);

  const redirectUri = new URL("/callback", c.req.url).href;
  const u = new URL(GITHUB_AUTHORIZE);
  u.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", encodeState(oauthReqInfo));
  return Response.redirect(u.href, 302);
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateRaw = c.req.query("state");
  if (!code || !stateRaw) return c.text("Missing code/state", 400);

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = decodeState(stateRaw);
  } catch {
    return c.text("Malformed state", 400);
  }
  if (!oauthReqInfo.clientId) return c.text("Malformed state", 400);

  // Exchange the GitHub code for a GitHub access token.
  const redirectUri = new URL("/callback", c.req.url).href;
  const tokenResp = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = (await tokenResp.json()) as { access_token?: string; error?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) return c.text(`GitHub OAuth failed: ${tokenData.error ?? "no access_token"}`, 401);

  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "ainu-mcp-worker",
      },
    });

  const userResp = await gh("/user");
  if (!userResp.ok) return c.text("Failed to fetch GitHub user", 401);
  const user = (await userResp.json()) as { login: string; name?: string };

  let email = "";
  try {
    const emails = (await (await gh("/user/emails")).json()) as { email: string; primary: boolean }[];
    email = emails.find((e) => e.primary)?.email ?? emails[0]?.email ?? "";
  } catch {
    /* email scope optional */
  }

  // ALLOWED_USERS fallback, then live org-membership check (active only).
  const allowedUsers = c.env.ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  let isOrgMember = allowedUsers.includes(user.login);
  if (!isOrgMember && c.env.ALLOWED_ORG) {
    const m = await gh(`/user/memberships/orgs/${c.env.ALLOWED_ORG}`);
    if (m.ok) {
      const membership = (await m.json()) as { state?: string };
      isOrgMember = membership.state === "active";
    }
  }

  const props: Props = {
    login: user.login,
    name: user.name ?? user.login,
    email,
    accessToken,
    isOrgMember,
  };

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: user.login,
    metadata: { label: user.login },
    scope: oauthReqInfo.scope,
    props,
  });
  return Response.redirect(redirectTo, 302);
});

export const GitHubHandler = app;
