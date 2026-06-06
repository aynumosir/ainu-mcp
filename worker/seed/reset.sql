-- In-place reset for the scheduled reference-data refresh.
--
-- The refresh job rebuilds the full seed from the upstream data repos, clears
-- every reference-data table with this file, then re-applies the freshly built
-- seed/data/*.sql on top (see .github/workflows/refresh-reference-data.yml).
--
-- It deliberately does NOT touch the schema (migrations stay applied) so the
-- bound database_id never changes — the live Worker keeps reading the same DB.
--
-- dict_fts is an EXTERNAL-CONTENT FTS5 table over dict_entries, so it must be
-- emptied with the FTS5 'delete-all' command — a plain DELETE would try to read
-- now-deleted content rows. corpus_fts and grammar_fts are ordinary (content)
-- FTS5 tables and are cleared with DELETE. There are no foreign keys, so the
-- only ordering rule is: clear dict_fts (via delete-all, which never reads
-- dict_entries) before or after dict_entries — both are safe.
INSERT INTO dict_fts(dict_fts) VALUES('delete-all');
DELETE FROM dict_entries;
DELETE FROM dictionaries;
DELETE FROM corpus_fts;
DELETE FROM grammar_fts;
DELETE FROM grammar_materials;
DELETE FROM vocab_candidates;
DELETE FROM token_freq;
DELETE FROM stopwords;
DELETE FROM meta;
-- Localization (i18n) strings. l10n_fts is an ordinary (content) FTS5 table, so a
-- plain DELETE clears it.
DELETE FROM l10n_fts;
DELETE FROM l10n_projects;
