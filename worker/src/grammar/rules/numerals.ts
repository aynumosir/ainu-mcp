/**
 * Numeral form rule — attributive vs. counting (nominal) form.
 *
 * Ainu numerals have two forms:
 *   • attributive, used directly before a head noun:  tu cise "two houses"
 *   • counting/nominal (suffix -p/-pe), used standing alone as a count:
 *     "tup" = "two (of them)", e.g. as a predicate "tup ne" = "they are two".
 *
 * Putting the counting form before a noun is a common error
 * (e.g. *tup cise → tu cise). Grounded in Tamura 1996 (連体 'attributive' vs 数名
 * 'counting numeral') and corpus evidence ("tu cise" attested; "tup cise" not).
 *
 * DEFERRED TO PHASE 2 (NOT in the active rule set — see check.ts). Adversarial
 * corpus verification showed the counting form is grammatical in positions a
 * POS-free rule can't exclude: pre-verbally ("tup sanke" = bring out two,
 * "tup sumawkor=an" = I get two game) and post-nominally ("tewki tup" = two
 * buckets, "tewki tup wakka" = two buckets' water); "tup" is also the verb
 * "to move" ("kotan tup" = the village moved). Reliably isolating the genuine
 * error (counting form used ATTRIBUTIVELY before a noun) needs the next token's
 * POS, so this rule waits for the Phase-2 tagger. Until then the tu/tup check is
 * handled by the Tier-4 judge (check.ts judge_prompt). The table + logic below
 * are kept for the tagger-gated Phase-2 version.
 */
import type { Flag, Rule, Token } from "../types.js";

// attributive → counting. Hokkaido (Saru/Chitose) -p/-pe series.
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["sine", "sinep"],
  ["tu", "tup"],
  ["re", "rep"],
  ["ine", "inep"],
  ["asikne", "asiknep"],
  ["iwan", "iwanpe"],
  ["arwan", "arwanpe"],
  ["tupesan", "tupesanpe"],
  ["sinepesan", "sinepesanpe"],
  ["wan", "wanpe"],
];

const COUNTING_TO_ATTR = new Map(PAIRS.map(([attr, count]) => [count, attr]));

// Function words after which a standalone (predicate) numeral is fine, so we do
// NOT flag "<counting> <word>" as attributive. Copulas, particles, conjunctions.
const FOLLOW_OK = new Set([
  "ne", "an", "oka", "okay", "ka", "wa", "kor", "korka", "patek", "poka",
  "hene", "ruwe", "sekor", "na", "no", "hi", "ya", "yak", "yakun", "akusu",
  "ne", "newa", "ranke",
]);

export const numeralRule: Rule = (tokens: Token[]): Flag[] => {
  const flags: Flag[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const attr = COUNTING_TO_ATTR.get(t.lower);
    if (!attr) continue;
    const next = tokens[i + 1];
    // No following word → standalone count, fine. Following function word → fine.
    if (!next || FOLLOW_OK.has(next.lower) || COUNTING_TO_ATTR.has(next.lower)) continue;
    flags.push({
      error_class: "numeral_counting_form_attributive",
      span: { start: t.start, end: t.end },
      surface: t.surface,
      severity: "warning",
      confidence: 0.65,
      detected_by: "rule",
      message: `Numeral "${t.surface}" is the counting form; before a noun use the attributive "${attr}".`,
      explanation:
        `Ainu numerals use the bare attributive form before a head noun (e.g. "${attr} cise" = "${attr} houses"); ` +
        `the -p/-pe counting form ("${t.lower}") is for standing alone as a count (e.g. "${t.lower} ne" = "they are ${attr === "tu" ? "two" : "N"}"). ` +
        `Here "${t.surface}" is directly followed by "${next.surface}", which looks attributive.`,
      suggestion: { replacement: preserveCase(t.surface, attr) },
      evidence: "Tamura 1996 (連体 vs 数名); ainu-corpora",
    });
  }
  return flags;
};

/** Keep the original capitalization when suggesting the replacement. */
function preserveCase(original: string, replacement: string): string {
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
