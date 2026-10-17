/**
 * Early-records tool helper tests — the pure markup rendering and the unit
 * scoping rule, no network. Search ranking and filtering belong to the records
 * API and are tested there.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins types that make a .ts test
 * fail to resolve `bun:test`.
 */
import { test, expect } from "bun:test";
import { registerRecordsTools, renderNodes, unitNeedsSource } from "../src/tools/records.ts";


test("renderNodes writes 割書 columns inside one line", () => {
  expect(
    renderNodes([
      { t: "text", s: "天　リキタ" },
      { t: "warigaki", lines: [[{ t: "text", s: "升る　リキン" }], [{ t: "text", s: "高い　リイ" }]] },
    ]),
  ).toBe("天　リキタ⟨升る　リキン｜高い　リイ⟩");
});

test("renderNodes marks alternatives, gaps, editorial supplements and sic", () => {
  expect(
    renderNodes([
      { t: "text", s: "月　クンネチユツプ" },
      { t: "alt" },
      { t: "text", s: "アンチカラチユツ" },
      { t: "gap", reason: "blank" },
      { t: "editorial", s: "フ" },
      { t: "sic" },
    ]),
  ).toBe("月　クンネチユツプ／アンチカラチユツ［欠：空白］〔フ〕〔ママ〕");
});

test("renderNodes keeps ruby, corrections, notes, comments, quotations and emphasis", () => {
  expect(
    renderNodes([
      { t: "ruby", rb: "蝦夷", rt: "えぞ" },
      { t: "subst", del: "ヘ", add: "ベ" },
      { t: "noteref", n: "3" },
      { t: "comment", s: "朱書" },
      { t: "quote", nodes: [{ t: "text", s: "ワツカ" }], lang: "ain" },
      { t: "hi", rend: "right-line", s: "水" },
      { t: "hi", rend: "kenten", s: "火", mark: "。" },
    ]),
  ).toBe("蝦夷（えぞ）⟦ヘ→ベ⟧［注 3］［※ 朱書］「ワツカ」［右線：水］［圏点：。：火］");
});

test("unitNeedsSource holds a unit slug to its source, since works share them", () => {
  expect(unitNeedsSource({ unit: "ryukoku" })).toBe(true);
  expect(unitNeedsSource({ source: "ezo-soshi", unit: "ryukoku" })).toBe(false);
  expect(unitNeedsSource({ source: "moshiogusa" })).toBe(false);
  expect(unitNeedsSource({})).toBe(false);
});

// ── Transport: the proxy against a stubbed service binding ──

function stub(replies) {
  const seen = [];
  const env = {
    RECORDS: {
      fetch: (req) => {
        seen.push(new URL(req.url).pathname + new URL(req.url).search);
        const reply = replies.shift();
        return Promise.resolve(new Response(reply.body, { status: reply.status ?? 200 }));
      },
    },
  };
  return { env, seen };
}

function collect(env) {
  const tools = {};
  registerRecordsTools({ tool: (name, _d, schema, handler) => (tools[name] = { schema, handler }) }, env);
  return tools;
}

test("a search reaches /api/entries with its filters and returns the reply", async () => {
  const { env, seen } = stub([{ body: JSON.stringify({ data: { total: 6, capped: false, items: [{ id: "x" }] } }) }]);
  const result = await collect(env).records_search.handler(
    { query: "雨", source: "moshiogusa", unit: "ninjal-1", limit: 20, offset: 0 });
  expect(seen[0]).toBe("/api/entries?q=%E9%9B%A8&source=moshiogusa&unit=ninjal-1&limit=20&offset=0");
  expect(JSON.parse(result.content[0].text).total).toBe(6);
  expect(result.isError).toBeUndefined();
});

test("a page renders each line and keeps what the leaf itself carries", async () => {
  const page = {
    n: 2, status: "completed", updatedAt: null, platformUrl: "p", image: "i",
    physical: ["右丁 白紙"],
    notes: [{ type: "note", content: "「𠧱」の古字", by: "u", at: "2026-05-16T06:40:35.712Z" }],
    halves: [{ side: null, lines: [{ n: 1, nodes: [{ t: "text", s: "天" }, { t: "hi", rend: "kenten", s: "地" }] }] }],
  };
  const { env } = stub([{ body: JSON.stringify({ data: { source: "s", unit: "u", page, items: [{ id: "i" }] } }) }]);
  const data = JSON.parse((await collect(env).records_get_page.handler(
    { source: "s", unit: "u", page: 2, include_items: true, include_markup: true })).content[0].text);
  expect(data.physical).toEqual(["右丁 白紙"]);
  expect(data.notes[0].content).toBe("「𠧱」の古字");
  expect(data.halves[0].lines[0].text).toBe("天［圏点：地］");
  expect(data.halves[0].lines[0].nodes).toEqual(page.halves[0].lines[0].nodes);
  expect(data.items).toEqual([{ id: "i" }]);
});

test("include_items=false drops the items and keeps the transcription", async () => {
  const page = { n: 1, status: "completed", updatedAt: null, platformUrl: "p", image: null, physical: [], notes: [],
    halves: [{ side: null, lines: [{ n: 1, nodes: [{ t: "text", s: "天" }] }] }] };
  const { env } = stub([{ body: JSON.stringify({ data: { source: "s", unit: "u", page, items: [{ id: "i" }] } }) }]);
  const data = JSON.parse((await collect(env).records_get_page.handler(
    { source: "s", unit: "u", page: 1, include_items: false, include_markup: false })).content[0].text);
  expect(data.items).toEqual([]);
  expect(data.halves[0].lines[0].text).toBe("天");
});

test("markup rides beside the text only when it is asked for", async () => {
  const page = { n: 1, status: "completed", updatedAt: null, platformUrl: "p", image: null, physical: [], notes: [],
    halves: [{ side: null, lines: [{ n: 1, nodes: [{ t: "text", s: "天" }] }] }] };
  const reply = { body: JSON.stringify({ data: { source: "s", unit: "u", page, items: [] } }) };
  const plain = JSON.parse((await collect(stub([reply]).env).records_get_page.handler(
    { source: "s", unit: "u", page: 1, include_items: true, include_markup: false })).content[0].text);
  expect(plain.halves[0].lines[0]).toEqual({ n: 1, text: "天" });
  const marked = JSON.parse((await collect(stub([reply]).env).records_get_page.handler(
    { source: "s", unit: "u", page: 1, include_items: true, include_markup: true })).content[0].text);
  expect(marked.halves[0].lines[0].nodes).toEqual([{ t: "text", s: "天" }]);
});

test("an upstream error becomes a tool error carrying its code", async () => {
  const { env } = stub([{ status: 404, body: JSON.stringify({ error: { code: "PAGE_NOT_FOUND", message: "no such page" } }) }]);
  const result = await collect(env).records_get_page.handler({ source: "s", unit: "u", page: 9999, include_items: true });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("PAGE_NOT_FOUND");
});

test("a reply with no data is an error rather than an empty result", async () => {
  for (const body of ["{}", "not json", JSON.stringify({ data: undefined })]) {
    const { env } = stub([{ body }]);
    const result = await collect(env).records_search.handler({ limit: 20, offset: 0 });
    expect(result.isError).toBe(true);
    expect(typeof result.content[0].text).toBe("string");
  }
});

test("a unit without its source never reaches the API", async () => {
  const { env, seen } = stub([]);
  const result = await collect(env).records_search.handler({ unit: "ryukoku", limit: 20, offset: 0 });
  expect(result.isError).toBe(true);
  expect(seen).toEqual([]);
});
