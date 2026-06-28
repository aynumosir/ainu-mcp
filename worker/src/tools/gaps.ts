/** Vocabulary-gap worklist (port of ainu_mcp/gaps.py).
 *
 * The expensive part (corpus token frequencies + dictionary attestation +
 * samples) is precomputed into the `vocab_candidates` Turso (libSQL) table by the ETL. Only
 * the live glossary-membership subtraction happens here. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { vocabCandidates } from "../corpus-source.js";
import { contentSheetNames, batchReadTabs } from "./glossary.js";
import { jsonResult } from "./helpers.js";

const TOKEN = /[A-Za-zÀ-ɏ'’]+/g;
const AFFIX_PREFIX = /^(?:a=|ku=|ci=|eci=|e=|c=|en=|i=|un=)/;

function normalize(tok: string): string {
  let t = tok.toLowerCase();
  t = t.replace(AFFIX_PREFIX, "");
  if (t.endsWith("=an")) t = t.slice(0, -3);
  t = t.replace(/^['’]+|['’]+$/g, "");
  return t;
}

/** All normalized Aynu words/forms currently in the glossary (incl. per-token). */
async function glossaryAynuIndex(env: Env): Promise<Set<string>> {
  const out = new Set<string>();
  const cats = await contentSheetNames(env);
  const tabs = await batchReadTabs(env, cats);
  for (const [, { headers, rows }] of tabs) {
    if (!headers.includes("Aynu")) continue;
    const ai = headers.indexOf("Aynu");
    for (const row of rows) {
      if (ai >= row.length) continue;
      const cell = row[ai];
      if (!cell) continue;
      for (const part of cell.split(",")) {
        const f = part.trim();
        if (!f) continue;
        const nf = normalize(f);
        if (nf) out.add(nf);
        const toks = f.match(TOKEN) ?? [];
        if (toks.length) {
          const last = normalize(toks[toks.length - 1]);
          if (last) out.add(last);
        }
        for (const t of toks) {
          const n = normalize(t);
          if (n) out.add(n);
        }
      }
    }
  }
  return out;
}

export function registerGapsTool(server: McpServer, env: Env): void {
  server.tool(
    "glossary_missing_high_frequency",
    "Surface vocabulary gaps: Ainu tokens that appear >= min_count times in the corpus, are attested in at least one dictionary, and aren't yet in the glossary. Returns top-N candidates with frequency, attesting dictionaries, and a sample sentence for each — use as a worklist for new entries. Note: candidates are precomputed down to a corpus frequency of 5, so min_count below 5 returns the same set as min_count=5.",
    { top_n: z.number().int().default(200), min_count: z.number().int().default(20) },
    async ({ top_n, min_count }) => {
      const candidates = await vocabCandidates(env, min_count);
      const inGlossary = await glossaryAynuIndex(env);
      const results: unknown[] = [];
      for (const c of candidates) {
        if (inGlossary.has(c.token)) continue;
        results.push({
          token: c.token,
          count: c.count,
          attested_in: JSON.parse(c.attested_in),
          sample_text: c.sample_text ?? "",
          sample_translation: c.sample_translation ?? "",
        });
        if (results.length >= top_n) break;
      }
      return jsonResult(results);
    },
  );
}
