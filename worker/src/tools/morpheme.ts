/**
 * Morpheme / lexeme tools — thin proxies to the Ainu Morpheme Database explorer
 * (ainu-mdb / mdb.aynu.org) over a service binding (env.MDB). The decomposition
 * + valency engine and the data live there; this just exposes them as MCP tools
 * so callers don't need a second copy of the engine or the data.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { jsonResult, errorResult, fetchJson } from "./helpers.js";

const MDB = "https://mdb.aynu.org";

export function registerMorphemeTools(server: McpServer, env: Env): void {
  server.tool(
    "morpheme_decompose",
    "Decompose an Ainu word into morphemes via the Ainu Morpheme Database (mdb.aynu.org). mode='nested' returns the bracketed tree with effective valency at every node; 'flat' returns the ordered leaf morphemes; 'first' returns only the immediate constituents. Known lemmas resolve directly; unknown forms fall back to best-effort greedy-longest segmentation — check `source`/`unseen`/`unresolved` before trusting an unknown split.",
    {
      form: z.string(),
      mode: z.enum(["nested", "flat", "first"]).default("nested"),
    },
    async ({ form, mode }) => {
      try {
        const data = await fetchJson(
          env.MDB,
          `${MDB}/api/decompose?form=${encodeURIComponent(form)}&mode=${mode}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`morpheme_decompose failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "morpheme_search",
    "Search the Ainu morpheme inventory (mdb.aynu.org) by lemma, allomorph, or gloss (English/Japanese). Returns category, morph_type, glosses, corpus frequency and verified flag, ranked verified-first.",
    {
      query: z.string(),
      limit: z.number().int().default(30),
    },
    async ({ query, limit }) => {
      try {
        const data = await fetchJson(
          env.MDB,
          `${MDB}/api/morphemes?q=${encodeURIComponent(query)}&limit=${limit}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`morpheme_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "lexeme_search",
    "Search the Ainu lexeme bank (語彙素層, mdb.aynu.org) by lemma, kana, or gloss. Returns POS, glosses, attesting dialects, recording count and linked morpheme ids.",
    {
      query: z.string(),
      limit: z.number().int().default(30),
    },
    async ({ query, limit }) => {
      try {
        const data = await fetchJson(
          env.MDB,
          `${MDB}/api/lexemes?q=${encodeURIComponent(query)}&limit=${limit}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`lexeme_search failed: ${(e as Error).message}`);
      }
    },
  );
}
