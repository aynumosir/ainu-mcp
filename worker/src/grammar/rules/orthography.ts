/**
 * Orthographic conventions. Opt-in only (these are house-style, not grammar).
 *
 * Sentence-initial capitalization: ported from the existing site checker. Off by
 * default — Ainu is frequently written all-lowercase, so this is enabled only
 * when the caller asks (checkCapitalization).
 */
import type { CheckOptions, Flag, Rule, Token } from "../types.js";
import { sentences } from "../tokenize.js";

const LETTER = /[A-Za-zÀ-ÿ]/;

export const capitalizationRule: Rule = (_tokens: Token[], text: string, opts: CheckOptions): Flag[] => {
  if (!opts.checkCapitalization) return [];
  const flags: Flag[] = [];
  for (const s of sentences(text)) {
    // first letter offset within this sentence
    const rel = s.text.search(LETTER);
    if (rel < 0) continue;
    const ch = s.text[rel];
    if (ch === ch.toLowerCase() && ch !== ch.toUpperCase()) {
      const start = s.start + rel;
      flags.push({
        error_class: "sentence_initial_capitalization",
        span: { start, end: start + 1 },
        surface: ch,
        severity: "info",
        confidence: 0.5,
        detected_by: "rule",
        message: `Sentence starts with lowercase "${ch}".`,
        explanation: "House style capitalizes the first letter of a sentence (convention — disable if not desired).",
        suggestion: { replacement: ch.toUpperCase() },
      });
    }
  }
  return flags;
};
