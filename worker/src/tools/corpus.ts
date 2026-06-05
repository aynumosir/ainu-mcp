/** Corpus search (port of ainu_mcp/corpus.py) — FTS5 trigram over Turso (libSQL). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { corpusSearch, getMeta } from "../db.js";
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
      const rows = await corpusSearch(env.DB, { query, lang, dialect, author, limit });
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
      const raw = await getMeta(env.DB, "corpus_stats");
      return jsonResult(raw ? JSON.parse(raw) : { sentences: 0, top_dialects: {} });
    },
  );
}
