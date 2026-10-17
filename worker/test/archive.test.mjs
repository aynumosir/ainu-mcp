/**
 * Archive helper tests — assertion signing and image byte caps only, no network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins DOM/Workers types that
 * make a .ts test fail to resolve `bun:test`.
 */
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { test, expect } from "bun:test";
import { assertImageSizeCap, buildArchiveAssertion, registerArchiveTools } from "../src/tools/archive.ts";

test("buildArchiveAssertion signs the raw JSON assertion bytes", async () => {
  const secret = "test-secret";
  const actor = "archive-user";
  const now = 1_755_000_123;
  const nonce = "fixed-nonce";
  const expectedJson = `{"caller":"mcp","actor":"${actor}","ts":${now},"nonce":"${nonce}"}`;

  const headers = await buildArchiveAssertion(secret, actor, now, nonce);
  expect(Buffer.from(headers.assertionHeader, "base64").toString("utf8")).toBe(expectedJson);
  expect(headers.signatureHeader).toMatch(/^[0-9a-f]{64}$/);

  const expectedSignature = createHmac("sha256", secret).update(expectedJson, "utf8").digest("hex");
  expect(headers.signatureHeader).toBe(expectedSignature);
});

test("assertImageSizeCap accepts image sizes below the 2 MB cap", () => {
  expect(() => assertImageSizeCap(2 * 1024 * 1024 - 1)).not.toThrow();
});

test("assertImageSizeCap accepts the exact 2 MB boundary", () => {
  // The cap is inclusive: exactly 2 MB is accepted.
  expect(() => assertImageSizeCap(2 * 1024 * 1024)).not.toThrow();
});

test("assertImageSizeCap rejects image sizes over the 2 MB cap", () => {
  expect(() => assertImageSizeCap(2 * 1024 * 1024 + 1)).toThrow(/2097153 bytes.*2 MB/);
});

function registerWith(fetchImpl, isOrgMember = true) {
  const tools = new Map();
  const server = { tool: (name, _d, _s, handler) => tools.set(name, handler) };
  const calls = [];
  const env = {
    ASSERTION_KEY_MCP: "k",
    SOURCES: {
      fetch: async (req) => {
        calls.push(req);
        return fetchImpl(req);
      },
    },
  };
  registerArchiveTools(server, env, { login: "octocat", isOrgMember });
  return { tools, calls };
}

const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("registers the five tools ainu-sources can serve to an assertion caller", () => {
  const { tools } = registerWith(() => json({}));
  expect([...tools.keys()].sort()).toEqual([
    "source_file_info",
    "source_file_list",
    "source_file_page_image",
    "source_file_search",
    "source_file_text",
  ]);
});

test("requests are signed with assertion headers and use the documented query names", async () => {
  const { tools, calls } = registerWith(() => json({ items: [] }));
  await tools.get("source_file_search")({ query: "kamuy", source_slug: "s1", max_chars: 200 });
  const url = new URL(calls[0].url);
  expect(url.pathname).toBe("/api/archive/search");
  expect(url.searchParams.get("q")).toBe("kamuy");
  expect(url.searchParams.get("source_slug")).toBe("s1");
  expect(url.searchParams.get("max_chars")).toBe("200");
  expect(calls[0].headers.get("X-Archive-Assertion")).toBeTruthy();
  expect(calls[0].headers.get("X-Archive-Signature")).toMatch(/^[0-9a-f]{64}$/);
});

test("source_file_text resolves file_id to currentRevisionId before fetching text", async () => {
  const { tools, calls } = registerWith((req) =>
    new URL(req.url).pathname === "/api/archive/files/f1" ? json({ currentRevisionId: "r9" }) : json({ pages: [] }),
  );
  await tools.get("source_file_text")({ file_id: "f1", pages: "1-2" });
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/archive/files/f1", "/api/archive/revisions/r9/text"]);
  expect(new URL(calls[1].url).searchParams.has("max_chars")).toBe(false);
});

test("source_file_text reports a file without a current revision", async () => {
  const { tools } = registerWith(() => json({ currentRevisionId: null }));
  const res = await tools.get("source_file_text")({ file_id: "f1" });
  expect(res.isError).toBe(true);
});

test("per-source listing drops the cursor the route ignores; the catalogue keeps it", async () => {
  const { tools, calls } = registerWith(() => json({}));
  await tools.get("source_file_list")({ source_slug: "s1", cursor: "c", include_history: false });
  await tools.get("source_file_list")({ cursor: "c", include_history: false });
  expect(new URL(calls[0].url).searchParams.has("cursor")).toBe(false);
  expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("c");
});

test("non-members are refused before any upstream call", async () => {
  const { tools, calls } = registerWith(() => json({}), false);
  const res = await tools.get("source_file_info")({ revision_id: "r1" });
  expect(res.isError).toBe(true);
  expect(calls.length).toBe(0);
});
