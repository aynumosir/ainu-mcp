-- ainu-mcp Turso (libSQL) schema.
--
-- Search strategy: every substring search in the original Python (`q in text`)
-- is reproduced with SQLite FTS5 + the `trigram` tokenizer, which indexes every
-- contiguous 3-character window and therefore supports indexed substring MATCH
-- (including CJK text, which has no word boundaries). This keeps "rows read"
-- bounded by matches+LIMIT instead of full-table scans, so the Workers Free
-- plan's 5M-rows-read/day budget is never an issue.
--
-- Queries shorter than 3 characters cannot use a trigram index; the Worker
-- falls back to a bounded LIKE scan for those (see src/db.ts).
--
-- Expensive aggregates (corpus stats, dictionary counts, vocabulary-gap
-- candidates) are PRECOMPUTED at seed time by etl/build_d1.py so the runtime
-- never scans the corpus.

-- ───────────────────────────── Corpus ───────────────────────────── --
-- Standalone FTS5: text+translation are indexed (and retrievable); the rest are
-- UNINDEXED display/filter columns. rowid is assigned in source-file order so
-- `ORDER BY rowid` reproduces the Python's "first N matches in file order".
CREATE VIRTUAL TABLE corpus_fts USING fts5(
  text,
  translation,
  id UNINDEXED,
  dialect UNINDEXED,
  author UNINDEXED,
  collection UNINDEXED,
  document UNINDEXED,
  uri UNINDEXED,
  tokenize = 'trigram'
);

-- ──────────────────────────── Dictionaries ──────────────────────────── --
-- Normal table powers fast exact lemma lookup (reverse_lookup exact pass) and
-- holds the full original row as JSON for faithful `lookup` output.
CREATE TABLE dict_entries (
  id INTEGER PRIMARY KEY,
  dictionary TEXT NOT NULL,
  source_file TEXT,
  lemma TEXT,
  lemma_lower TEXT,            -- lower(trim(lemma)) for case-insensitive exact match
  definition TEXT,            -- canonical `definition` field (post column-alias)
  fields_json TEXT NOT NULL,  -- the full original row (minus _file) as JSON
  field_order TEXT NOT NULL,  -- JSON array of field keys in original order (JS Object.keys
                              -- reorders integer-like keys, so we can't rely on it for matched_in)
  all_text_lower TEXT NOT NULL -- lowercased concat of all string field values, for substring search
);
CREATE INDEX idx_dict_lemma_lower ON dict_entries (lemma_lower);
CREATE INDEX idx_dict_name ON dict_entries (dictionary);

-- External-content FTS5 over dict_entries. Column names MUST match the content
-- table columns (lemma, all_text_lower). Substring search on lemma (reverse_lookup
-- fallback) and on all_text_lower (lookup across every field). content_rowid = id.
CREATE VIRTUAL TABLE dict_fts USING fts5(
  lemma,
  all_text_lower,
  content = 'dict_entries',
  content_rowid = 'id',
  tokenize = 'trigram'
);

-- ───────────────────────────── Grammar ───────────────────────────── --
-- Bibliography (PDF + transcribed file metadata). ~280 rows; filename/title/
-- author LIKE search over this is a trivial scan.
CREATE TABLE grammar_materials (
  kind TEXT NOT NULL,         -- 'books' | 'articles'
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  year INTEGER,
  author TEXT,
  title TEXT
);
CREATE INDEX idx_grammar_kind ON grammar_materials (kind);

-- Transcribed fulltext (OCR'd md/txt). `content` is indexed AND retrievable so
-- the Worker can extract ±80-char snippets around matches in JS.
CREATE VIRTUAL TABLE grammar_fts USING fts5(
  content,
  path UNINDEXED,
  tokenize = 'trigram'
);

-- ──────────────────────── Precomputed aggregates ──────────────────────── --
-- dictionary_list(): name + entry count.
CREATE TABLE dictionaries (
  name TEXT PRIMARY KEY,
  entries INTEGER NOT NULL
);

-- glossary_missing_high_frequency(): corpus tokens with count>=floor that are
-- attested in >=1 dictionary. Glossary membership is subtracted at runtime
-- (live from Sheets). attested_in is a JSON array of short dictionary names.
CREATE TABLE vocab_candidates (
  token TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  attested_in TEXT NOT NULL,
  sample_text TEXT,
  sample_translation TEXT
);
CREATE INDEX idx_vocab_count ON vocab_candidates (count DESC);

-- key/value store: 'corpus_stats' (JSON: {sentences, top_dialects}), 'built_at',
-- 'corpus_count', etc. Read directly so corpus_stats never scans.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
