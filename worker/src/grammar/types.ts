/**
 * Shared types for the Ainu grammar checker (Phase 1: deterministic rules).
 *
 * A check produces offset-anchored Flags over the original text. Every flag is
 * stable-keyed by `error_class` (taxonomy key) and carries a span (char offsets
 * into the input), a human message, an optional fix, severity and confidence.
 * The shape is forward-compatible with the parser (Tier 2/3) and LLM-judge
 * (Tier 4) tiers, which only add flags / fill `detected_by`.
 */

export type Dialect = "hokkaido"; // Sakhalin branch deferred (v1 = Hokkaido Saru/Chitose)

export type Severity = "error" | "warning" | "info";
export type DetectedBy = "rule" | "parser" | "llm";

/** A word token with character offsets into the original text. */
export interface Token {
  surface: string;
  start: number; // inclusive char offset
  end: number; // exclusive char offset
  /** lowercased surface, accents kept — convenience for rules. */
  lower: string;
}

export interface Span {
  start: number;
  end: number;
}

export interface Suggestion {
  /** Replacement text for `span` (defaults to the flag's span). */
  replacement: string;
  span?: Span;
}

export interface Flag {
  /** Stable taxonomy key, e.g. "numeral_counting_form_attributive". */
  error_class: string;
  span: Span;
  surface: string;
  severity: Severity;
  /** 0..1. Deterministic rules are high; heuristics lower. */
  confidence: number;
  detected_by: DetectedBy;
  message: string;
  /** Why it's flagged + the rule, for the user / the LLM judge. */
  explanation: string;
  suggestion?: Suggestion;
  /** Free-form grounding (corpus counts, dictionary tag, …). */
  evidence?: string;
}

export interface CheckOptions {
  dialect: Dialect;
  /** Sentence-initial capitalization is an orthographic convention — opt-in. */
  checkCapitalization: boolean;
}

export interface GrammarCheckResult {
  text: string;
  dialect: Dialect;
  tokens: Token[];
  flags: Flag[];
  /**
   * Prompt the *calling* model can run as the Tier-4 judge (the MCP Worker makes
   * no model call). It should confirm/reject the rule flags and add discourse /
   * register / semantic errors in the same Flag shape.
   */
  judge_prompt: string;
  meta: { tiers_run: string[]; engine_version: string };
}

/** A single rule: pure function over tokens+text → flags. Keeps rules portable
 * (the site can import the same modules for in-browser checking). */
export type Rule = (tokens: Token[], text: string, opts: CheckOptions) => Flag[];
