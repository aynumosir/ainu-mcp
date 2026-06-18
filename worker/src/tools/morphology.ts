/**
 * Morphology tools — thin proxies to the Ainu Morpheme Database forms engine
 * (ainu-mdb / mdb.aynu.org) over a service binding (env.MDB). The generative
 * possessed/plural/derivation engine and the data live there; this just exposes
 * it as MCP tools so callers don't need a second copy of the engine or the data.
 *
 * Two views over the same /api/forms endpoint: `morphology_search` finds forms
 * by surface form / decomposition / lemma (substring); `morphology_reverse_lookup`
 * goes the other way — from a base lemma to the forms built on it. The third tool,
 * `morphology_forms`, lives in morpheme.ts (registerMorphemeTools) and also proxies
 * /api/forms (lemma-exact, with the full filter set).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { jsonResult, errorResult, fetchJson } from "./helpers.js";

const MDB = "https://mdb.aynu.org";

/**
 * Build the MDB `/api/forms` search URL (substring `q`). Pure (no network) so the
 * .mjs test can assert the encoding/omission rules without a service binding.
 * The human `category` ('possessed' | 'plural' | 'derived') maps to the upstream
 * `relation` facet — NOT the upstream `category` (which is the domain
 * 'nominal' | 'verbal'). Only non-empty filters are appended; `limit` is always sent.
 */
export function searchUrl(params: { query: string; category?: string; limit: number }): string {
  const q = new URLSearchParams();
  q.set("q", params.query);
  if (params.category) q.set("relation", params.category);
  q.set("limit", String(params.limit));
  return `${MDB}/api/forms?${q.toString()}`;
}

/**
 * Build the MDB `/api/forms` reverse-lookup URL (exact `lemma`). Pure (no network).
 * The tool `base` is the base lemma (exact lemma_id match — the reverse-lookup
 * intent). The human `category` maps to the upstream `relation` facet, as in
 * searchUrl. Only non-empty filters are appended; `limit` is always sent.
 */
export function reverseUrl(params: { base: string; category?: string; limit: number }): string {
  const q = new URLSearchParams();
  q.set("lemma", params.base);
  if (params.category) q.set("relation", params.category);
  q.set("limit", String(params.limit));
  return `${MDB}/api/forms?${q.toString()}`;
}

export function registerMorphologyTools(server: McpServer, env: Env): void {
  server.tool(
    "morphology_search",
    "Search Ainu morphology — generated/curated possessed, plural and derived forms — via the Ainu Morpheme Database forms engine (mdb.aynu.org/api/forms). `query` matches the surface form, its analysis/decomposition, OR the lemma at once (substring, case-insensitive). Optionally filter by `category` ('possessed' | 'plural' | 'derived'). The engine is hybrid + provenanced: every form is tagged `source` ('rule' | 'attested' | 'exception') + `confidence`; a `source='rule'` form with no `attested_ref` is predicted-but-unattested (flagged). Returns the {query,total,returned,results} envelope; each result carries the surface form, analysis, feature_bundle, rule_id, source and confidence. To go from a base lemma to its forms instead, use morphology_reverse_lookup.",
    {
      query: z.string(),
      category: z.enum(["possessed", "plural", "derived"]).optional(),
      limit: z.number().int().default(20),
    },
    async ({ query, category, limit }) => {
      try {
        const data = await fetchJson(env.MDB, searchUrl({ query, category, limit }));
        return jsonResult(data);
      } catch (e) {
        return errorResult(`morphology_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "morphology_reverse_lookup",
    "Given an Ainu base lemma, return the possessed/plural/derived forms built on it via the Ainu Morpheme Database forms engine (mdb.aynu.org/api/forms). `base` is matched EXACTLY against each form's `lemma_id`, so it won't over-match a substring of a longer lemma. Optionally filter by `category` ('possessed' | 'plural' | 'derived'). Same hybrid + provenanced output as morphology_search (every form tagged `source`/`confidence`; a `source='rule'` form with no `attested_ref` is predicted-but-unattested). Returns the {query,total,returned,results} envelope.",
    {
      base: z.string(),
      category: z.enum(["possessed", "plural", "derived"]).optional(),
      limit: z.number().int().default(20),
    },
    async ({ base, category, limit }) => {
      try {
        const data = await fetchJson(env.MDB, reverseUrl({ base, category, limit }));
        return jsonResult(data);
      } catch (e) {
        return errorResult(`morphology_reverse_lookup failed: ${(e as Error).message}`);
      }
    },
  );
}
