/**
 * Morphology proxy tests — the pure query-encoding/mapping logic for the two
 * MDB /api/forms proxy tools (morphology_search, morphology_reverse_lookup),
 * plus a mocked-fetchJson shape assertion. No network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins types that make a .ts test
 * fail to resolve `bun:test`.
 */
import { test, expect } from "bun:test";
import { searchUrl, reverseUrl } from "../src/tools/morphology.ts";

test("searchUrl sends q + limit, targeting MDB /api/forms", () => {
  expect(searchUrl({ query: "sapa", limit: 20 })).toBe(
    "https://mdb.aynu.org/api/forms?q=sapa&limit=20",
  );
});

test("searchUrl maps the human category to the upstream `relation` facet", () => {
  const params = new URL(searchUrl({ query: "san", category: "plural", limit: 5 })).searchParams;
  expect(params.get("q")).toBe("san");
  expect(params.get("relation")).toBe("plural");
  // It must NOT send `category` (that upstream facet is the domain nominal|verbal).
  expect(params.get("category")).toBeNull();
  expect(params.get("limit")).toBe("5");
});

test("searchUrl omits category when unset", () => {
  const url = searchUrl({ query: "ipe", limit: 10 });
  expect(url).not.toContain("relation=");
  expect(url).not.toContain("category=");
});

test("searchUrl percent-encodes the query", () => {
  const url = searchUrl({ query: "a=e hotke", limit: 20 });
  expect(url).toContain("q=a%3De+hotke");
  expect(new URL(url).searchParams.get("q")).toBe("a=e hotke");
});

test("reverseUrl sends lemma (exact) + limit", () => {
  expect(reverseUrl({ base: "hotke", limit: 20 })).toBe(
    "https://mdb.aynu.org/api/forms?lemma=hotke&limit=20",
  );
});

test("reverseUrl maps the human category to the upstream `relation` facet", () => {
  const params = new URL(reverseUrl({ base: "sapa", category: "possessed", limit: 7 })).searchParams;
  expect(params.get("lemma")).toBe("sapa");
  expect(params.get("relation")).toBe("possessed");
  expect(params.get("category")).toBeNull();
  expect(params.get("limit")).toBe("7");
});

test("reverseUrl percent-encodes the base lemma", () => {
  const url = reverseUrl({ base: "kor pe", limit: 30 });
  expect(url).toContain("lemma=kor+pe");
  expect(new URL(url).searchParams.get("lemma")).toBe("kor pe");
});

// ── mocked-fetchJson shape: the tools return the {query,total,returned,results}
// envelope verbatim, wrapped as an MCP text-content block. We drive the proxy
// through a fake env.MDB Fetcher so no real network is hit.
test("proxy returns the upstream {query,total,returned,results} envelope", async () => {
  const { fetchJson } = await import("../src/tools/helpers.ts");
  const envelope = {
    query: "sapa",
    total: 1,
    returned: 1,
    results: [
      { lemma_id: "sapa", surface: "sapaha", source: "exception", confidence: 0.95 },
    ],
  };
  let seenUrl = "";
  const env = {
    MDB: {
      fetch: async (req) => {
        seenUrl = req.url;
        return new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
  const data = await fetchJson(env.MDB, reverseUrl({ base: "sapa", limit: 20 }));
  expect(seenUrl).toBe("https://mdb.aynu.org/api/forms?lemma=sapa&limit=20");
  expect(data).toEqual(envelope);
});
