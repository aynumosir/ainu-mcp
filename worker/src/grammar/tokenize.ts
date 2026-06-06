/**
 * Offset-preserving tokenizer for Latin-script Ainu.
 *
 * A token is a maximal run of word characters: ASCII letters, the pitch-accent
 * vowels (á é í ó ú / â …), the clitic boundary `=`, the morpheme hyphen `-`,
 * and the apostrophe `'` (glottal / elision). Whitespace and punctuation are
 * separators and are NOT emitted, but every token keeps its [start,end) offsets
 * into the original string so flags can anchor precisely.
 *
 * We keep clitics attached (`ku=nukar` is one token) — rules that care about the
 * `=` boundary inspect the surface; a separate detached `=` (e.g. "ku = nukar")
 * surfaces as its own punctuation gap, which the clitic-spacing rule detects.
 */
import type { Token } from "./types.js";

// Letters used in romanized Ainu, incl. accented vowels and clitic/hyphen marks.
const WORD = /[A-Za-zÀ-ÿ='-]+/g;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    const surface = m[0];
    const start = m.index ?? 0;
    tokens.push({ surface, start, end: start + surface.length, lower: surface.toLowerCase() });
  }
  return tokens;
}

/** Split into sentences with offsets — used by the capitalization rule. A
 * sentence ends at . ! ? 。！？ or a blank line. */
export function sentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.!?。！？\n]+/g;
  for (const m of text.matchAll(re)) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index ?? 0 });
  }
  return out;
}
