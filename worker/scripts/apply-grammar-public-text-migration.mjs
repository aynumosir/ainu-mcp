#!/usr/bin/env bun
/**
 * Idempotently apply the schema changes needed for public authored grammar text.
 *
 * This is intentionally a script (rather than relying only on the raw SQL
 * migration) because the monthly reseed workflow may be re-run after the schema
 * has already been upgraded. SQLite/libSQL ALTER TABLE ADD COLUMN is not safely
 * idempotent across all deployed versions, so we inspect first.
 *
 * Run immediately before a full reset+reload. If grammar_fts is still in the old
 * shape, this drops and recreates it; the following seed reload repopulates it.
 *
 * DESTRUCTIVE-REBUILD GUARD: recreating grammar_fts empties it, so it is only
 * safe when the caller is about to reload ALL grammar_fts rows (the full reseed).
 * The targeted authored-grammar fast path only reloads the ~200 authored rows and
 * would otherwise lose the ~900 legacy ainu-grammar OCR rows. So the rebuild is
 * gated behind --allow-fts-rebuild (or ALLOW_FTS_REBUILD=1); without it, a needed
 * rebuild aborts loudly instead of silently dropping legacy fulltext.
 */
import { createClient } from "@libsql/client";

const allowFtsRebuild =
  process.argv.includes("--allow-fts-rebuild") || process.env.ALLOW_FTS_REBUILD === "1";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function columns(table) {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(rs.rows.map((r) => String(r.name)));
}

async function addColumnIfMissing(table, name, ddl) {
  const cols = await columns(table);
  if (cols.has(name)) {
    console.log(`${table}.${name}: already present`);
    return;
  }
  console.log(`${table}.${name}: adding`);
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

await addColumnIfMissing("grammar_materials", "source", "source TEXT NOT NULL DEFAULT 'ainu-grammar'");
await addColumnIfMissing("grammar_materials", "summary", "summary TEXT");
await addColumnIfMissing("grammar_materials", "part", "part TEXT");
await addColumnIfMissing("grammar_materials", "variant", "variant TEXT");
await addColumnIfMissing("grammar_materials", "license", "license TEXT");
await addColumnIfMissing("grammar_materials", "plain_text_available", "plain_text_available INTEGER NOT NULL DEFAULT 0");
await client.execute("CREATE INDEX IF NOT EXISTS idx_grammar_path ON grammar_materials (path)");

const ftsSchema = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'grammar_fts'");
const sql = String(ftsSchema.rows[0]?.sql ?? "");
const needsFtsRebuild = !/repo_path\s+UNINDEXED/i.test(sql) || !/plain_text_available\s+UNINDEXED/i.test(sql);
if (needsFtsRebuild) {
  if (!allowFtsRebuild) {
    console.error(
      "::error::grammar_fts needs a destructive rebuild (missing public-text columns), " +
        "but --allow-fts-rebuild was not passed. Recreating the table would empty it, and " +
        "this caller only reloads a subset of rows — so aborting to avoid destroying legacy " +
        "ainu-grammar OCR fulltext. Run the full 'Refresh Turso reference data' workflow " +
        "(which passes --allow-fts-rebuild and reloads every grammar_fts row) first.",
    );
    process.exit(1);
  }
  console.log("grammar_fts: rebuilding with public-text metadata columns");
  await client.batch(
    [
      "DROP TABLE IF EXISTS grammar_fts",
      `CREATE VIRTUAL TABLE grammar_fts USING fts5(
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
      )`,
    ],
    "write",
  );
} else {
  console.log("grammar_fts: already has public-text metadata columns");
}

console.log("✓ grammar public-text schema is ready");
