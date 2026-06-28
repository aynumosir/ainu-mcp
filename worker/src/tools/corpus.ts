/** Corpus search (port of ainu_mcp/corpus.py) — FTS5 trigram over Turso (libSQL). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { corpusSearch, getMeta, concordance } from "../corpus-source.js";
import { jsonResult } from "./helpers.js";

export function registerCorpusTools(server: McpServer, env: Env): void {
  server.tool(
    "corpus_search",
    "Search ~195k aligned Ainu/Japanese sentences from ainu-corpora for example usages. lang='ain' matches the Ainu text, 'jpn' the translation, 'any' either. Filter by dialect substring (e.g. '樺太', '沙流') or author. Returns text + translation + source metadata.",
    {
      query: z.string(),
      lang: z.enum(["ain", "jpn", "any"]).default("any"),
      dialect: z.string().optional(),
      author: z.string().optional(),
      limit: z.number().int().default(20),
    },
    async ({ query, lang, dialect, author, limit }) => {
      const rows = await corpusSearch(env, { query, lang, dialect, author, limit });
      return jsonResult(
        rows.map((r) => ({
          id: r.id,
          text: r.text,
          translation: r.translation,
          dialect: r.dialect,
          author: r.author,
          collection: r.collection,
          document: r.document,
          uri: r.uri,
        })),
      );
    },
  );

  server.tool(
    "corpus_stats",
    "Return total sentence count and top dialect distribution in the corpus.",
    {},
    async () => {
      const raw = await getMeta(env, "corpus_stats");
      return jsonResult(raw ? JSON.parse(raw) : { sentences: 0, top_dialects: {} });
    },
  );

  server.tool(
    "corpus_concordance",
    "KWIC (keyword-in-context) concordance for an Ainu word over the ~196k-sentence corpus. Returns occurrences as left context / node / right context (sliced from each source sentence), plus translation and source. 'match' is exact (default) or prefix; 'sort' is none|left|right (orders by the context next to the node). Filter by dialect/author substring. Useful for studying how a word is actually used.",
    {
      query: z.string(),
      window: z.number().int().default(40),
      limit: z.number().int().default(50),
      sort: z.enum(["none", "left", "right"]).default("none"),
      match: z.enum(["exact", "prefix"]).default("exact"),
      dialect: z.string().optional(),
      author: z.string().optional(),
    },
    async ({ query, window, limit, sort, match, dialect, author }) => {
      const lines = await concordance(env, { q: query, window, limit, sort, match, dialect, author });
      return jsonResult(lines);
    },
  );
}
