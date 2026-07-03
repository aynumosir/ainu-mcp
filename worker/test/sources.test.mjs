/**
 * Sources write-tool helper tests — the pure snake→camel body building (incl.
 * the explicit-slug passthrough) and the upstream-error unwrapping, no network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins DOM/Workers types that
 * make a .ts test fail to resolve `bun:test`.
 */
import { test, expect } from "bun:test";
import { buildBody, upstreamErrorText } from "../src/tools/sources.ts";

const PROPS = { login: "mkpoli", name: "Test User" };

test("buildBody passes an explicit slug through verbatim", () => {
  const body = buildBody(
    { title: "アイヌ語法研究", slug: "1942-kindaichi-ainu-gohou", category: "primary", type: "grammar" },
    PROPS,
  );
  expect(body.slug).toBe("1942-kindaichi-ainu-gohou");
  expect(body.title).toBe("アイヌ語法研究");
});

test("buildBody omits slug entirely when not provided (server derives one)", () => {
  const body = buildBody({ title: "T", category: "primary", type: "book" }, PROPS);
  expect("slug" in body).toBe(false);
});

test("buildBody keeps the snake→camel mapping intact around the new key", () => {
  const body = buildBody(
    { title_en: "A Study", tags: ["lexicon"], year_start: 1942, revision_summary: "add" },
    PROPS,
  );
  expect(body.titleEn).toBe("A Study");
  expect(body.tagNames).toEqual(["lexicon"]);
  expect(body.yearStart).toBe(1942);
  expect(body.revisionSummary).toBe("add");
  expect(body.user).toEqual({ name: "Test User" });
});

test("upstreamErrorText unwraps the API's JSON rejection message", () => {
  const e = new Error(
    'upstream 400 Bad Request: {"message":"slug \\"taken-slug\\" is already taken by an existing source"}',
  );
  expect(upstreamErrorText(e)).toBe(
    'upstream 400 Bad Request: slug "taken-slug" is already taken by an existing source',
  );
});

test("upstreamErrorText leaves non-JSON and non-upstream errors untouched", () => {
  const html = new Error("upstream 500 Internal Server Error: <html>boom</html>");
  expect(upstreamErrorText(html)).toBe("upstream 500 Internal Server Error: <html>boom</html>");
  const plain = new Error("source_add requires aynumosir org membership");
  expect(upstreamErrorText(plain)).toBe("source_add requires aynumosir org membership");
});
