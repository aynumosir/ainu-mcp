/**
 * grammar_check — check an Ainu sentence for grammatical / orthographic errors.
 *
 * Deterministic rule engine (src/grammar) run in the Worker:
 *  - clitic '=' boundary spacing + the eci= portmanteau (pure surface rules);
 *  - numeral attributive-vs-counting (tu vs tup) — POS-gated via the morpheme DB
 *    (env.MDB), so it flags "tup cise" → "tu cise" but not the grammatical
 *    "tewki tup" / "tup sanke" / "kotan tup".
 *
 * Returns offset-anchored flags + a `judge_prompt`. The Worker makes NO model
 * call: valency / argument-marking, 4th-person register, agreement and semantic
 * checks are listed in `judge_prompt` for the CALLING model to run as Tier-4.
 * Read surface — available to all authenticated users.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { checkGrammar, checkGrammarWithMdb } from "../grammar/check.js";
import type { Pos } from "../grammar/rules/numerals.js";
import { jsonResult, fetchJson } from "./helpers.js";

const MDB = "https://mdb.aynu.org";

/** Map a morpheme-DB category to a coarse POS. n/nl = noun, v* = verb. */
function posOfCategory(cat: string | undefined): Pos | null {
  if (!cat) return null;
  if (cat === "n" || cat === "nl") return "noun";
  if (cat.startsWith("v")) return "verb";
  return "other";
}

export function registerGrammarCheckTools(server: McpServer, env: Env): void {
  server.tool(
    "grammar_check",
    "Check an Ainu sentence (Hokkaido, Latin orthography) for grammatical and orthographic errors. " +
      "Deterministic checks: personal-clitic '=' boundary spacing, the eci= portmanteau (a 1sg subject acting on a " +
      "2nd-person object is eci=, not ku=…e=…), and numeral attributive-vs-counting form — e.g. it flags 'tup cise' → " +
      "'tu cise' (counting form wrongly used before a noun) while leaving grammatical uses like 'tewki tup' (two buckets) " +
      "and 'tup sanke' (bring out two) alone, using the morpheme DB for part-of-speech. " +
      "Returns offset-anchored flags + a `judge_prompt`. This tool makes no model call — for valency / argument-marking, " +
      "4th-person register, number/possession agreement and semantic/fluency errors, YOU (the calling model) should run " +
      "the returned `judge_prompt` to confirm/reject the rule flags and add those LLM-detected flags in the same shape.",
    {
      text: z.string().trim().min(1).max(2000),
      dialect: z.enum(["hokkaido"]).default("hokkaido"),
      check_capitalization: z.boolean().default(false),
      use_mdb: z.boolean().default(true).describe("use the morpheme DB for the POS-gated numeral check; set false for a fast, offline rule-only pass"),
    },
    async ({ text, dialect, check_capitalization, use_mdb }) => {
      const opts = { dialect, checkCapitalization: check_capitalization };
      if (!use_mdb) return jsonResult(checkGrammar(text, opts));
      const cache = new Map<string, Pos | null>();
      const lookup = async (word: string): Promise<Pos | null> => {
        if (cache.has(word)) return cache.get(word) ?? null;
        const q = encodeURIComponent(word);
        // Morpheme inventory first (has `category`); fall back to the lexeme bank
        // (`pos`) for words that are lexemes/compounds, not bare morphemes.
        const morph = (await fetchJson(env.MDB, `${MDB}/api/morphemes?q=${q}&limit=5`)) as {
          results?: { lemma?: string; category?: string }[];
        };
        const mr = morph.results ?? [];
        let pos = posOfCategory(mr.find((r) => (r.lemma ?? "").toLowerCase() === word.toLowerCase())?.category);
        if (pos === null) {
          const lex = (await fetchJson(env.MDB, `${MDB}/api/lexemes?q=${q}&limit=5`)) as {
            results?: { lemma?: string; pos?: string }[];
          };
          const lr = lex.results ?? [];
          pos = posOfCategory(lr.find((r) => (r.lemma ?? "").toLowerCase() === word.toLowerCase())?.pos);
        }
        cache.set(word, pos);
        return pos;
      };
      const result = await checkGrammarWithMdb(text, opts, lookup);
      return jsonResult(result);
    },
  );
}
