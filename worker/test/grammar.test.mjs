/** Grammar query-layer tests for public authored grammar text metadata/retrieval. */
import { test, expect, beforeAll } from "bun:test";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { grammarList, grammarFilenameSearch, grammarTranscribedSearch, grammarGetPlainText } from "../src/db.ts";
import { extractSnippets, materialOut, textHitOut } from "../src/tools/grammar.ts";

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

beforeAll(async () => {
  await client.executeMultiple(readFileSync("migrations/0001_init.sql", "utf8"));
  await client.executeMultiple(readFileSync("migrations/0004_grammar_public_text.sql", "utf8"));
  await client.execute({
    sql: `INSERT INTO grammar_materials(source, kind, path, filename, year, author, title, summary, part, variant, license, plain_text_available)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      "hokkaido",
      "hokkaido_grammar",
      "hokkaido/src/lib/grammar/chapters/person-marking-architecture.svelte",
      "person-marking-architecture.svelte",
      null,
      null,
      "Architecture of the Personal-Affix System",
      "How Hokkaido Ainu person marking works.",
      "Part X",
      "Hokkaido Ainu",
      "project-authored public plain text",
      1,
    ],
  });
  await client.execute({
    sql: `INSERT INTO grammar_fts(content, path, source, kind, title, summary, part, variant, license, plain_text_available, repo_path)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      "A Grammar of Hokkaido Ainu\nPerson marking uses ku=, eci=, a=, and =an in strict transitivity classes.",
      "hokkaido/src/lib/grammar/chapters/person-marking-architecture.svelte",
      "hokkaido",
      "hokkaido_grammar",
      "Architecture of the Personal-Affix System",
      "How Hokkaido Ainu person marking works.",
      "Part X",
      "Hokkaido Ainu",
      "project-authored public plain text",
      1,
      "src/lib/grammar/chapters/person-marking-architecture.svelte",
    ],
  });
  await client.execute({
    sql: `INSERT INTO grammar_fts(content, path, source, kind, title, summary, part, variant, license, plain_text_available, repo_path)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      "Legacy OCR mentions person marking but is snippet only.",
      "books/ocr/sample.txt",
      "ainu-grammar",
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      null,
    ],
  });
});

test("grammar_list exposes public authored chapter metadata", async () => {
  const rows = await grammarList(db, "hokkaido_grammar");
  expect(rows).toHaveLength(1);
  expect(materialOut(rows[0])).toMatchObject({
    source: "hokkaido",
    kind: "hokkaido_grammar",
    variant: "Hokkaido Ainu",
    plain_text_available: true,
  });
});

test("grammar filename search includes summary/variant metadata", async () => {
  const rows = await grammarFilenameSearch(db, "hokkaido", 10);
  expect(rows.map((r) => r.path)).toContain("hokkaido/src/lib/grammar/chapters/person-marking-architecture.svelte");
});

test("grammar fulltext search carries plain_text_available for authored chapter hits", async () => {
  const rows = await grammarTranscribedSearch(db, "person marking", 10);
  const authored = rows.find((r) => r.source === "hokkaido");
  expect(authored).toBeTruthy();
  const out = textHitOut(authored, extractSnippets(authored.content, "person marking"));
  expect(out).toMatchObject({ source: "hokkaido", plain_text_available: true, variant: "Hokkaido Ainu" });
});

test("grammar_get_text returns authored full text by public path and repo path, not legacy OCR", async () => {
  const byPublic = await grammarGetPlainText(db, "hokkaido/src/lib/grammar/chapters/person-marking-architecture.svelte");
  expect(byPublic.content).toContain("strict transitivity classes");
  const byRepo = await grammarGetPlainText(db, "src/lib/grammar/chapters/person-marking-architecture.svelte");
  expect(byRepo.title).toBe("Architecture of the Personal-Affix System");
  expect(await grammarGetPlainText(db, "books/ocr/sample.txt")).toBeNull();
});
