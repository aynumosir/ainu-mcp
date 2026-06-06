/**
 * Numeral form check — attributive vs. counting (nominal) form, POS-gated.
 *
 * Ainu numerals have two forms:
 *   • attributive, used directly before a head noun:  tu cise "two houses"
 *   • counting/nominal (suffix -p/-pe), used standing alone as a count
 *     ("tup ne" = "they are two"), post-nominally ("tewki tup" = "two buckets"),
 *     or pre-verbally ("tup sanke" = "bring out two").
 *
 * The error is the counting form used ATTRIBUTIVELY before a noun (*tup cise →
 * tu cise). A surface-only rule over-flags, because the counting form is also
 * grammatical pre-verbally and post-nominally (corpus-verified). So this rule is
 * POS-gated via the morpheme DB (env.MDB): flag a counting form only when the
 * NEXT token is a noun AND the PREVIOUS token is not a noun (i.e. the numeral is
 * not post-modifying a preceding noun). That isolates the genuine attributive
 * error while leaving "tewki tup wakka", "tup sanke", "kotan tup" (verb) alone.
 *
 * Grounded in Tamura 1996 (連体 'attributive' vs 数名 'counting') + ainu-corpora.
 */
import type { Flag, Token } from "../types.js";

// attributive → counting. Hokkaido (Saru/Chitose) -p/-pe series.
export const NUMERAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
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

export const COUNTING_TO_ATTR = new Map(NUMERAL_PAIRS.map(([attr, count]) => [count, attr]));

export type Pos = "noun" | "verb" | "other";
/** Resolve a word's part of speech (via the morpheme DB). null = unknown. */
export type PosLookup = (word: string) => Promise<Pos | null>;

export async function numeralMdbRule(tokens: Token[], lookup: PosLookup): Promise<Flag[]> {
  const flags: Flag[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const attr = COUNTING_TO_ATTR.get(t.lower);
    if (!attr) continue;
    const next = tokens[i + 1];
    if (!next || COUNTING_TO_ATTR.has(next.lower)) continue;
    // Only an attributive error if the counting form precedes a NOUN…
    const nextPos = await lookup(next.lower);
    if (nextPos !== "noun") continue;
    // …and is not counting a noun to its left ("tewki tup …"). Be conservative:
    // a preceding NOUN, or an UNKNOWN word (lookup → null; many nouns/loanwords
    // aren't in the inventory, e.g. "tewki"), both mean "could be N count" → skip.
    // Only flag when the previous token is positively a non-noun (verb/particle)
    // or absent — i.e. the numeral really opens the noun phrase.
    const prev = tokens[i - 1];
    if (prev) {
      const prevPos = await lookup(prev.lower);
      if (prevPos !== "verb" && prevPos !== "other") continue;
    }
    flags.push({
      error_class: "numeral_counting_form_attributive",
      span: { start: t.start, end: t.end },
      surface: t.surface,
      severity: "error",
      confidence: 0.9,
      detected_by: "parser",
      message: `Numeral "${t.surface}" is the counting form; before the noun "${next.surface}" use the attributive "${attr}".`,
      explanation:
        `Ainu numerals take the bare attributive form before a head noun (e.g. "${attr} ${next.lower}"); ` +
        `the -p/-pe counting form ("${t.lower}") is for standing alone, after a noun ("N ${t.lower}"), or before a verb. ` +
        `Here "${t.surface}" directly precedes the noun "${next.surface}".`,
      suggestion: { replacement: preserveCase(t.surface, attr) },
      evidence: `morpheme DB: "${next.lower}" is a noun, preceding token is not; Tamura 1996 (連体/数名)`,
    });
  }
  return flags;
}

/** Keep the original capitalization when suggesting the replacement. */
function preserveCase(original: string, replacement: string): string {
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
