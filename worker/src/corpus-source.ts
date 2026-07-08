/**
 * Corpus data source — single point that decides whether corpus reads go to the
 * local Turso DB (`env.DB`, the legacy path) or to the standalone corpus API
 * (`corpus.aynu.org`, via the `CORPUS` service binding).
 *
 * Controlled by the `USE_CORPUS_API` flag so the cutover is reversible:
 *   USE_CORPUS_API !== "true"  → direct DB (byte-identical to before)
 *   USE_CORPUS_API === "true"  → call the corpus API over the service binding
 *
 * Every exported function mirrors the corresponding db.ts helper's signature
 * (taking `env` instead of `env.DB`) so tool modules just swap their import.
 * Normalization stays in the tool layer — these pass tokens through unchanged.
 */
import type { Env } from "./types.js";
import * as db from "./db.js";
import type { CorpusRow, CorpusLang, TokenFreqRow, VocabCandidate } from "./db.js";

function useApi(env: Env): boolean {
  return env.USE_CORPUS_API === "true" && env.CORPUS != null;
}

/** Envelope-unwrapping GET against the corpus API service binding. */
async function apiGet<T>(env: Env, path: string): Promise<T> {
  const res = await env.CORPUS.fetch(new Request(`https://corpus.aynu.org${path}`));
  if (!res.ok) throw new Error(`corpus-api ${path} → HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; error?: { code: string; message: string } };
  if (body.error) throw new Error(`corpus-api ${path}: ${body.error.code} ${body.error.message}`);
  return body.data as T;
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.set(k, String(v));
  }
  return u.toString();
}

export async function corpusSearch(
  env: Env,
  opts: { query: string; lang: CorpusLang; dialect?: string | null; author?: string | null; limit: number },
): Promise<CorpusRow[]> {
  if (!useApi(env)) return db.corpusSearch(env.DB, opts);
  return apiGet<CorpusRow[]>(
    env,
    `/v1/search?${qs({ q: opts.query, lang: opts.lang, dialect: opts.dialect, author: opts.author, limit: opts.limit })}`,
  );
}

export async function getMeta(env: Env, key: string): Promise<string | null> {
  if (!useApi(env)) return db.getMeta(env.DB, key);
  return apiGet<string | null>(env, `/v1/meta?${qs({ key })}`);
}

export async function tokenFrequency(
  env: Env,
  normalized: string,
): Promise<{ count: number; is_stopword: boolean; rank: number } | null> {
  if (!useApi(env)) return db.tokenFrequency(env.DB, normalized);
  const r = await apiGet<{ found: boolean; count: number; is_stopword: boolean; rank: number }>(
    env,
    `/v1/freq/word?${qs({ token: normalized })}`,
  );
  return r.found ? { count: r.count, is_stopword: r.is_stopword, rank: r.rank } : null;
}

export async function frequencyList(
  env: Env,
  opts: { limit: number; offset: number; includeStopwords: boolean; minCount: number },
): Promise<TokenFreqRow[]> {
  if (!useApi(env)) return db.frequencyList(env.DB, opts);
  return apiGet<TokenFreqRow[]>(
    env,
    `/v1/freq/list?${qs({ limit: opts.limit, offset: opts.offset, includeStopwords: opts.includeStopwords, minCount: opts.minCount })}`,
  );
}

export async function stopwordsList(env: Env): Promise<string[]> {
  if (!useApi(env)) return db.stopwordsList(env.DB);
  return apiGet<string[]>(env, `/v1/stopwords`);
}

export async function isStopword(env: Env, normalized: string): Promise<boolean> {
  if (!useApi(env)) return db.isStopword(env.DB, normalized);
  const r = await apiGet<{ is_stopword: boolean }>(env, `/v1/stopword?${qs({ token: normalized })}`);
  return r.is_stopword;
}

export async function vocabCandidates(env: Env, minCount: number): Promise<VocabCandidate[]> {
  if (!useApi(env)) return db.vocabCandidates(env.DB, minCount);
  return apiGet<VocabCandidate[]>(env, `/v1/candidates?${qs({ minCount })}`);
}

export interface ConcordanceLine {
  sentence_id: string;
  left: string;
  node: string;
  right: string;
  translation: string | null;
  dialect: string | null;
  author: string | null;
  uri: string | null;
}

/** KWIC concordance — corpus API only (the token layer lives there). */
export async function concordance(
  env: Env,
  opts: { q: string; window?: number; limit?: number; sort?: string; match?: string; dialect?: string | null; author?: string | null },
): Promise<ConcordanceLine[]> {
  if (env.CORPUS == null) throw new Error("concordance requires the CORPUS service binding");
  return apiGet<ConcordanceLine[]>(
    env,
    `/v1/concordance?${qs({ q: opts.q, window: opts.window, limit: opts.limit, sort: opts.sort, match: opts.match, dialect: opts.dialect, author: opts.author })}`,
  );
}

export interface PosLine extends ConcordanceLine {
  upos: string | null;
  lemma: string | null;
}

/** POS-search (incl. adjacency) — corpus API only. */
export async function posSearch(
  env: Env,
  opts: {
    upos?: string | null; lemma?: string | null; surface?: string | null;
    next_upos?: string | null; next_surface?: string | null;
    window?: number; limit?: number; dialect?: string | null; author?: string | null;
  },
): Promise<PosLine[]> {
  if (env.CORPUS == null) throw new Error("posSearch requires the CORPUS service binding");
  return apiGet<PosLine[]>(env, `/v1/pos?${qs(opts as Record<string, string | number | null | undefined>)}`);
}
