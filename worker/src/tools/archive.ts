/**
 * Archive-file tools — thin proxies to the archive control plane in
 * ainu-sources (db.aynu.org) over the SOURCES service binding. ainu-mcp signs
 * each request with an actor assertion; archive storage credentials stay owned
 * by the upstream services.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../types.js";
import { jsonResult, errorResult } from "./helpers.js";
import { requireOrgMember } from "../auth.js";

const SOURCES = "https://db.aynu.org";
const IMAGE_SIZE_CAP_BYTES = 2 * 1024 * 1024;

export async function buildArchiveAssertion(
  secret: string,
  actor: string,
  now: number,
  nonce: string,
): Promise<{ assertionHeader: string; signatureHeader: string }> {
  const payload = { caller: "mcp", actor, ts: now, nonce };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return {
    assertionHeader: bytesToBase64(bytes),
    signatureHeader: bytesToHex(new Uint8Array(signature)),
  };
}

// The cap is inclusive: an image that is exactly 2 MB is accepted.
export function assertImageSizeCap(bytes: number): void {
  if (bytes > IMAGE_SIZE_CAP_BYTES) {
    throw new Error(`archive page image is ${bytes} bytes, over the 2 MB limit`);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function pathWithQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

async function signedArchiveFetch(
  env: Env,
  actor: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { assertionHeader, signatureHeader } = await buildArchiveAssertion(
    env.ASSERTION_KEY_MCP,
    actor,
    Math.floor(Date.now() / 1000),
    crypto.randomUUID(),
  );
  const headers = new Headers(init.headers);
  headers.set("X-Archive-Assertion", assertionHeader);
  headers.set("X-Archive-Signature", signatureHeader);

  const res = await env.SOURCES.fetch(new Request(`${SOURCES}${path}`, { ...init, headers }));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res;
}

async function signedArchiveJson(
  env: Env,
  actor: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await signedArchiveFetch(env, actor, path, init);
  return res.json();
}

export function registerArchiveTools(server: McpServer, env: Env, props: Props): void {
  server.tool(
    "source_file_list",
    "List archived files from db.aynu.org, either for one source slug or across the archive catalogue. Returns file/revision metadata from the ainu-sources archive control plane; get source slugs from sources_search.",
    {
      source_slug: z.string().optional().describe("source slug from sources_search or source_get"),
      role: z.string().optional().describe("archive file role, passed through when supplied"),
      cursor: z.string().optional().describe("pagination cursor returned by a previous archive listing"),
      include_history: z.boolean().default(false).describe("include non-current revision history when the control plane supports it"),
    },
    async ({ source_slug, role, cursor, include_history }) => {
      try {
        requireOrgMember(props, "source_file_list");
        const path = source_slug
          ? pathWithQuery(`/api/archive/sources/${encodeURIComponent(source_slug)}/files`, {
              cursor,
              role,
              include_history,
            })
          : pathWithQuery("/api/archive/files", { cursor, role, include_history });
        const data = await signedArchiveJson(env, props.login, path);
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_file_list failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_file_info",
    "Fetch metadata for one archived file revision from db.aynu.org. Returns review state, media details, page count, source linkage, and human download metadata from the archive control plane.",
    {
      revision_id: z.string(),
    },
    async ({ revision_id }) => {
      try {
        requireOrgMember(props, "source_file_info");
        const data = await signedArchiveJson(
          env,
          props.login,
          `/api/archive/revisions/${encodeURIComponent(revision_id)}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_file_info failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_file_text",
    "Fetch OCR or extracted text for one archived file revision from db.aynu.org, resolving file_id to the current approved revision when revision_id is absent. When text coverage is absent, the upstream result may point to source_file_page_image alternatives.",
    {
      file_id: z.string().optional().describe("archive file id resolved to its current approved revision when revision_id is absent"),
      revision_id: z.string().optional().describe("archive revision id from source_file_list or source_file_info"),
      variant: z.string().optional().describe("text variant such as OCR or normalized text, passed through when supplied"),
      pages: z.string().optional().describe("page selector passed through to the control plane when supplied"),
      cursor: z.string().optional().describe("pagination cursor returned by a previous text response"),
      max_chars: z.number().int().positive().optional().describe("maximum text characters requested from the control plane"),
    },
    async ({ file_id, revision_id, variant, pages, cursor, max_chars }) => {
      try {
        requireOrgMember(props, "source_file_text");
        if (!revision_id) {
          if (!file_id) return errorResult("source_file_text failed: revision_id is required.");
          const file = (await signedArchiveJson(
            env,
            props.login,
            `/api/archive/files/${encodeURIComponent(file_id)}`,
          )) as { currentRevisionId?: unknown };
          if (typeof file.currentRevisionId !== "string" || file.currentRevisionId.length === 0) {
            return errorResult(
              "source_file_text failed: file has no current (approved) revision, so there is no text to fetch.",
            );
          }
          revision_id = file.currentRevisionId;
        }
        const path = pathWithQuery(`/api/archive/revisions/${encodeURIComponent(revision_id)}/text`, {
          variant,
          pages,
          cursor,
          max_chars,
        });
        const data = await signedArchiveJson(env, props.login, path);
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_file_text failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_file_search",
    "Search OCR or extracted archive-file text in db.aynu.org. Returns whatever the archive control plane provides, with optional source_slug scoping and pagination through cursor.",
    {
      query: z.string(),
      source_slug: z.string().optional().describe("limit the search to one source slug when supported"),
      cursor: z.string().optional().describe("pagination cursor returned by a previous search response"),
      max_chars: z.number().int().positive().optional().describe("maximum snippet/text characters requested from the control plane"),
    },
    async ({ query, source_slug, cursor, max_chars }) => {
      try {
        requireOrgMember(props, "source_file_search");
        const path = pathWithQuery("/api/archive/search", { q: query, source_slug, cursor, max_chars });
        const data = await signedArchiveJson(env, props.login, path);
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_file_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_file_page_image",
    "Fetch one WebP page image for an archived file revision from db.aynu.org. Use source_file_info to get page counts and revision ids; responses over 2 MB are rejected.",
    {
      revision_id: z.string(),
      page: z.number().int().positive(),
    },
    async ({ revision_id, page }) => {
      try {
        requireOrgMember(props, "source_file_page_image");
        const res = await signedArchiveFetch(
          env,
          props.login,
          `/api/archive/revisions/${encodeURIComponent(revision_id)}/pages/${page}.webp`,
        );
        const contentLength = res.headers.get("content-length");
        if (contentLength) {
          const declaredBytes = Number(contentLength);
          if (Number.isFinite(declaredBytes)) assertImageSizeCap(declaredBytes);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        assertImageSizeCap(bytes.byteLength);
        return {
          content: [{ type: "image" as const, data: bytesToBase64(bytes), mimeType: "image/webp" }],
        };
      } catch (e) {
        return errorResult(`source_file_page_image failed: ${(e as Error).message}`);
      }
    },
  );
}
