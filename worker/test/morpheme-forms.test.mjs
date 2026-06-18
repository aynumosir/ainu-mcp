/**
 * morphology_forms URL-builder tests — the pure query-encoding/omission logic
 * for the MDB /api/forms proxy, no network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins types that make a .ts test
 * fail to resolve `bun:test`.
 */
import { test, expect } from "bun:test";
import { formsUrl } from "../src/tools/morpheme.ts";

test("formsUrl always sends lemma + limit, targeting MDB /api/forms", () => {
  expect(formsUrl({ lemma: "sapa", limit: 30 })).toBe(
    "https://mdb.aynu.org/api/forms?lemma=sapa&limit=30",
  );
});

test("formsUrl omits unset optional filters", () => {
  const url = formsUrl({ lemma: "ahun", limit: 10 });
  expect(url).not.toContain("category=");
  expect(url).not.toContain("relation=");
  expect(url).not.toContain("feature=");
  expect(url).not.toContain("provenance=");
});

test("formsUrl appends each provided filter", () => {
  const url = formsUrl({
    lemma: "san",
    category: "verbal",
    relation: "plural",
    feature: "object",
    provenance: "attested",
    limit: 5,
  });
  const params = new URL(url).searchParams;
  expect(params.get("lemma")).toBe("san");
  expect(params.get("category")).toBe("verbal");
  expect(params.get("relation")).toBe("plural");
  expect(params.get("feature")).toBe("object");
  expect(params.get("provenance")).toBe("attested");
  expect(params.get("limit")).toBe("5");
});

test("formsUrl percent-encodes the lemma and feature values", () => {
  const url = formsUrl({ lemma: "kor pe", feature: "a=e", limit: 30 });
  // space → +, '=' → %3D under URLSearchParams encoding
  expect(url).toContain("lemma=kor+pe");
  expect(url).toContain("feature=a%3De");
  // round-trips back to the original values
  const params = new URL(url).searchParams;
  expect(params.get("lemma")).toBe("kor pe");
  expect(params.get("feature")).toBe("a=e");
});
