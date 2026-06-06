-- Software localization (i18n) strings from real Ainu-language software.
--
-- Gathered at seed time by etl/build_d1.py (src/ainu_mcp/localizations.py) from a
-- curated set of public GitHub projects (inlang / next-intl / MediaWiki message
-- catalogues). Each row is one translated UI message: an Ainu string keyed by its
-- message key, optionally paired with the project's source-language original
-- (usually English or Japanese) for the same key. Lets a translator see how a UI
-- concept has actually been rendered in Ainu across existing software.
--
-- Search mirrors the corpus pattern: a standalone FTS5 `trigram` table indexes
-- the Ainu text, the source text and the key (so MATCH is an indexed, CJK-safe
-- substring search over any of them); the display/filter columns are UNINDEXED.
-- rowid is emission order, so `ORDER BY rowid` is a stable "first N".
CREATE VIRTUAL TABLE l10n_fts USING fts5(
  text,                  -- the Ainu string
  source_text,           -- source-language original for the same key, if any
  key,                   -- flattened message key (dot/slash path)
  project UNINDEXED,     -- owning project slug ('owner/name')
  repo UNINDEXED,        -- GitHub 'owner/name'
  file_path UNINDEXED,   -- path of the message file within the repo
  lang UNINDEXED,        -- BCP-47 tag of the Ainu file: 'ain', 'ain-Latn', 'ain-Kana', …
  source_lang UNINDEXED, -- BCP-47 tag of source_text (e.g. 'en', 'ja'), if any
  tokenize = 'trigram'
);

-- One row per gathered project: metadata + string count, for l10n_list_projects.
CREATE TABLE l10n_projects (
  slug TEXT PRIMARY KEY,     -- 'owner/name'
  repo TEXT NOT NULL,
  title TEXT,
  description TEXT,
  url TEXT,
  format TEXT NOT NULL,      -- 'inlang' | 'next-intl' | 'mediawiki' | 'lookup'
  source_lang TEXT,          -- representative source language, if any
  strings INTEGER NOT NULL DEFAULT 0
);
