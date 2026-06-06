/**
 * Localization (i18n) query-layer tests.
 *
 * Runs the real db.ts helpers against an in-memory libSQL database loaded with
 * migration 0003 — so the FTS5 trigram MATCH, the <3-char LIKE fallback, and the
 * project/lang filters are all exercised exactly as in production.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins DOM/Workers types that make
 * a .ts test fail to resolve `bun:test`.
 */
import { test, expect, beforeAll } from "bun:test";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { localizationSearch, listLocalizationProjects } from "../src/db.ts";

// Minimal D1Database-shaped shim over a node libSQL client (mirrors src/libsql.ts,
// which uses the fetch-based /web client that can't open `:memory:`).
function d1(client) {
  const make = (sql, args = []) => ({
    bind: (...a) => make(sql, a),
    all: async () => ({ results: (await client.execute({ sql, args })).rows }),
    first: async () => (await client.execute({ sql, args })).rows[0] ?? null,
  });
  return { prepare: (sql) => make(sql) };
}

const client = createClient({ url: ":memory:" });
const db = d1(client);

const ROWS = [
  // text, source_text, key, project, repo, file_path, lang, source_lang
  ["Itakpo Ukotukka", "Word Order Illustrator", "meta_title", "mkpoli/word-order", "mkpoli/word-order", "messages/ain.json", "ain", "en"],
  ["Ieramasu", "Options", "params_options", "mkpoli/word-order", "mkpoli/word-order", "messages/ain.json", "ain", "en"],
  ["Tunci - Aynu itak", "ツンチ", "app.Home.title", "aynumosir/tunci", "aynumosir/tunci", "messages/ain-Latn.json", "ain-Latn", "ja"],
  ["Aynu itak", "アイヌ語", "app.About", "aynumosir/tunci", "aynumosir/tunci", "messages/ain-Latn.json", "ain-Latn", "ja"],
];

beforeAll(async () => {
  await client.executeMultiple(readFileSync("migrations/0003_localizations.sql", "utf8"));
  for (const r of ROWS) {
    await client.execute({
      sql: "INSERT INTO l10n_fts(text, source_text, key, project, repo, file_path, lang, source_lang) VALUES (?,?,?,?,?,?,?,?)",
      args: r,
    });
  }
  await client.execute({
    sql: "INSERT INTO l10n_projects(slug, repo, title, description, url, format, source_lang, strings) VALUES (?,?,?,?,?,?,?,?)",
    args: ["mkpoli/word-order", "mkpoli/word-order", "Word Order", "", "https://github.com/mkpoli/word-order", "inlang", "en", 5],
  });
  await client.execute({
    sql: "INSERT INTO l10n_projects(slug, repo, title, description, url, format, source_lang, strings) VALUES (?,?,?,?,?,?,?,?)",
    args: ["aynumosir/tunci", "aynumosir/tunci", "Tunci", "", "https://github.com/aynumosir/tunci", "next-intl", "ja", 2],
  });
});

test("FTS MATCH (>=3 chars) finds the Ainu text", async () => {
  const rows = await localizationSearch(db, { query: "Itakpo", limit: 20 });
  expect(rows.map((r) => r.key)).toContain("meta_title");
});

test("FTS MATCH also searches the source-language original", async () => {
  const rows = await localizationSearch(db, { query: "Options", limit: 20 });
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe("Ieramasu");
  expect(rows[0].source_lang).toBe("en");
});

test("FTS MATCH also searches the message key", async () => {
  const rows = await localizationSearch(db, { query: "params_options", limit: 20 });
  expect(rows.map((r) => r.text)).toContain("Ieramasu");
});

test("short query (<3 chars) uses the LIKE fallback", async () => {
  const rows = await localizationSearch(db, { query: "オ", limit: 20 }); // matches オプション? no; use Ainu
  expect(Array.isArray(rows)).toBe(true);
  const rows2 = await localizationSearch(db, { query: "Ay", limit: 20 });
  expect(rows2.some((r) => r.text.includes("Aynu") || r.text.includes("Ay"))).toBe(true);
});

test("project filter narrows by slug substring", async () => {
  const rows = await localizationSearch(db, { query: "itak", project: "tunci", limit: 20 });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.project === "aynumosir/tunci")).toBe(true);
});

test("lang filter is an exact match", async () => {
  const rows = await localizationSearch(db, { query: "itak", lang: "ain-Latn", limit: 20 });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.lang === "ain-Latn")).toBe(true);
});

test("empty query returns nothing", async () => {
  expect(await localizationSearch(db, { query: "   ", limit: 20 })).toEqual([]);
});

test("listLocalizationProjects orders by string count desc", async () => {
  const projects = await listLocalizationProjects(db);
  expect(projects.map((p) => p.slug)).toEqual(["mkpoli/word-order", "aynumosir/tunci"]);
  expect(projects[0].strings).toBe(5);
});
