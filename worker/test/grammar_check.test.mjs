/**
 * Phase-1 Ainu grammar checker tests.
 *
 * Phase 1 ships only the rules that are SAFE without a POS tagger: clitic
 * boundary spacing + the eci= portmanteau. The numeral attributive/counting
 * (tu/tup) rule is deferred to Phase 2 — adversarial corpus checking showed the
 * counting form is grammatical pre-verbally and post-nominally, so a POS-free
 * rule over-flags. The NEGATIVE set below locks that in: attested-correct Ainu,
 * including real counting-form usages, must produce ZERO flags.
 *
 * .mjs (not .ts): the worker tsconfig pins types that break `bun:test` in .ts.
 */
import { test, expect } from "bun:test";
import { checkGrammar } from "../src/grammar/check.ts";

const classes = (r) => r.flags.map((f) => f.error_class);

// ── clitics: eci= portmanteau ──
test("flags ku=e= portmanteau → eci=", () => {
  const r = checkGrammar("ku=e=nukar");
  const f = r.flags.find((x) => x.error_class === "clitic_portmanteau_eci");
  expect(f).toBeTruthy();
  expect(f.suggestion.replacement).toBe("eci=");
  expect(f.severity).toBe("error");
  expect(f.span).toEqual({ start: 0, end: 5 });
});

// ── clitics: boundary spacing ──
test("flags detached prefix clitic (ku= nukar)", () => {
  expect(classes(checkGrammar("ku= nukar"))).toContain("clitic_boundary_spacing");
});

test("flags detached prefix clitic with spaces (a = kor)", () => {
  expect(classes(checkGrammar("a = kor"))).toContain("clitic_boundary_spacing");
});

test("flags detached suffix clitic (arpa =an)", () => {
  expect(classes(checkGrammar("arpa =an"))).toContain("clitic_boundary_spacing");
});

// ── capitalization is opt-in ──
test("capitalization off by default", () => {
  expect(classes(checkGrammar("tan pe ne."))).not.toContain("sentence_initial_capitalization");
});

test("capitalization flagged when enabled", () => {
  const r = checkGrammar("tan pe ne.", { checkCapitalization: true });
  const f = r.flags.find((x) => x.error_class === "sentence_initial_capitalization");
  expect(f && f.suggestion.replacement).toBe("T");
});

// ── NEGATIVE set: attested-correct Ainu (incl. real counting-form usage) → zero flags ──
for (const ok of [
  "ku=nukar wa arpa=an", // attached clitics
  "eci=nukar ruwe ne", // correct eci= portmanteau, attached
  "i=soyke ta an wa tu cise ne oka=an wa utaspa uepunkine=an", // corpus (biratori)
  "tu cise ka re cise ka", // corpus
  "tewki tup a=kor kane wa", // corpus — counting form post-nominal (must NOT flag)
  "pon TOKKURI tup sanke hine", // corpus — counting form pre-verbal (must NOT flag)
  "ekimne=an ko tup sumawkor=an rep sumawkor=an", // corpus — tup/rep + verb (must NOT flag)
  "kotan tup", // corpus — tup = verb 'move' (must NOT flag)
]) {
  test(`no false positives: ${ok}`, () => {
    expect(checkGrammar(ok).flags).toHaveLength(0);
  });
}

// ── result shape ──
test("result carries tokens, judge_prompt (incl. tu/tup) and meta", () => {
  const r = checkGrammar("ku=e=nukar");
  expect(r.tokens[0]).toMatchObject({ surface: "ku=e=nukar", start: 0 });
  expect(r.judge_prompt).toContain("tup"); // tu/tup delegated to the LLM judge
  expect(r.meta.tiers_run).toEqual(["rule"]);
});
