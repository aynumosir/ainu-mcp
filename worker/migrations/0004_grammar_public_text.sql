-- Public project-authored grammar plain text (Hokkaido + Sakhalin).
--
-- Adds metadata columns to the grammar bibliography/search tables so the ETL can
-- seed complete, freely-readable chapters from sibling repos ainu-grammar-
-- hokkaido and aynu-itah. Existing third-party ainu-grammar OCR remains snippet-
-- searchable only (plain_text_available=0).
ALTER TABLE grammar_materials ADD COLUMN source TEXT NOT NULL DEFAULT 'ainu-grammar';
ALTER TABLE grammar_materials ADD COLUMN summary TEXT;
ALTER TABLE grammar_materials ADD COLUMN part TEXT;
ALTER TABLE grammar_materials ADD COLUMN variant TEXT;
ALTER TABLE grammar_materials ADD COLUMN license TEXT;
ALTER TABLE grammar_materials ADD COLUMN plain_text_available INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_grammar_path ON grammar_materials (path);

-- FTS5 virtual tables cannot be ALTERed. Recreate grammar_fts with the new
-- unindexed metadata columns; the subsequent reset+reseed reloads all rows.
DROP TABLE grammar_fts;
CREATE VIRTUAL TABLE grammar_fts USING fts5(
  content,
  path UNINDEXED,
  source UNINDEXED,
  kind UNINDEXED,
  title UNINDEXED,
  summary UNINDEXED,
  part UNINDEXED,
  variant UNINDEXED,
  license UNINDEXED,
  plain_text_available UNINDEXED,
  repo_path UNINDEXED,
  tokenize = 'trigram'
);
