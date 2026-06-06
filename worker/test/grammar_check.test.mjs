/**
 * Ainu grammar checker tests.
 *
 * checkGrammar = pure surface rules (clitics, opt-in capitalization).
 * checkGrammarWithMdb = + the POS-gated numeral check (tu/tup), where part of
 * speech is resolved via an injected lookup (the morpheme DB in production).
 *
 * The NEGATIVE sets are the point: attested-correct Ainu — including the real
 * counting-form usages that a surface-only rule would over-flag — yields zero
 * numeral flags.
 *
 * .mjs (not .ts): the worker tsconfig pins types that break `bun:test` in .ts.
 */
import { test, expect } from "bun:test";
import { checkGrammar, checkGrammarWithMdb } from "../src/grammar/check.ts";

const classes = (r) => r.flags.map((f) => f.error_class);

// A fake morpheme-DB POS lookup for the numeral tests. Note: "tewki" and "kotan"
// are intentionally ABSENT (→ null), mirroring real gaps (tewki is in neither
// the morpheme nor lexeme inventory) so the conservative prev-gate is exercised.
const POS = { cise: "noun", wakka: "noun", sanke: "verb", wektor: "noun", arpa: "verb" };
const lookup = async (w) => POS[w] ?? null;

// ── clitics: eci= portmanteau ──
test("flags ku=e= portmanteau → eci=", () => {
  const f = checkGrammar("ku=e=nukar").flags.find((x) => x.error_class === "clitic_portmanteau_eci");
  expect(f).toBeTruthy();
  expect(f.suggestion.replacement).toBe("eci=");
  expect(f.severity).toBe("error");
  expect(f.span).toEqual({ start: 0, end: 5 });
});

// ── clitics: boundary spacing ──
test("flags detached prefix clitic (ku= nukar / a = kor)", () => {
  expect(classes(checkGrammar("ku= nukar"))).toContain("clitic_boundary_spacing");
  expect(classes(checkGrammar("a = kor"))).toContain("clitic_boundary_spacing");
});

test("flags detached suffix clitic (arpa =an)", () => {
  expect(classes(checkGrammar("arpa =an"))).toContain("clitic_boundary_spacing");
});

// ── capitalization is opt-in ──
test("capitalization off by default, on when enabled", () => {
  expect(classes(checkGrammar("tan pe ne."))).not.toContain("sentence_initial_capitalization");
  const f = checkGrammar("tan pe ne.", { checkCapitalization: true }).flags.find(
    (x) => x.error_class === "sentence_initial_capitalization",
  );
  expect(f && f.suggestion.replacement).toBe("T");
});

// ── numeral (POS-gated via MDB) ──
test("flags counting form before a noun (tup cise → tu)", async () => {
  const r = await checkGrammarWithMdb("tup cise", undefined, lookup);
  const f = r.flags.find((x) => x.error_class === "numeral_counting_form_attributive");
  expect(f).toBeTruthy();
  expect(f.surface).toBe("tup");
  expect(f.suggestion.replacement).toBe("tu");
  expect(f.detected_by).toBe("parser");
  expect(r.meta.tiers_run).toEqual(["rule", "mdb"]);
});

test("preserves capitalization (Tup Wektor → Tu, when MDB knows the noun)", async () => {
  const f = (await checkGrammarWithMdb("Tup Wektor", undefined, lookup)).flags.find(
    (x) => x.error_class === "numeral_counting_form_attributive",
  );
  expect(f.suggestion.replacement).toBe("Tu");
});

test("flags 're' counting form too (rep cise → re)", async () => {
  const f = (await checkGrammarWithMdb("rep cise", undefined, lookup)).flags.find(
    (x) => x.error_class === "numeral_counting_form_attributive",
  );
  expect(f.suggestion.replacement).toBe("re");
});

// numeral NEGATIVE set — real counting-form usages must NOT be flagged
test("does NOT flag post-nominal counting form when prev noun is unknown (tewki tup wakka)", async () => {
  // tewki → null (not in inventory); conservative gate must NOT flag.
  const r = await checkGrammarWithMdb("tewki tup wakka", undefined, lookup);
  expect(classes(r)).not.toContain("numeral_counting_form_attributive");
});

test("DOES flag when prev is a known non-noun and next is a noun (arpa tup cise)", async () => {
  const f = (await checkGrammarWithMdb("arpa tup cise", undefined, lookup)).flags.find(
    (x) => x.error_class === "numeral_counting_form_attributive",
  );
  expect(f && f.suggestion.replacement).toBe("tu");
});

test("does NOT flag pre-verbal counting form (tup sanke)", async () => {
  expect(classes(await checkGrammarWithMdb("tup sanke", undefined, lookup))).not.toContain(
    "numeral_counting_form_attributive",
  );
});

test("does NOT flag clause-final counting form / verb (kotan tup)", async () => {
  expect(classes(await checkGrammarWithMdb("kotan tup", undefined, lookup))).not.toContain(
    "numeral_counting_form_attributive",
  );
});

test("does NOT flag the attributive form (tu cise)", async () => {
  expect(classes(await checkGrammarWithMdb("tu cise", undefined, lookup))).not.toContain(
    "numeral_counting_form_attributive",
  );
});

test("unknown next-token POS → no numeral flag (defer to judge)", async () => {
  // 'foobar' unknown to the (fake) MDB → lookup returns null → not flagged.
  const r = await checkGrammarWithMdb("tup foobar", undefined, lookup);
  expect(classes(r)).not.toContain("numeral_counting_form_attributive");
});

test("degrades to rule-only when the MDB lookup throws", async () => {
  const boom = async () => {
    throw new Error("mdb down");
  };
  const r = await checkGrammarWithMdb("tup cise", undefined, boom);
  expect(classes(r)).not.toContain("numeral_counting_form_attributive");
  expect(r.meta.tiers_run).toEqual(["rule"]);
});

// ── NEGATIVE set (rule-only): attested-correct Ainu → zero flags ──
for (const ok of [
  "ku=nukar wa arpa=an",
  "eci=nukar ruwe ne",
  "i=soyke ta an wa tu cise ne oka=an wa utaspa uepunkine=an",
  "tu cise ka re cise ka",
]) {
  test(`no false positives (rule-only): ${ok}`, () => {
    expect(checkGrammar(ok).flags).toHaveLength(0);
  });
}

// ── result shape ──
test("result carries tokens, judge_prompt and meta", () => {
  const r = checkGrammar("ku=e=nukar");
  expect(r.tokens[0]).toMatchObject({ surface: "ku=e=nukar", start: 0 });
  expect(r.judge_prompt).toContain("Ainu");
  expect(r.meta.tiers_run).toEqual(["rule"]);
});
