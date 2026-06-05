/**
 * Query helpers for the Turso (libSQL) reference store.
 *
 * Types are still `D1Database`-shaped: `src/libsql.ts` presents the D1
 * `prepare/bind/all/first` API over libSQL, so these helpers are unchanged.
 *
 * Every substring search reproduces the original Python `q in text.lower()`
 * semantics using FTS5 + the trigram tokenizer (case-insensitive, substring,
 * CJK-safe). Trigram indexes need >=3 characters; shorter queries fall back to a
 * bounded LIKE scan.
 */

/** Wrap a user string as an FTS5 phrase (quote, and escape internal quotes). */
function ftsPhrase(q: string): string {
  return '"' + q.replace(/"/g, '""') + '"';
}

/** Escape `%` and `_` for a LIKE substring pattern (ESCAPE '\'). */
function likePattern(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

/** Clamp a caller `limit` to a non-negative integer. Guards against a negative
 * value becoming SQLite `LIMIT -1` (= unbounded → a full-table read). */
function clampLimit(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export interface CorpusRow {
  id: string;
  text: string;
  translation: string;
  dialect: string | null;
  author: string | null;
  collection: string | null;
  document: string | null;
  uri: string | null;
}

export type CorpusLang = "ain" | "jpn" | "any";

export async function corpusSearch(
  db: D1Database,
  opts: { query: string; lang: CorpusLang; dialect?: string | null; author?: string | null; limit: number },
): Promise<CorpusRow[]> {
  const q = opts.query.trim();
  if (!q) return [];
  const select = `SELECT id, text, translation, dialect, author, collection, document, uri FROM corpus_fts`;
  const params: unknown[] = [];
  let where: string;

  if (q.length >= 3) {
    const col = opts.lang === "ain" ? "text" : opts.lang === "jpn" ? "translation" : null;
    const match = col ? `${col} : ${ftsPhrase(q)}` : ftsPhrase(q);
    where = ` WHERE corpus_fts MATCH ?`;
    params.push(match);
  } else {
    // <3 chars: trigram can't index — bounded LIKE scan in rowid order.
    const pat = likePattern(q.toLowerCase());
    if (opts.lang === "ain") {
      where = ` WHERE lower(text) LIKE ? ESCAPE '\\'`;
      params.push(pat);
    } else if (opts.lang === "jpn") {
      where = ` WHERE lower(translation) LIKE ? ESCAPE '\\'`;
      params.push(pat);
    } else {
      where = ` WHERE (lower(text) LIKE ? ESCAPE '\\' OR lower(translation) LIKE ? ESCAPE '\\')`;
      params.push(pat, pat);
    }
  }
  // instr() (not LIKE): LIKE on an FTS5 virtual-table column silently returns
  // zero rows for ASCII patterns, and would be case-insensitive — whereas
  // Python's `x in row[col]` is a case-SENSITIVE substring. instr() is both
  // correct against FTS5 columns and case-sensitive, matching Python exactly.
  if (opts.dialect) {
    where += ` AND instr(dialect, ?) > 0`;
    params.push(opts.dialect);
  }
  if (opts.author) {
    where += ` AND instr(author, ?) > 0`;
    params.push(opts.author);
  }
  const sql = `${select}${where} ORDER BY rowid LIMIT ?`;
  params.push(clampLimit(opts.limit));
  const { results } = await db.prepare(sql).bind(...params).all<CorpusRow>();
  return results ?? [];
}

export interface DictEntryRow {
  id: number;
  dictionary: string;
  source_file: string | null;
  lemma: string | null;
  lemma_lower: string | null;
  definition: string | null;
  fields_json: string;
  field_order: string; // JSON array of original field keys (preserves order)
}

const DICT_COLS = "d.id, d.dictionary, d.source_file, d.lemma, d.lemma_lower, d.definition, d.fields_json, d.field_order";

/** Build an `ORDER BY` that honors a caller-supplied dict order (Python iterates
 * `dicts` in the given order); falls back to id order otherwise. */
function dictOrderClause(dicts: string[] | null | undefined): string {
  if (!dicts || !dicts.length) return "d.id";
  const cases = dicts.map((_, i) => `WHEN ? THEN ${i}`).join(" ");
  return `CASE d.dictionary ${cases} ELSE ${dicts.length} END, d.id`;
}

/**
 * reverse_lookup: exact (case-insensitive) lemma matches first, then substring.
 * Honors caller dict order; substring uses the lemma trigram index (>=3 chars)
 * else a LIKE scan. Mirrors dictionaries.py reverse_lookup.
 */
export async function dictReverseLookup(
  db: D1Database,
  opts: { aynu: string; dicts?: string[] | null; limit: number },
): Promise<{ exact: DictEntryRow[]; substr: DictEntryRow[] }> {
  const q = opts.aynu.trim().toLowerCase();
  const limit = clampLimit(opts.limit);
  if (!q || limit === 0) return { exact: [], substr: [] };
  const dicts = opts.dicts && opts.dicts.length ? opts.dicts : null;
  const dictFilter = dicts ? ` AND d.dictionary IN (${dicts.map(() => "?").join(",")})` : "";
  const order = dictOrderClause(dicts);
  const orderParams = dicts ?? [];

  const exactSql = `SELECT ${DICT_COLS} FROM dict_entries d WHERE d.lemma_lower = ?${dictFilter} ORDER BY ${order} LIMIT ?`;
  const exact = (await db.prepare(exactSql).bind(q, ...(dicts ?? []), ...orderParams, limit).all<DictEntryRow>()).results ?? [];

  let substr: DictEntryRow[] = [];
  if (q.length >= 3) {
    const sql = `SELECT ${DICT_COLS} FROM dict_fts f JOIN dict_entries d ON d.id = f.rowid
                 WHERE dict_fts MATCH ?${dictFilter} AND d.lemma_lower <> ? ORDER BY ${order} LIMIT ?`;
    substr = (await db.prepare(sql).bind(`lemma : ${ftsPhrase(q)}`, ...(dicts ?? []), q, ...orderParams, limit).all<DictEntryRow>()).results ?? [];
  } else {
    const sql = `SELECT ${DICT_COLS} FROM dict_entries d WHERE d.lemma_lower LIKE ? ESCAPE '\\' AND d.lemma_lower <> ?${dictFilter} ORDER BY ${order} LIMIT ?`;
    substr = (await db.prepare(sql).bind(likePattern(q), q, ...(dicts ?? []), ...orderParams, limit).all<DictEntryRow>()).results ?? [];
  }
  return { exact, substr };
}

/**
 * lookup: one page of candidate entries (q appears in ANY field) for a single
 * dictionary, after `afterId`, in id order. The caller (lookupEntries) pages
 * through and confirms per-field, so there is no candidate-cap truncation.
 */
export async function dictLookupPage(
  db: D1Database,
  opts: { q: string; dict?: string | null; afterId: number; pageSize: number },
): Promise<DictEntryRow[]> {
  const { q, dict, afterId, pageSize } = opts;
  const dictClause = dict ? ` AND d.dictionary = ?` : "";
  const dictParam = dict ? [dict] : [];
  if (q.length >= 3) {
    const sql = `SELECT ${DICT_COLS} FROM dict_fts f JOIN dict_entries d ON d.id = f.rowid
                 WHERE dict_fts MATCH ?${dictClause} AND d.id > ? ORDER BY d.id LIMIT ?`;
    return (await db.prepare(sql).bind(`all_text_lower : ${ftsPhrase(q)}`, ...dictParam, afterId, pageSize).all<DictEntryRow>()).results ?? [];
  }
  const sql = `SELECT ${DICT_COLS} FROM dict_entries d
               WHERE d.all_text_lower LIKE ? ESCAPE '\\'${dictClause} AND d.id > ? ORDER BY d.id LIMIT ?`;
  return (await db.prepare(sql).bind(likePattern(q), ...dictParam, afterId, pageSize).all<DictEntryRow>()).results ?? [];
}

export async function listDictionaries(db: D1Database): Promise<{ name: string; entries: number }[]> {
  const { results } = await db.prepare(`SELECT name, entries FROM dictionaries ORDER BY name`).all<{ name: string; entries: number }>();
  return results ?? [];
}

export interface GrammarMaterial {
  kind: string;
  path: string;
  filename: string;
  year: number | null;
  author: string | null;
  title: string | null;
}

export async function grammarList(db: D1Database, kind?: string | null): Promise<GrammarMaterial[]> {
  // ORDER BY rowid reproduces _walk_materials() traversal order.
  if (kind) {
    const { results } = await db.prepare(`SELECT kind, path, filename, year, author, title FROM grammar_materials WHERE kind = ? ORDER BY rowid`).bind(kind).all<GrammarMaterial>();
    return results ?? [];
  }
  const { results } = await db.prepare(`SELECT kind, path, filename, year, author, title FROM grammar_materials ORDER BY rowid`).all<GrammarMaterial>();
  return results ?? [];
}

export async function grammarFilenameSearch(db: D1Database, q: string, limit: number): Promise<GrammarMaterial[]> {
  const pat = likePattern(q.toLowerCase());
  const sql = `SELECT kind, path, filename, year, author, title FROM grammar_materials
               WHERE lower(filename) LIKE ? ESCAPE '\\' OR lower(coalesce(title,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(author,'')) LIKE ? ESCAPE '\\'
               ORDER BY rowid LIMIT ?`;
  const { results } = await db.prepare(sql).bind(pat, pat, pat, clampLimit(limit)).all<GrammarMaterial>();
  return results ?? [];
}

export async function grammarTranscribedSearch(db: D1Database, q: string, limit: number): Promise<{ path: string; content: string }[]> {
  const lim = clampLimit(limit);
  if (q.length >= 3) {
    const sql = `SELECT path, content FROM grammar_fts WHERE grammar_fts MATCH ? LIMIT ?`;
    const { results } = await db.prepare(sql).bind(`content : ${ftsPhrase(q)}`, lim).all<{ path: string; content: string }>();
    return results ?? [];
  }
  const sql = `SELECT path, content FROM grammar_fts WHERE lower(content) LIKE ? ESCAPE '\\' LIMIT ?`;
  const { results } = await db.prepare(sql).bind(likePattern(q.toLowerCase()), lim).all<{ path: string; content: string }>();
  return results ?? [];
}

export interface VocabCandidate {
  token: string;
  count: number;
  attested_in: string; // JSON array
  sample_text: string | null;
  sample_translation: string | null;
}

export async function vocabCandidates(db: D1Database, minCount: number): Promise<VocabCandidate[]> {
  // ORDER BY count DESC, rowid → count descending with ties broken by
  // first-appearance (rowid = ETL emission order = Counter.most_common order).
  const { results } = await db
    .prepare(`SELECT token, count, attested_in, sample_text, sample_translation FROM vocab_candidates WHERE count >= ? ORDER BY count DESC, rowid`)
    .bind(minCount)
    .all<VocabCandidate>();
  return results ?? [];
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

// ───────────────────────────── Frequency + stopwords ───────────────────────────── //

export interface TokenFreqRow {
  token: string;
  count: number;
  is_stopword: number;
}

/** Frequency row for one normalized token, plus its 1-based rank among all
 * distinct tokens (rank = number of tokens with a strictly higher count + 1).
 * Returns null when the token never appears in the corpus. */
export async function tokenFrequency(
  db: D1Database,
  normalized: string,
): Promise<{ count: number; is_stopword: boolean; rank: number } | null> {
  if (!normalized) return null;
  const row = await db
    .prepare(`SELECT count, is_stopword FROM token_freq WHERE token = ?`)
    .bind(normalized)
    .first<{ count: number; is_stopword: number }>();
  if (!row) return null;
  const higher = await db
    .prepare(`SELECT count(*) AS c FROM token_freq WHERE count > ?`)
    .bind(row.count)
    .first<{ c: number }>();
  return { count: row.count, is_stopword: row.is_stopword === 1, rank: (higher?.c ?? 0) + 1 };
}

/** Most-frequent tokens, descending by count (ties by first-appearance rowid =
 * ETL emission order). Optionally drops stopwords before paging, so limit/offset
 * count only kept tokens. */
export async function frequencyList(
  db: D1Database,
  opts: { limit: number; offset: number; includeStopwords: boolean; minCount: number },
): Promise<TokenFreqRow[]> {
  const where = opts.includeStopwords ? `count >= ?` : `count >= ? AND is_stopword = 0`;
  const offset = Number.isFinite(opts.offset) && opts.offset > 0 ? Math.floor(opts.offset) : 0;
  const { results } = await db
    .prepare(
      `SELECT token, count, is_stopword FROM token_freq WHERE ${where} ORDER BY count DESC, rowid LIMIT ? OFFSET ?`,
    )
    .bind(opts.minCount, clampLimit(opts.limit), offset)
    .all<TokenFreqRow>();
  return results ?? [];
}

/** The canonical stopword list (published forms), in source order. */
export async function stopwordsList(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT word FROM stopwords ORDER BY rowid`).all<{ word: string }>();
  return (results ?? []).map((r) => r.word);
}

/** Whether a normalized word is a stopword (matches against the normalized
 * column, so it works even for words absent from the corpus). */
export async function isStopword(db: D1Database, normalized: string): Promise<boolean> {
  if (!normalized) return false;
  const row = await db.prepare(`SELECT 1 AS x FROM stopwords WHERE normalized = ? LIMIT 1`).bind(normalized).first<{ x: number }>();
  return row != null;
}
