/** Word frequency + stopwords (port of ainu_mcp/frequency.py + stopwords.py).
 *
 * The corpus token counts + stopword flags are precomputed into the `token_freq`
 * and `stopwords` Turso (libSQL) tables by the ETL, so these tools never scan the corpus.
 * Only the query word is normalized here — with the SAME rules as the ETL
 * (ainu_mcp.gaps._normalize) so `ku=nukar` and `nukar` resolve together. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { tokenFrequency, frequencyList, stopwordsList, isStopword, getMeta } from "../db.js";
import { jsonResult } from "./helpers.js";

const STOPWORDS_SOURCE = "aynumosir/ainu-stopwords";

const TOKEN = /[A-Za-zÀ-ɏ'’]+/g;
const AFFIX_PREFIX = /^(?:a=|ku=|ci=|eci=|e=|c=|en=|i=|un=)/;

/** Mirror of ainu_mcp.gaps._normalize (also duplicated in tools/gaps.ts). */
function normalize(tok: string): string {
  let t = tok.toLowerCase();
  t = t.replace(AFFIX_PREFIX, "");
  if (t.endsWith("=an")) t = t.slice(0, -3);
  t = t.replace(/^['’]+|['’]+$/g, "");
  return t;
}

async function intMeta(env: Env, key: string): Promise<number | null> {
  const raw = await getMeta(env.DB, key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function registerFrequencyTools(server: McpServer, env: Env): void {
  server.tool(
    "corpus_word_frequency",
    "How often an Ainu word occurs in the ~195k-sentence corpus. Returns the normalized form, raw count, 1-based rank among all distinct tokens (null if the word never appears), whether it is a stopword (per aynumosir/ainu-stopwords), and corpus-wide totals. The word is normalized the same way corpus tokens are (lowercased, personal-affix clitics like ku=/a=/e= stripped), so 'ku=nukar' and 'nukar' count together.",
    { word: z.string() },
    async ({ word }) => {
      const normalized = normalize(word);
      const freq = await tokenFrequency(env.DB, normalized);
      const stop = freq ? freq.is_stopword : await isStopword(env.DB, normalized);
      return jsonResult({
        word,
        normalized,
        count: freq?.count ?? 0,
        rank: freq?.rank ?? null,
        is_stopword: stop,
        total_distinct_tokens: await intMeta(env, "token_total_distinct"),
        total_token_occurrences: await intMeta(env, "token_total_occurrences"),
      });
    },
  );

  server.tool(
    "corpus_frequency_list",
    "The most frequent Ainu tokens in the corpus, descending by count — each with its count and is_stopword flag. Set include_stopwords=false to drop stopwords (from aynumosir/ainu-stopwords) before paging, so limit/offset count only content words. min_count trims the rare tail.",
    {
      limit: z.number().int().default(50),
      offset: z.number().int().default(0),
      include_stopwords: z.boolean().default(true),
      min_count: z.number().int().default(1),
    },
    async ({ limit, offset, include_stopwords, min_count }) => {
      const rows = await frequencyList(env.DB, {
        limit,
        offset,
        includeStopwords: include_stopwords,
        minCount: min_count,
      });
      return jsonResult(
        rows.map((r) => ({ token: r.token, count: r.count, is_stopword: r.is_stopword === 1 })),
      );
    },
  );

  server.tool(
    "corpus_stopwords",
    "Return the Ainu stopword list from aynumosir/ainu-stopwords — extremely common particles/auxiliaries (ne, wa, kor, …) usually filtered out of frequency and keyword analyses. Returns the words, their count, and the source repo.",
    {},
    async () => {
      const words = await stopwordsList(env.DB);
      return jsonResult({ source: STOPWORDS_SOURCE, count: words.length, words });
    },
  );
}
