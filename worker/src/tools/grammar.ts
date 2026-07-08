/** Grammar bibliography + transcribed/plain-text search (port of ainu_mcp/grammar.py). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import {
  grammarList,
  grammarFilenameSearch,
  grammarTranscribedSearch,
  grammarGetPlainText,
  type GrammarMaterial,
  type GrammarTextRow,
} from "../db.js";
import { errorResult, jsonResult } from "./helpers.js";

export function materialOut(m: GrammarMaterial): Record<string, unknown> {
  const o: Record<string, unknown> = { kind: m.kind, path: m.path, filename: m.filename };
  if (m.source) o.source = m.source;
  if (m.year !== null && m.year !== undefined) o.year = m.year;
  if (m.author) o.author = m.author;
  if (m.title) o.title = m.title;
  if (m.summary) o.summary = m.summary;
  if (m.part) o.part = m.part;
  if (m.variant) o.variant = m.variant;
  if (m.license) o.license = m.license;
  if (m.plain_text_available) o.plain_text_available = true;
  return o;
}

/** Extract up to 3 ±80-char snippets around case-insensitive matches of q. */
export function extractSnippets(content: string, q: string): string[] {
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

export function textHitOut(r: GrammarTextRow, snippets: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = { path: r.path, snippets };
  if (r.source) o.source = r.source;
  if (r.kind) o.kind = r.kind;
  if (r.title) o.title = r.title;
  if (r.variant) o.variant = r.variant;
  if (r.plain_text_available) o.plain_text_available = true;
  return o;
}

export function registerGrammarTools(server: McpServer, env: Env): void {
  server.tool(
    "grammar_list",
    "List grammar materials. kind can be books/articles for the legacy bibliography, or hokkaido_grammar/sakhalin_grammar for project-authored public grammar chapters with plain text available.",
    { kind: z.enum(["books", "articles", "hokkaido_grammar", "sakhalin_grammar"]).optional() },
    async ({ kind }) => {
      const rows = await grammarList(env.DB, kind);
      return jsonResult(rows.map(materialOut));
    },
  );

  server.tool(
    "grammar_search",
    "Search grammar materials: substring-match filenames/titles/authors/metadata, and (when include_transcribed=true) fulltext-search transcribed legacy sources plus project-authored Hokkaido/Sakhalin grammar chapters. Returns filename hits and snippet hits separately; public authored chapter hits include plain_text_available=true and can be read with grammar_get_text.",
    {
      query: z.string(),
      include_transcribed: z.boolean().default(true),
      limit: z.number().int().default(30),
    },
    async ({ query, include_transcribed, limit }) => {
      const q = query.trim().toLowerCase();
      if (!q) return jsonResult({ filename_hits: [], transcribed_hits: [] });
      const nameHits = (await grammarFilenameSearch(env.DB, q, limit)).map(materialOut);
      let transcribedHits: Record<string, unknown>[] = [];
      if (include_transcribed) {
        // Fulltext is chunked across rows (same path) in Turso, so fetch extra
        // rows and regroup into up to `limit` distinct files, each with up to 3
        // deduped snippets.
        const rows = await grammarTranscribedSearch(env.DB, q, Math.max(limit * 5, 50));
        const byPath = new Map<string, { row: GrammarTextRow; snippets: string[] }>();
        for (const r of rows) {
          // Only count a file as a hit if the raw substring is actually present
          // (Python's _scan_transcribed never yields an empty-snippet hit).
          const snips = extractSnippets(r.content, q);
          if (!snips.length) continue;
          if (!byPath.has(r.path)) {
            if (byPath.size >= limit) continue;
            byPath.set(r.path, { row: r, snippets: [] });
          }
          const arr = byPath.get(r.path)!.snippets;
          for (const s of snips) {
            if (arr.length >= 3) break;
            if (!arr.includes(s)) arr.push(s);
          }
        }
        transcribedHits = [...byPath.values()].map(({ row, snippets }) => textHitOut(row, snippets));
      }
      return jsonResult({ filename_hits: nameHits, transcribed_hits: transcribedHits });
    },
  );

  server.tool(
    "grammar_get_text",
    "Fetch the complete plain text of a project-authored public grammar chapter returned by grammar_list/grammar_search (currently Hokkaido and Sakhalin Ainu chapters). Third-party legacy grammar OCR remains snippet-searchable only.",
    { path: z.string() },
    async ({ path }) => {
      const row = await grammarGetPlainText(env.DB, path);
      if (!row) return errorResult(`No public plain text found for grammar path: ${path}`);
      return jsonResult({
        source: row.source,
        kind: row.kind,
        path: row.path,
        title: row.title,
        summary: row.summary,
        part: row.part,
        variant: row.variant,
        license: row.license,
        text: row.content,
      });
    },
  );
}
