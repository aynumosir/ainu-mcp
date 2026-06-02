/**
 * Textual-sources tools — thin proxies to the Ainu Textual Sources Database
 * (ainu-sources / db.aynu.org) over a service binding (env.SOURCES). That app
 * owns the catalogue (sources + persons/places/institutions/relations) and its
 * queries; this exposes search + detail as MCP tools.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../types.js";
import { jsonResult, errorResult, fetchJson, sendJson } from "./helpers.js";

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

// Optional source fields shared by source_add and source_update. snake_case
// (MCP convention); mapped to the ainu-sources SourceInput camelCase keys when
// the request body is built.
const optionalSourceFields = {
  title_en: z.string().optional(),
  title_ain: z.string().optional(),
  author: z.string().optional(),
  year_text: z.string().optional().describe("verbatim year, e.g. '1875', '1867/1872', 'c.1700'"),
  year_start: z.number().int().optional(),
  year_end: z.number().int().optional(),
  year_certainty: z.enum(["exact", "range", "estimated", "unknown"]).optional(),
  dialect: z.string().optional(),
  region: z.enum(["hokkaido", "sakhalin", "kuril", "proto"]).optional(),
  languages: z.array(z.string()).optional().describe("ISO-ish codes: ain, jpn, rus, eng, lat, …"),
  scripts: z.array(z.string()).optional().describe("kana, latn, cyrl, kanji, …"),
  holding_institution: z.string().optional(),
  call_number: z.string().optional(),
  entry_count: z.number().int().optional(),
  entry_count_label: z.string().optional().describe("what entry_count counts: entries | sentences | pages | lemmas"),
  license: z.string().optional(),
  summary: z.string().optional().describe("short markdown description"),
  notes: z.string().optional(),
  reliability: z.string().optional(),
  links: z
    .array(z.object({ type: z.string().default("website"), label: z.string().optional(), url: z.string() }))
    .optional()
    .describe("external links; type ∈ iiif|image|opac|cinii|ndl|doi|transcription|github|wikidata|pdf|website|api|other"),
  tags: z.array(z.string()).optional().describe("topic/genre/feature tag names; created if new"),
  revision_summary: z.string().optional().describe("short note describing this edit, for the revision history"),
};

const SNAKE_TO_CAMEL: Record<string, string> = {
  title: "title", title_en: "titleEn", title_ain: "titleAin", category: "category",
  type: "type", author: "author", year_text: "yearText", year_start: "yearStart",
  year_end: "yearEnd", year_certainty: "yearCertainty", dialect: "dialect", region: "region",
  languages: "languages", scripts: "scripts", holding_institution: "holdingInstitution",
  call_number: "callNumber", entry_count: "entryCount", entry_count_label: "entryCountLabel",
  license: "license", summary: "summary", notes: "notes", reliability: "reliability",
  links: "links", tags: "tagNames",
};

/** Build the ainu-sources SourceInput body from snake_case tool args, including
 * only provided keys (so PATCH leaves omitted fields untouched), and attribute
 * the edit to the connected GitHub user. */
function buildBody(args: Record<string, unknown>, props: Props): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    if (args[snake] !== undefined) body[camel] = args[snake];
  }
  if (args.revision_summary !== undefined) body.revisionSummary = args.revision_summary;
  body.user = { name: props.name || props.login };
  return body;
}

export function registerSourcesWriteTools(server: McpServer, env: Env, props: Props): void {
  server.tool(
    "source_add",
    "Add a new source to the Ainu Textual Sources Database (db.aynu.org). Requires title + type + category; all other bibliographic fields, external links, and tags are optional. Returns the created record including its slug. (aynumosir org members only.)",
    {
      title: z.string(),
      type: z.string().describe("fine type, e.g. dictionary, wordlist, grammar, old-document, book, article, corpus-text"),
      category: z.enum(["primary", "secondary", "corpus"]).default("primary"),
      ...optionalSourceFields,
    },
    async (args) => {
      try {
        const data = await sendJson(env.SOURCES, `${SOURCES}/api/sources`, {
          method: "POST",
          token: env.SOURCES_WRITE_TOKEN,
          body: buildBody(args as Record<string, unknown>, props),
        });
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_add failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "source_update",
    "Update an existing source in the Ainu Textual Sources Database (db.aynu.org) by slug (get it from sources_search / source_get). PARTIAL update: only the fields you pass are changed; omitted fields keep their current values. Passing `links` or `tags` replaces that entire list. Returns the updated record. (aynumosir org members only.)",
    {
      slug: z.string(),
      title: z.string().optional(),
      type: z.string().optional(),
      category: z.enum(["primary", "secondary", "corpus"]).optional(),
      ...optionalSourceFields,
    },
    async ({ slug, ...args }) => {
      try {
        const data = await sendJson(
          env.SOURCES,
          `${SOURCES}/api/sources/${encodeURIComponent(slug)}`,
          { method: "PATCH", token: env.SOURCES_WRITE_TOKEN, body: buildBody(args as Record<string, unknown>, props) },
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`source_update failed: ${(e as Error).message}`);
      }
    },
  );
}
