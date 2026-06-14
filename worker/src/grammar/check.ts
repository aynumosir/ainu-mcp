/**
 * Phase-1 grammar checker: runs the deterministic rule set over an Ainu sentence
 * and returns offset-anchored flags + a judge prompt for the Tier-4 LLM (run by
 * the *calling* model — this Worker makes no model call).
 *
 * Rules are pure and portable (no Worker/DB deps), so the site can import this
 * module to run the same Tier-1 checks in-browser.
 */
import type { CheckOptions, Dialect, Flag, GrammarCheckResult, Rule } from "./types.js";
import { tokenize } from "./tokenize.js";
import { cliticRule } from "./rules/clitics.js";
import { capitalizationRule } from "./rules/orthography.js";
import { numeralMdbRule, type PosLookup } from "./rules/numerals.js";

export const ENGINE_VERSION = "0.1.0";

// Pure surface rules (no POS needed). The numeral attributive/counting check is
// NOT here — it needs a part-of-speech lookup to avoid over-flagging the
// grammatical pre-verbal ("tup sanke") and post-nominal ("tewki tup") uses, so it
// runs as a separate POS-gated pass in checkGrammarWithMdb().
const RULES: Rule[] = [cliticRule, capitalizationRule];

export function checkGrammar(
  text: string,
  opts?: Partial<CheckOptions>,
): GrammarCheckResult {
  const dialect: Dialect = opts?.dialect ?? "hokkaido";
  const options: CheckOptions = { dialect, checkCapitalization: opts?.checkCapitalization ?? false };
  const tokens = tokenize(text);
  const flags: Flag[] = RULES.flatMap((rule) => rule(tokens, text, options)).sort(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end,
  );
  return {
    text,
    dialect,
    tokens,
    flags,
    judge_prompt: buildJudgePrompt(text, flags),
    meta: { tiers_run: ["rule"], engine_version: ENGINE_VERSION },
  };
}

/**
 * As checkGrammar(), plus the POS-gated numeral check (counting vs attributive,
 * e.g. tup→tu before a noun), resolved through `lookup` (the morpheme DB). If the
 * lookup fails (DB unavailable), it degrades to the rule-only result — the
 * numeral case then falls to the Tier-4 judge via judge_prompt.
 */
export async function checkGrammarWithMdb(
  text: string,
  opts: Partial<CheckOptions> | undefined,
  lookup: PosLookup,
): Promise<GrammarCheckResult> {
  const base = checkGrammar(text, opts);
  let extra: Flag[] = [];
  const tiers = ["rule"];
  try {
    extra = await numeralMdbRule(base.tokens, lookup);
    tiers.push("mdb");
  } catch {
    // MDB unreachable → degrade gracefully to rule-only.
  }
  if (!extra.length && tiers.length === 1) return base;
  const flags = [...base.flags, ...extra].sort(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end,
  );
  return { ...base, flags, judge_prompt: buildJudgePrompt(text, flags), meta: { tiers_run: tiers, engine_version: ENGINE_VERSION } };
}

/** Prompt the calling model uses as the Tier-4 judge. It must confirm/reject the
 * deterministic flags and add higher-level errors the rules can't see. */
function buildJudgePrompt(text: string, flags: Flag[]): string {
  return [
    "You are an Ainu (Hokkaido, Saru/Chitose) grammar judge. Review the sentence below.",
    `SENTENCE: ${JSON.stringify(text)}`,
    `RULE FLAGS (deterministic Tier-1; confirm or reject each): ${JSON.stringify(flags)}`,
    "Then ADD any errors the surface rules cannot catch, using the same flag shape",
    "{error_class, span:{start,end}, surface, severity, confidence, detected_by:'llm', message, explanation, suggestion}:",
    "- numeral form: a counting form (tup, rep, inep, sinep, …) used ATTRIBUTIVELY before a noun should be the bare attributive form (tu, re, ine, sine, …) — e.g. *tup cise → tu cise. NB the counting form is correct pre-verbally (tup sanke 'bring out two') and post-nominally (tewki tup 'two buckets'), so use the syntactic context;",
    "- valency / argument-marking: a transitive verb missing its object index, intransitive used transitively, ditransitive under-marking. NB reflexive yay- / indefinite-object i- verbs are INTRANSITIVE despite a transitive root — e.g. yaynu 'think' is vi (…sekor yaynu, ku=yaynu, yaynu=an; NEVER *a=yaynu+OBJ); the transitive 'think (that)' verb is the separate root ramu (…kuni a=ramu). So flag *a=yaynu / yaynu taking a direct object, and conversely *ramu=an;",
    "- personal-affix agreement and the 4th-person a=/-an vs ku= register in narrative;",
    "- number agreement (suppletive plural verb stems, -pa), obligatory possession on inalienable nouns;",
    "- ye vs e and other real-word confusions; semantics/fluency.",
    "Anchor every span to character offsets in SENTENCE. Prefer precision over recall; do not re-flag what the rules already cover unless you disagree.",
  ].join("\n");
}
