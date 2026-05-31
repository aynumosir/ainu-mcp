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
import { LANDING_HTML, LLMS_TXT, renderErrorPage } from "./landing.js";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
// User-authorization (OAuth) flow — identical for a GitHub App and an OAuth App.
// For a GitHub App the `scope` value is IGNORED (permissions are configured on
// the App — grant Organization "Members: read"); the scope is kept here only for
// OAuth-App compatibility. read:org reads the user's (possibly private) membership.
const SCOPES = "read:user read:org user:email";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// Branded replacements for the Workers runtime's bare plaintext fallbacks.
// notFound: any unmatched human-facing route. onError: any uncaught exception
// (a thrown handler, an upstream GitHub fetch that rejects, …) — without this
// the runtime returns a plain "Internal Server Error".
app.notFound((c) =>
  c.html(
    renderErrorPage(404, "Page not found", "That path isn’t part of this server. The MCP endpoint lives at /mcp."),
    404,
  ),
);
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.html(
    renderErrorPage(500, "Something went wrong", "An unexpected error occurred on our side. Please try again in a moment."),
    500,
  );
});

// Public pages (everything else here is the OAuth flow).
app.get("/", (c) => c.html(LANDING_HTML));
app.get("/llms.txt", (c) => c.text(LLMS_TXT));

function encodeState(info: AuthRequest): string {
  return btoa(JSON.stringify(info)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeState(raw: string): AuthRequest {
  return JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
}

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId)
    return c.html(
      renderErrorPage(400, "Invalid sign-in request", "This authorization request is missing or malformed. Start the connection again from your MCP client."),
      400,
    );

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
  const badRequest = (detail: string) => c.html(renderErrorPage(400, "Sign-in could not complete", detail), 400);
  if (!code || !stateRaw)
    return badRequest("GitHub didn’t return the expected authorization code. Start the connection again from your MCP client.");

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = decodeState(stateRaw);
  } catch {
    return badRequest("The sign-in request expired or was tampered with. Start the connection again from your MCP client.");
  }
  if (!oauthReqInfo.clientId)
    return badRequest("The sign-in request expired or was tampered with. Start the connection again from your MCP client.");

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
  if (!accessToken)
    return c.html(
      renderErrorPage(401, "GitHub sign-in failed", "GitHub didn’t grant access. The link may have expired — start the connection again from your MCP client."),
      401,
    );

  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "ainu-mcp-worker",
      },
    });

  const userResp = await gh("/user");
  if (!userResp.ok)
    return c.html(
      renderErrorPage(401, "Couldn’t reach your GitHub account", "We signed you in but couldn’t read your GitHub profile. Please try connecting again."),
      401,
    );
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
    // Primary: the user's own membership record (state 'active' = a real member).
    const m = await gh(`/user/memberships/orgs/${c.env.ALLOWED_ORG}`);
    if (m.ok) {
      const membership = (await m.json()) as { state?: string };
      isOrgMember = membership.state === "active";
    }
    // Fallback: list the orgs visible to this token. A GitHub App user token can
    // only see orgs where the App is installed, so this covers installs where the
    // membership endpoint isn't reachable but the org is still listed.
    if (!isOrgMember) {
      const o = await gh(`/user/orgs`);
      if (o.ok) {
        const orgs = (await o.json()) as { login: string }[];
        const want = c.env.ALLOWED_ORG.toLowerCase();
        isOrgMember = orgs.some((org) => org.login.toLowerCase() === want);
      }
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
