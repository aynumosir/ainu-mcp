/**
 * Aynuwiki tool helper tests — the pure title/URL/snippet logic, no network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins types that make a .ts test
 * fail to resolve `bun:test`.
 */
import { test, expect } from "bun:test";
import { articleUrl, resolveTitle, stripHtml } from "../src/tools/wiki.ts";

test("resolveTitle prepends the Incubator Wp/ain/ prefix when missing", () => {
  expect(resolveTitle("incubator", "Uykipenciya Mosem")).toBe("Wp/ain/Uykipenciya Mosem");
});

test("resolveTitle leaves an already-prefixed Incubator title untouched", () => {
  expect(resolveTitle("incubator", "Wp/ain/Uykipenciya Mosem")).toBe("Wp/ain/Uykipenciya Mosem");
});

test("resolveTitle is a no-op for Aynuwiki (no prefix)", () => {
  expect(resolveTitle("aynuwiki", "Mosem")).toBe("Mosem");
});

test("articleUrl maps spaces to underscores and keeps Wp/ain/ slashes", () => {
  expect(articleUrl("incubator", "Wp/ain/Uykipenciya Mosem")).toBe(
    "https://incubator.wikimedia.org/wiki/Wp/ain/Uykipenciya_Mosem",
  );
  expect(articleUrl("aynuwiki", "Mosem")).toBe("https://wiki.aynu.org/wiki/Mosem");
});

test("stripHtml removes MediaWiki snippet markup and decodes entities", () => {
  const snippet = 'Aynu <span class="searchmatch">itak</span> &amp; Sisam &quot;itak&quot;';
  expect(stripHtml(snippet)).toBe('Aynu itak & Sisam "itak"');
});
