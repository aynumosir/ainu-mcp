/** Multi-dictionary lookup (port of ainu_mcp/dictionaries.py). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { listDictionaries, dictLookupPage, dictReverseLookup, type DictEntryRow } from "../db.js";
import { jsonResult } from "./helpers.js";

export interface LookupHit {
  dictionary: string;
  matched_in: string;
  entry: Record<string, unknown>;
  source_file: string | null;
}

const PAGE = 500;

/**
 * Faithful port of dictionaries.lookup: substring match across any field.
 *
 * Python scans every entry in dictionary-iteration order and returns the first
 * `limit` rows that match in some (optionally restricted) field. We reproduce
 * that exactly: the trigram index narrows to candidates, but we PAGE through
 * them (by id cursor) and confirm the match per-field — so there is no
 * candidate-cap truncation. `matched_in` and the field-scan order use the
 * persisted `field_order` (not Object.keys, which reorders numeric keys).
 *
 * When `dicts` is given we iterate them in the caller's order (Python does too);
 * otherwise a single global id-ordered scan == Python's _list_dicts() order.
 */
export async function lookupEntries(
  env: Env,
  opts: { word: string; dicts?: string[] | null; fields?: string[] | null; limit: number },
): Promise<LookupHit[]> {
  const q = opts.word.trim().toLowerCase();
  const limit = opts.limit > 0 ? Math.floor(opts.limit) : 0;
  if (!q || limit === 0) return [];
  const fieldFilter = opts.fields && opts.fields.length ? opts.fields : null;
  const out: LookupHit[] = [];

  const scan = async (dict: string | null): Promise<boolean> => {
    let afterId = 0;
    while (out.length < limit) {
      const rows = await dictLookupPage(env.DB, { q, dict, afterId, pageSize: PAGE });
      if (!rows.length) break;
      for (const row of rows) {
        afterId = row.id;
        const entry = JSON.parse(row.fields_json) as Record<string, unknown>;
        let order: string[];
        try {
          order = JSON.parse(row.field_order) as string[];
        } catch {
          order = Object.keys(entry);
        }
        const targets = fieldFilter ?? order;
        let matched: string | null = null;
        for (const k of targets) {
          const v = entry[k];
          if (typeof v === "string" && v.toLowerCase().includes(q)) {
            matched = k;
            break;
          }
        }
        if (!matched) continue;
        out.push({ dictionary: row.dictionary, matched_in: matched, entry, source_file: row.source_file });
        if (out.length >= limit) return true;
      }
      if (rows.length < PAGE) break;
    }
    return out.length >= limit;
  };

  if (opts.dicts && opts.dicts.length) {
    for (const name of opts.dicts) {
      if (await scan(name)) break;
    }
  } else {
    await scan(null);
  }
  return out;
}

function toReverseHit(row: DictEntryRow) {
  return {
    dictionary: row.dictionary,
    lemma: row.lemma,
    definition: row.definition ?? "",
    source_file: row.source_file,
  };
}

export function registerDictionaryTools(server: McpServer, env: Env): void {
  server.tool(
    "dictionary_list",
    "List every dictionary in the ainu-dictionaries collection with entry counts.",
    {},
    async () => jsonResult(await listDictionaries(env.DB)),
  );

  server.tool(
    "dictionary_lookup",
    "Look up a word across one or more Ainu dictionaries (Kayano, Tamura, Chiri, Nakagawa, Ota, Tane, Wiktionary, etc.). dicts filters to specific dictionary names from dictionary_list; fields restricts which columns to search within (default: all). For a clean Ainu → Japanese/English lookup specifically, prefer dictionary_reverse_lookup.",
    {
      word: z.string(),
      dicts: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional(),
      limit: z.number().int().default(30),
    },
    async ({ word, dicts, fields, limit }) => jsonResult(await lookupEntries(env, { word, dicts, fields, limit })),
  );

  server.tool(
    "dictionary_reverse_lookup",
    "Look up an Aynu form across every dictionary's lemma index — returns Japanese/English definitions for that exact Ainu word. Exact matches first, then substring matches. Use this when you know the Aynu form and want all glosses (Ota in particular only exposes meanings through this surface).",
    {
      aynu: z.string(),
      dicts: z.array(z.string()).optional(),
      limit: z.number().int().default(30),
    },
    async ({ aynu, dicts, limit }) => {
      const { exact, substr } = await dictReverseLookup(env.DB, { aynu, dicts, limit });
      const combined = [...exact, ...substr].slice(0, limit).map(toReverseHit);
      return jsonResult(combined);
    },
  );
}
