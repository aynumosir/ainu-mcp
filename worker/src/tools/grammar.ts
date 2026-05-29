/** Grammar bibliography + transcribed-text search (port of ainu_mcp/grammar.py). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { grammarList, grammarFilenameSearch, grammarTranscribedSearch, type GrammarMaterial } from "../db.js";
import { jsonResult } from "./helpers.js";

function materialOut(m: GrammarMaterial): Record<string, unknown> {
  const o: Record<string, unknown> = { kind: m.kind, path: m.path, filename: m.filename };
  if (m.year !== null && m.year !== undefined) {
    o.year = m.year;
    o.author = m.author;
    o.title = m.title;
  }
  return o;
}

/** Extract up to 3 ±80-char snippets around case-insensitive matches of q. */
function extractSnippets(content: string, q: string): string[] {
  const lower = content.toLowerCase();
  const snippets: string[] = [];
  let start = 0;
  while (snippets.length < 3) {
    const i = lower.indexOf(q, start);
    if (i < 0) break;
    const s = Math.max(0, i - 80);
    const e = Math.min(content.length, i + q.length + 80);
    snippets.push(content.slice(s, e).replace(/\n/g, " ").trim());
    start = i + q.length;
  }
  return snippets;
}

export function registerGrammarTools(server: McpServer, env: Env): void {
  server.tool(
    "grammar_list",
    "List grammar materials (books and/or articles) with year, author, title parsed from filenames where possible.",
    { kind: z.enum(["books", "articles"]).optional() },
    async ({ kind }) => {
      const rows = await grammarList(env.DB, kind);
      return jsonResult(rows.map(materialOut));
    },
  );

  server.tool(
    "grammar_search",
    "Search grammar materials: substring-match filenames/titles/authors, and (when include_transcribed=true) also fulltext-search any transcribed markdown/text under the grammar repo. Returns filename hits and snippet hits separately.",
    {
      query: z.string(),
      include_transcribed: z.boolean().default(true),
      limit: z.number().int().default(30),
    },
    async ({ query, include_transcribed, limit }) => {
      const q = query.trim().toLowerCase();
      if (!q) return jsonResult({ filename_hits: [], transcribed_hits: [] });
      const nameHits = (await grammarFilenameSearch(env.DB, q, limit)).map(materialOut);
      let transcribedHits: { path: string; snippets: string[] }[] = [];
      if (include_transcribed) {
        // Transcribed content is chunked across rows (same path) in D1, so fetch
        // extra rows and regroup into up to `limit` distinct files, each with up
        // to 3 deduped snippets.
        const rows = await grammarTranscribedSearch(env.DB, q, Math.max(limit * 5, 50));
        const byPath = new Map<string, string[]>();
        for (const r of rows) {
          // Only count a file as a hit if the raw substring is actually present
          // (Python's _scan_transcribed never yields an empty-snippet hit).
          const snips = extractSnippets(r.content, q);
          if (!snips.length) continue;
          if (!byPath.has(r.path)) {
            if (byPath.size >= limit) continue;
            byPath.set(r.path, []);
          }
          const arr = byPath.get(r.path)!;
          for (const s of snips) {
            if (arr.length >= 3) break;
            if (!arr.includes(s)) arr.push(s);
          }
        }
        transcribedHits = [...byPath].map(([path, snippets]) => ({ path, snippets }));
      }
      return jsonResult({ filename_hits: nameHits, transcribed_hits: transcribedHits });
    },
  );
}
