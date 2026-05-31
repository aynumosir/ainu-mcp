/**
 * Textual-sources tools — thin proxies to the Ainu Textual Sources Database
 * (ainu-sources / db.aynu.org) over a service binding (env.SOURCES). That app
 * owns the catalogue (sources + persons/places/institutions/relations) and its
 * queries; this exposes search + detail as MCP tools.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { jsonResult, errorResult, fetchJson } from "./helpers.js";

const SOURCES = "https://db.aynu.org";

export function registerSourcesTools(server: McpServer, env: Env): void {
  server.tool(
    "sources_search",
    "Search the Ainu Textual Sources Database (db.aynu.org) — historical documents, dictionaries, wordlists, oral-literature records, and secondary research. Free-text `query` matches title/author/dialect/summary; optionally filter by category ('primary' | 'secondary' | 'corpus' | 'tool'), type (e.g. 'dictionary', 'grammar-book', 'corpus-text'), region ('hokkaido' | 'sakhalin' | 'kuril'), or language (ISO-ish: 'ain', 'jpn', 'rus', …). Returns bibliographic metadata + slug; pass the slug to source_get for full detail.",
    {
      query: z.string().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
      region: z.string().optional(),
      language: z.string().optional(),
      limit: z.number().int().default(20),
    },
    async ({ query, category, type, region, language, limit }) => {
      try {
        const p = new URLSearchParams();
        if (query) p.set("q", query);
        if (category) p.set("category", category);
        if (type) p.set("type", type);
        if (region) p.set("region", region);
        if (language) p.set("language", language);
        p.set("limit", String(limit));
        const data = await fetchJson(env.SOURCES, `${SOURCES}/api/sources?${p.toString()}`);
        return jsonResult(data);
      } catch (e) {
        return errorResult(`sources_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_get",
    "Fetch full detail for one source from the Ainu Textual Sources Database (db.aynu.org) by slug: the bibliographic record plus linked persons, places, holding institutions, digital links, related sources and tags. Get the slug from sources_search.",
    {
      slug: z.string(),
    },
    async ({ slug }) => {
      try {
        const data = await fetchJson(
          env.SOURCES,
          `${SOURCES}/api/sources/${encodeURIComponent(slug)}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_get failed: ${(e as Error).message}`);
      }
    },
  );
}
