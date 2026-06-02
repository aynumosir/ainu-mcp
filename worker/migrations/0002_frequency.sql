-- Word-frequency + stopwords for the corpus.
--
-- token_freq: every normalized Ainu corpus token with its occurrence count and a
-- stopword flag. Precomputed at seed time by etl/build_d1.py (same tokenizer +
-- normalization as the vocab-gap pass) so corpus_word_frequency / corpus_freq-
-- uency_list never scan the corpus. Unlike vocab_candidates this includes ALL
-- tokens (stopwords, single characters, dictionary-unattested) so a frequency
-- lookup can answer honestly for any word.
CREATE TABLE token_freq (
  token TEXT PRIMARY KEY,           -- gaps-normalized corpus token
  count INTEGER NOT NULL,
  is_stopword INTEGER NOT NULL DEFAULT 0
);
-- count DESC powers the frequency_list ordering and the O(log n) rank query
-- (rank = number of tokens with a strictly higher count + 1).
CREATE INDEX idx_token_freq_count ON token_freq (count DESC);
CREATE INDEX idx_token_freq_stopword ON token_freq (is_stopword);

-- stopwords: the canonical Ainu stopword list from aynumosir/ainu-stopwords.
-- `word` is the published form (trimmed); `normalized` is the gaps-normalized
-- form used to match against token_freq.token and corpus_word_frequency queries.
CREATE TABLE stopwords (
  word TEXT PRIMARY KEY,
  normalized TEXT NOT NULL
);
CREATE INDEX idx_stopwords_normalized ON stopwords (normalized);
