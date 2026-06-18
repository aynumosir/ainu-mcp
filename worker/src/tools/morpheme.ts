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

/**
 * Build the MDB `/api/forms` query URL from the proxy parameters. Pure (no
 * network) so the .mjs test can assert the encoding/omission rules without a
 * service binding. Only non-empty filters are appended, so the upstream sees a
 * clean query; `limit` is always sent.
 */
export function formsUrl(params: {
  lemma: string;
  category?: string;
  feature?: string;
  relation?: string;
  provenance?: string;
  limit: number;
}): string {
  const q = new URLSearchParams();
  q.set("lemma", params.lemma);
  if (params.category) q.set("category", params.category);
  if (params.feature) q.set("feature", params.feature);
  if (params.relation) q.set("relation", params.relation);
  if (params.provenance) q.set("provenance", params.provenance);
  q.set("limit", String(params.limit));
  return `${MDB}/api/forms?${q.toString()}`;
}

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

  server.tool(
    "morphology_forms",
    "Generate/look up the morphological forms of an Ainu lemma via the Ainu Morpheme Database forms engine (mdb.aynu.org/api/forms): possessed-noun forms (所属形, e.g. sapa → sapaha), plural verb forms (-pa / suppletive, role-sensitive object vs subject number) and derivations (causative, reflexive, nominalisation). The engine is hybrid + provenanced: rules generate, harvest + curated exceptions validate/override, and every form is tagged `source` (rule | attested | exception) + `confidence`. A `source='rule'` form with no `attested_ref` is PREDICTED-but-UNATTESTED — surfaced as a discovery aid but flagged, so check `source`/`confidence`/`attested_ref` before trusting it. Each form also carries a structured `feature_bundle` ({domain: nominal|verbal, relation: possessed|plural|derived, …}), its `analysis` and `rule_id`. Filter by `category` (the domain: 'nominal' | 'verbal'), `relation` ('possessed' | 'plural' | 'derived'), `feature` (a feature-bundle facet, e.g. a number locus 'object'/'subject' or a derivation kind like 'causative'), and `provenance` ('rule' | 'attested' | 'exception'). Personal-agreement conjugation is not yet covered.",
    {
      lemma: z.string(),
      category: z.enum(["nominal", "verbal"]).optional(),
      relation: z.enum(["possessed", "plural", "derived"]).optional(),
      feature: z.string().optional(),
      provenance: z.enum(["rule", "attested", "exception"]).optional(),
      limit: z.number().int().default(30),
    },
    async ({ lemma, category, relation, feature, provenance, limit }) => {
      try {
        const data = await fetchJson(
          env.MDB,
          formsUrl({ lemma, category, relation, feature, provenance, limit }),
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`morphology_forms failed: ${(e as Error).message}`);
      }
    },
  );
}
