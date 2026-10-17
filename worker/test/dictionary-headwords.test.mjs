import { beforeAll, afterAll, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dictReverseLookup } from "../src/db.ts";

const client = createClient({ url: ":memory:" });
const statement = (sql, args = []) => ({
  bind: (...a) => statement(sql, a),
  all: async () => ({ results: (await client.execute({ sql, args })).rows }),
});
const db = { prepare: sql => statement(sql) };
const source = "1995_Nakagawa_Ainu-Chitose-Dialect-Dictionary";

beforeAll(async () => {
  await client.executeMultiple(readFileSync("migrations/0001_init.sql", "utf8"));
  const rows = [["eawnarura", "eawnarura", "運ぶ"], ["rur, -i", "rur", "海の潮"], ["askepet, -i", "askepet", "指"]];
  for (const [i, [lemma, key, definition]] of rows.entries()) {
    await client.execute({
      sql: "INSERT INTO dict_entries(id,dictionary,lemma,lemma_lower,definition,fields_json,field_order,all_text_lower) VALUES(?,?,?,?,?,?,?,?)",
      args: [i + 1, source, lemma, key, definition, "{}", "[]", lemma],
    });
  }
  await client.execute("INSERT INTO dict_fts(rowid,lemma,all_text_lower) SELECT id,lemma,all_text_lower FROM dict_entries");
  await client.execute({
    sql: "INSERT INTO dict_entries(id,dictionary,lemma,lemma_lower,definition,fields_json,field_order,all_text_lower) VALUES(?,?,?,?,?,?,?,?)",
    args: [4, "dobrotvorsky", "Авонги", "авонги", "", "{}", "[]", "авонги"],
  });
});
afterAll(() => client.close());

test("bare and printed Nakagawa headings rank exactly once before substrings", async () => {
  for (const aynu of ["rur", " RUR ", "rur, -i"]) {
    const result = await dictReverseLookup(db, { aynu, dicts: [source], limit: 1 });
    expect(result.exact.map(r => r.lemma)).toEqual(["rur, -i"]);
    expect(result.substr.some(r => r.lemma === "rur, -i")).toBe(false);
  }
});

test("suffix text remains a substring search rather than an exact lexical entry", async () => {
  const result = await dictReverseLookup(db, { aynu: "-i", dicts: [source], limit: 10 });
  expect(result.exact).toEqual([]);
  expect(result.substr.map(r => r.lemma)).toEqual(["rur, -i", "askepet, -i"]);
});

test("short Unicode queries keep the precomputed Unicode case folding", async () => {
  const result = await dictReverseLookup(db, { aynu: "а", dicts: ["dobrotvorsky"], limit: 10 });
  expect(result.substr.map(r => r.lemma)).toEqual(["Авонги"]);
});
