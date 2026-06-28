/** Composed entry_research (port of ainu_mcp/research.py). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { corpusSearch } from "../corpus-source.js";
import { glossarySearch } from "./glossary.js";
import { lookupEntries } from "./dictionaries.js";
import { allScripts, separateSyllables } from "./script.js";
import { jsonResult } from "./helpers.js";

export function registerResearchTools(server: McpServer, env: Env): void {
  server.tool(
    "entry_research",
    "One-shot lookup composing: script conversions + syllable separation + existing glossary entries + multi-dictionary lookups + corpus examples. Call this when drafting a new glossary entry or vetting an existing one — one call returns everything needed to make a high-quality edit.",
    {
      word: z.string(),
      corpus_limit: z.number().int().default(8),
      dict_limit: z.number().int().default(12),
      glossary_limit: z.number().int().default(10),
    },
    async ({ word, corpus_limit, dict_limit, glossary_limit }) => {
      const scripts = allScripts(word);
      let syllables: string[];
      try {
        syllables = separateSyllables(scripts.latn ?? word);
      } catch (e) {
        syllables = [`(error: ${e instanceof Error ? e.message : String(e)})`];
      }

      const forms = [...new Set([word, scripts.latn ?? "", scripts.kana ?? ""])].filter(Boolean);

      const glossaryHits: unknown[] = [];
      const seen = new Set<string>();
      for (const form of forms) {
        try {
          for (const hit of await glossarySearch(env, { query: form, limit: glossary_limit })) {
            const key = `${hit.category} ${hit.row}`;
            if (seen.has(key)) continue;
            seen.add(key);
            glossaryHits.push(hit);
          }
        } catch (e) {
          glossaryHits.push({ error: `glossary search failed for '${form}': ${e instanceof Error ? e.message : String(e)}` });
        }
      }

      const dictHits: unknown[] = [];
      for (const form of forms) {
        try {
          dictHits.push(...(await lookupEntries(env, { word: form, limit: dict_limit })));
        } catch (e) {
          dictHits.push({ error: `dictionary lookup failed for '${form}': ${e instanceof Error ? e.message : String(e)}` });
        }
      }

      const corpusHits: unknown[] = [];
      for (const form of forms) {
        try {
          const rows = await corpusSearch(env, { query: form, lang: "ain", limit: corpus_limit });
          corpusHits.push(
            ...rows.map((r) => ({
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
        } catch (e) {
          corpusHits.push({ error: `corpus search failed for '${form}': ${e instanceof Error ? e.message : String(e)}` });
        }
      }

      return jsonResult({
        query: word,
        scripts,
        syllables,
        glossary: glossaryHits.slice(0, glossary_limit),
        dictionaries: dictHits.slice(0, dict_limit),
        corpus: corpusHits.slice(0, corpus_limit),
      });
    },
  );
}
