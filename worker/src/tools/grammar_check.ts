/**
 * grammar_check — check an Ainu sentence for grammatical / orthographic errors.
 *
 * Phase 1 runs a deterministic rule engine (src/grammar) in the Worker — numeral
 * attributive-vs-counting (tu/tup), clitic boundary + the eci= portmanteau, and
 * opt-in sentence capitalization — and returns offset-anchored flags plus a
 * `judge_prompt`. The Worker makes NO model call: for register / valency /
 * semantic judgments, the CALLING model runs `judge_prompt` itself (free Tier-4
 * judge over MCP). Parser/valency (Tier 2/3) lands in a later phase via a Python
 * sidecar. Read surface — available to all authenticated users.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkGrammar } from "../grammar/check.js";
import { jsonResult } from "./helpers.js";

export function registerGrammarCheckTools(server: McpServer): void {
  server.tool(
    "grammar_check",
    "Check an Ainu sentence (Hokkaido, Latin orthography) for grammatical and orthographic errors. " +
      "Phase 1 runs the deterministic rules that are safe without a parser: personal-clitic '=' boundary spacing " +
      "and the eci= portmanteau (a 1sg subject acting on a 2nd-person object is eci=, not ku=…e=…). " +
      "Returns offset-anchored flags with suggestions and a `judge_prompt`. " +
      "IMPORTANT: this tool makes no model call. Checks that need syntactic context — numeral attributive vs counting form " +
      "(tu vs tup), valency / argument-marking, 4th-person register, number/possession agreement, and semantic/fluency — " +
      "are listed in the returned `judge_prompt`, which YOU (the calling model) should run to confirm/reject the rule flags " +
      "and add those LLM-detected flags in the same shape. (Those become deterministic in Phase 2 via a POS tagger.)",
    {
      text: z.string().min(1),
      dialect: z.enum(["hokkaido"]).default("hokkaido"),
      check_capitalization: z.boolean().default(false),
    },
    async ({ text, dialect, check_capitalization }) => {
      const result = checkGrammar(text, { dialect, checkCapitalization: check_capitalization });
      return jsonResult(result);
    },
  );
}
