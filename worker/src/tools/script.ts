/** Script conversion (port of ainu_mcp/script.py) — uses the ainconv npm pkg. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  detect,
  separate,
  convertKanaToLatn,
  convertLatnToKana,
  convertCyrlToLatn,
  convertLatnToCyrl,
  convertKanaToCyrl,
  convertCyrlToKana,
} from "ainconv";
import { jsonResult } from "./helpers.js";

export type ScriptName = "latn" | "kana" | "cyrl";

// Mirrors the Python `_CONVERTERS` table exactly.
const CONVERTERS: Record<string, (s: string) => string> = {
  "kana>latn": convertKanaToLatn,
  "latn>kana": convertLatnToKana,
  "cyrl>latn": convertCyrlToLatn,
  "latn>cyrl": convertLatnToCyrl,
  "kana>cyrl": convertKanaToCyrl,
  "cyrl>kana": convertCyrlToKana,
};

export function convertScript(text: string, from: ScriptName, to: ScriptName): string {
  if (from === to) return text;
  const fn = CONVERTERS[`${from}>${to}`];
  if (!fn) throw new Error(`unsupported conversion: ${from} → ${to}`);
  return fn(text);
}

export function detectScript(text: string): string {
  return String(detect(text)).toLowerCase();
}

export function separateSyllables(word: string): string[] {
  const result = separate(word);
  return result ?? [];
}

export function allScripts(text: string): Record<string, string> {
  const src = detectScript(text);
  const out: Record<string, string> = { detected: src, input: text };
  for (const tgt of ["latn", "kana", "cyrl"] as ScriptName[]) {
    if (tgt === src) {
      out[tgt] = text;
      continue;
    }
    try {
      out[tgt] = convertScript(text, src as ScriptName, tgt);
    } catch (e) {
      out[tgt] = `(error: ${e instanceof Error ? e.message : String(e)})`;
    }
  }
  return out;
}

export function registerScriptTools(server: McpServer): void {
  server.tool(
    "convert_script",
    "Convert Ainu text between Latin, Katakana, and Cyrillic scripts (via ainconv).",
    {
      text: z.string(),
      from_script: z.enum(["latn", "kana", "cyrl"]),
      to_script: z.enum(["latn", "kana", "cyrl"]),
    },
    async ({ text, from_script, to_script }) => jsonResult(convertScript(text, from_script, to_script)),
  );

  server.tool(
    "detect_script",
    "Detect the script of an Ainu string. Returns one of latn, kana, cyrl.",
    { text: z.string() },
    async ({ text }) => jsonResult(detectScript(text)),
  );

  server.tool(
    "script_all",
    "Detect the input's script and return its renditions in all three scripts.",
    { text: z.string() },
    async ({ text }) => jsonResult(allScripts(text)),
  );
}
