/**
 * Clitic rules — personal-affix portmanteau and `=` boundary orthography.
 *
 * (1) Portmanteau eci=: the 1SG-subject acting on a 2nd-person object is NOT
 *     ku=…e=… ; Ainu uses the portmanteau eci= ("I … you"). So *ku=e=nukar →
 *     eci=nukar. (Tamura/Bugaeva.) High-confidence deterministic error.
 *
 * (2) Boundary spacing: personal clitics attach to their host with `=` and no
 *     surrounding space — ku=nukar, not "ku= nukar" / "ku = nukar"; …=an, not
 *     "… =an". A bare floating "=" is also flagged.
 *
 * These operate on the raw text (regex) so spans are exact char offsets.
 */
import type { CheckOptions, Flag, Rule, Token } from "../types.js";

// Subject/object clitics that attach with "=".
const PREFIX = ["ku", "k", "a", "ci", "eci", "e", "i", "en", "un"];
const SUFFIX = ["an", "as"];

export const cliticRule: Rule = (_tokens: Token[], text: string, _opts: CheckOptions): Flag[] => {
  const flags: Flag[] = [];

  // (1) ku= e= → eci=  (allow an optional space between the two clitics)
  for (const m of text.matchAll(/\bku=\s*e=/gi)) {
    const start = m.index ?? 0;
    flags.push({
      error_class: "clitic_portmanteau_eci",
      span: { start, end: start + m[0].length },
      surface: m[0],
      severity: "error",
      confidence: 0.95,
      detected_by: "rule",
      message: `Use the portmanteau "eci=" for a 1sg subject acting on a 2nd-person object, not "${m[0]}".`,
      explanation:
        'When "I" act on "you", Ainu uses the single clitic eci= (e.g. eci=nukar "I see you"), not ku= + e=.',
      suggestion: { replacement: "eci=" },
      evidence: "Tamura 1996; Bugaeva (Handbook) personal-affix paradigm",
    });
  }

  // (2a) detached prefix clitic: "ku= nukar" / "a = nukar"
  const prefRe = new RegExp(`\\b(${PREFIX.join("|")})\\s*=\\s+(?=[A-Za-zÀ-ÿ])`, "g");
  for (const m of text.matchAll(prefRe)) {
    const start = m.index ?? 0;
    const joined = m[1] + "=";
    flags.push({
      error_class: "clitic_boundary_spacing",
      span: { start, end: start + m[0].length },
      surface: m[0],
      severity: "error",
      confidence: 0.9,
      detected_by: "rule",
      message: `Clitic "${m[1]}=" must attach to its host with no space.`,
      explanation: 'Personal clitics attach directly via "=", e.g. ku=nukar — never "ku= nukar".',
      suggestion: { replacement: joined },
    });
  }

  // (2b) detached suffix clitic: "nukar =an" / "ek =as"
  const sufRe = new RegExp(`\\s+=(${SUFFIX.join("|")})\\b`, "g");
  for (const m of text.matchAll(sufRe)) {
    const start = m.index ?? 0;
    flags.push({
      error_class: "clitic_boundary_spacing",
      span: { start, end: start + m[0].length },
      surface: m[0],
      severity: "error",
      confidence: 0.9,
      detected_by: "rule",
      message: `Clitic "=${m[1]}" must attach to its host with no space.`,
      explanation: 'The intransitive/1pl subject clitic attaches directly, e.g. arpa=an — never "arpa =an".',
      suggestion: { replacement: "=" + m[1] },
    });
  }

  return flags;
};
