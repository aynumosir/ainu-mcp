#!/usr/bin/env bun
/**
 * Load seed SQL files into the Turso (libSQL) reference DB, as quote-aware
 * statements batched into transactions. This is robust for the large seed files
 * where `turso db shell < file.sql` drops the HTTP stream (`error 404: stream
 * not found`) and `turso db create --from-file` 502s on the ~600 MB .db.
 *
 * Usage (files applied in the given order, e.g. reset first, then the MANIFEST):
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *     bun scripts/load-turso.mjs seed/reset.sql seed/data/dict_entries_0001.sql ...
 *
 * After loading it runs a sanity check and exits non-zero if the core tables
 * came out implausibly small (so a bad build can't silently leave prod empty).
 *
 * `statements` is exported and unit-tested (load-turso.test.mjs); the load only
 * runs when this file is invoked directly (import.meta.main).
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

/** Split seed SQL into statements. Handles single-quoted strings with ''
 * escapes and `-- ` line comments; statements in the seed always end with `;`. */
export function* statements(sql) {
  let buf = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      buf += c;
      if (c === "'") {
        if (sql[i + 1] === "'") { buf += "'"; i++; } // escaped quote — stay in string
        else inStr = false;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === ";") { const s = buf.trim(); if (s) yield s; buf = ""; continue; }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) yield tail;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
    process.exit(1);
  }
  const client = createClient({ url, authToken });

  const BATCH = 50; // statements per transaction
  let grand = 0;
  for (const f of process.argv.slice(2)) {
    const stmts = [...statements(readFileSync(f, "utf8"))];
    process.stdout.write(`${f}: ${stmts.length} stmts ... `);
    for (let k = 0; k < stmts.length; k += BATCH) {
      await client.batch(stmts.slice(k, k + BATCH), "write");
    }
    grand += stmts.length;
    console.log("ok");
  }
  console.log(`loaded ${grand} statements`);

  // ── sanity: abort if the core tables look implausibly small ──
  const tables = [
    "corpus_fts", "dict_entries", "dictionaries", "grammar_materials",
    "grammar_fts", "token_freq", "stopwords", "vocab_candidates", "meta",
  ];
  const counts = {};
  for (const t of tables) {
    const rs = await client.execute(`SELECT count(*) AS n FROM ${t}`);
    counts[t] = Number(rs.rows[0].n);
  }
  console.log("counts:", JSON.stringify(counts));
  if (counts.corpus_fts < 100000 || counts.dict_entries < 100000 || counts.stopwords < 1) {
    console.error(`::error::post-reload counts look wrong: ${JSON.stringify(counts)}`);
    process.exit(1);
  }
  console.log("✓ reload complete and sane");
}

if (import.meta.main) await main();
