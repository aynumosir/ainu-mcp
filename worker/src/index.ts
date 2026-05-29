/**
 * Entry point: the OAuth 2.1 provider wraps the MCP endpoints.
 *
 * `/mcp` (Streamable HTTP) and `/sse` (legacy SSE) are the MCP transports —
 * both gated behind GitHub OAuth. Unauthenticated requests get a 401 pointing
 * at the OAuth metadata, which MCP clients (Claude, ChatGPT connectors, …)
 * follow to run the "Sign in with GitHub" browser flow. The user's identity is
 * delivered to the MCP Durable Object as `this.props`.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { AinuMCP } from "./mcp.js";
import { GitHubHandler } from "./github-handler.js";

export { AinuMCP };

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": AinuMCP.serve("/mcp") as never,
    "/sse": AinuMCP.serveSSE("/sse") as never,
  },
  defaultHandler: GitHubHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
