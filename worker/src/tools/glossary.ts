/**
 * Glossary read/write over Google Sheets (port of ainu_mcp/glossary.py).
 *
 * Reads are cached per isolate for _READ_TTL ms (the original 60s window) so
 * multi-category search/list calls stay well under the Sheets 60-reads/min
 * quota; writes invalidate the affected tab. Updates use optimistic locking via
 * a 12-hex-char row hash.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../types.js";
import { batchGetValues, getValues, appendValues, updateValues, tabRange } from "../sheets.js";
import { requireOrgMember } from "../auth.js";
import { jsonResult, errorResult } from "./helpers.js";

const READ_TTL = 60_000; // ms

export interface Category {
  isContent: boolean;
  sheetName: string;
  description: string;
  count: number;
  id: number | null;
}

interface Tab {
  headers: string[];
  rows: string[][];
}

// ── Per-isolate TTL cache ──
let cacheCategories: { at: number; data: Category[] } | null = null;
const cacheTabs = new Map<string, { at: number; data: Tab }>();

export function invalidate(tab?: string): void {
  cacheCategories = null;
  if (tab === undefined) cacheTabs.clear();
  else cacheTabs.delete(tab);
}

export async function rowHash(row: string[]): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.join("")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function listCategories(env: Env, force = false): Promise<Category[]> {
  const now = Date.now();
  if (!force && cacheCategories && now - cacheCategories.at < READ_TTL) return cacheCategories.data;
  const rows = await getValues(env, "all_sheets");
  const out: Category[] = [];
  for (const raw of rows.slice(1)) {
    const r = [...raw, "", "", "", "", ""].slice(0, 5);
    const [isContent, sheetName, description, count, gid] = r;
    if (!sheetName) continue;
    out.push({
      isContent: String(isContent).toUpperCase() === "TRUE",
      sheetName,
      description,
      count: /^\d+$/.test(String(count).trim()) ? parseInt(count, 10) : 0,
      id: /^-?\d+$/.test(String(gid).trim()) ? parseInt(gid, 10) : null,
    });
  }
  cacheCategories = { at: now, data: out };
  return out;
}

export async function contentSheetNames(env: Env): Promise<string[]> {
  return (await listCategories(env)).filter((c) => c.isContent).map((c) => c.sheetName);
}

function toTab(values: string[][]): Tab {
  if (values.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = values;
  const width = headers.length;
  const padded = rows.map((r) => [...r, ...Array(width).fill("")].slice(0, width));
  return { headers, rows: padded };
}

export async function readTab(env: Env, sheetName: string, force = false): Promise<Tab> {
  const now = Date.now();
  const cached = cacheTabs.get(sheetName);
  if (!force && cached && now - cached.at < READ_TTL) return cached.data;
  const values = await getValues(env, tabRange(sheetName));
  const tab = toTab(values);
  cacheTabs.set(sheetName, { at: now, data: tab });
  return tab;
}

export async function batchReadTabs(env: Env, sheetNames: string[]): Promise<Map<string, Tab>> {
  const now = Date.now();
  const needed = sheetNames.filter((n) => {
    const c = cacheTabs.get(n);
    return !(c && now - c.at < READ_TTL);
  });
  if (needed.length) {
    const valueRanges = await batchGetValues(env, needed.map(tabRange));
    needed.forEach((name, i) => {
      cacheTabs.set(name, { at: now, data: toTab(valueRanges[i] ?? []) });
    });
  }
  const result = new Map<string, Tab>();
  for (const n of sheetNames) result.set(n, cacheTabs.get(n)?.data ?? { headers: [], rows: [] });
  return result;
}

function fieldsOf(headers: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => (o[h] = row[i] ?? ""));
  return o;
}

// ──────────────────────────── Read tools ──────────────────────────── //

export function registerGlossaryReadTools(server: McpServer, env: Env): void {
  server.tool(
    "glossary_list_categories",
    "List every category (sheet tab) in the Itak-uoeroskip glossary, including metadata (description, entry count, sheet gid). Use this first to discover what categories exist before searching or adding entries.",
    {},
    async () => jsonResult(await listCategories(env)),
  );

  server.tool(
    "glossary_list_entries",
    "Page through entries in a category. Returns headers, total row count, and a slice of entries (each with row number and row_hash for safe editing).",
    { category: z.string(), limit: z.number().int().default(50), offset: z.number().int().default(0) },
    async ({ category, limit, offset }) => {
      const { headers, rows } = await readTab(env, category);
      const sliced = rows.slice(offset, offset + limit);
      const entries = await Promise.all(
        sliced.map(async (r, i) => ({
          category,
          row: offset + 2 + i,
          row_hash: await rowHash(r),
          fields: fieldsOf(headers, r),
        })),
      );
      return jsonResult({ category, headers, total: rows.length, returned: entries.length, offset, entries });
    },
  );

  server.tool(
    "glossary_get_entry",
    "Fetch one glossary entry by category + 1-indexed sheet row (row 1 is the header, so the first data row is 2). Returns fields and a row_hash to pass to glossary_update_entry for optimistic-locking safety.",
    { category: z.string(), row: z.number().int() },
    async ({ category, row }) => {
      const { headers, rows } = await readTab(env, category);
      const idx = row - 2;
      if (idx < 0 || idx >= rows.length) {
        return errorResult(`row ${row} out of range for '${category}' (has ${rows.length} data rows)`);
      }
      const r = rows[idx];
      return jsonResult({ category, row, row_hash: await rowHash(r), fields: fieldsOf(headers, r) });
    },
  );

  server.tool(
    "glossary_search",
    "Substring-search the glossary. Optionally restrict to specific columns (fields) or one category. Returns matching entries with row numbers and row_hashes.",
    {
      query: z.string(),
      fields: z.array(z.string()).optional(),
      category: z.string().optional(),
      limit: z.number().int().default(50),
    },
    async ({ query, fields, category, limit }) => jsonResult(await glossarySearch(env, { query, fields, category, limit })),
  );

  server.tool(
    "glossary_untranslated",
    "Find rows where one or more target language columns (日本語/English/中文 by default) is empty. Rows missing the Aynu cell are skipped by default. Returns rows grouped by category with the missing columns per row — a translation worklist.",
    {
      category: z.string().optional(),
      langs: z.array(z.string()).optional(),
      require_aynu: z.boolean().default(true),
      limit: z.number().int().default(200),
    },
    async ({ category, langs, require_aynu, limit }) =>
      jsonResult(await glossaryUntranslated(env, { category, langs, requireAynu: require_aynu, limit })),
  );
}

export async function glossarySearch(
  env: Env,
  opts: { query: string; fields?: string[]; category?: string; limit: number },
): Promise<Array<{ category: string; row: number; row_hash: string; fields: Record<string, string>; matched_in: string }>> {
  const q = opts.query.trim().toLowerCase();
  if (!q) return [];
  const cats = opts.category ? [opts.category] : await contentSheetNames(env);
  const tabData = await batchReadTabs(env, cats);
  const hits: Array<{ category: string; row: number; rowArr: string[]; headers: string[]; matched_in: string }> = [];
  for (const cat of cats) {
    const { headers, rows } = tabData.get(cat) ?? { headers: [], rows: [] };
    const targetFields = opts.fields ?? headers;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let h = 0; h < headers.length; h++) {
        if (!targetFields.includes(headers[h])) continue;
        if ((row[h] ?? "").toLowerCase().includes(q)) {
          hits.push({ category: cat, row: i + 2, rowArr: row, headers, matched_in: headers[h] });
          break;
        }
      }
      if (hits.length >= opts.limit) {
        return Promise.all(
          hits.map(async (hh) => ({
            category: hh.category,
            row: hh.row,
            row_hash: await rowHash(hh.rowArr),
            fields: fieldsOf(hh.headers, hh.rowArr),
            matched_in: hh.matched_in,
          })),
        );
      }
    }
  }
  return Promise.all(
    hits.map(async (hh) => ({
      category: hh.category,
      row: hh.row,
      row_hash: await rowHash(hh.rowArr),
      fields: fieldsOf(hh.headers, hh.rowArr),
      matched_in: hh.matched_in,
    })),
  );
}

async function glossaryUntranslated(
  env: Env,
  opts: { category?: string; langs?: string[]; requireAynu: boolean; limit: number },
) {
  const targetLangs = opts.langs ?? ["日本語", "English", "中文"];
  const cats = opts.category ? [opts.category] : await contentSheetNames(env);
  const tabData = await batchReadTabs(env, cats);
  const byCategory: Record<string, Array<{ category: string; row: number; row_hash: string; missing: string[]; fields: Record<string, string> }>> = {};
  let totalMissing = 0;
  for (const cat of cats) {
    const { headers, rows } = tabData.get(cat) ?? { headers: [], rows: [] };
    if (!headers.length) continue;
    const relevant = targetLangs.filter((l) => headers.includes(l));
    if (!relevant.length) continue;
    const catHits: Array<{ category: string; row: number; row_hash: string; missing: string[]; fields: Record<string, string> }> = [];
    for (let i = 0; i < rows.length; i++) {
      const fields = fieldsOf(headers, rows[i]);
      if (opts.requireAynu && !(fields["Aynu"] ?? "").trim()) continue;
      const missing = relevant.filter((l) => !(fields[l] ?? "").trim());
      if (!missing.length) continue;
      catHits.push({ category: cat, row: i + 2, row_hash: await rowHash(rows[i]), missing, fields });
      totalMissing++;
      if (totalMissing >= opts.limit) {
        if (catHits.length) byCategory[cat] = catHits;
        return { total: totalMissing, by_category: byCategory };
      }
    }
    if (catHits.length) byCategory[cat] = catHits;
  }
  return { total: totalMissing, by_category: byCategory };
}

// ──────────────────────────── Write tools ──────────────────────────── //

export function registerGlossaryWriteTools(server: McpServer, env: Env, props: Props): void {
  server.tool(
    "glossary_add_entry",
    "Append a new entry to a category tab. fields keys must match the tab's column headers (e.g. Aynu, 日本語, English, 中文, 註 / Notes); unknown keys are silently ignored. Returns the new row number and row_hash.",
    { category: z.string(), fields: z.record(z.string()) },
    async ({ category, fields }) => {
      requireOrgMember(props, "glossary_add_entry");
      const { headers, rows } = await readTab(env, category);
      const newRow = headers.map((h) => fields[h] ?? "");
      const { updatedRange } = await appendValues(env, tabRange(category), newRow);
      invalidate(category);
      return jsonResult({
        category,
        row: rows.length + 2,
        row_hash: await rowHash(newRow),
        fields: fieldsOf(headers, newRow),
        updated_range: updatedRange,
      });
    },
  );

  server.tool(
    "glossary_update_entry",
    "Update specific cells in an existing row. If expected_row_hash is supplied (recommended — from glossary_get_entry/search) and the row changed in the sheet since you read it, the update is refused so you can re-read and re-decide.",
    {
      category: z.string(),
      row: z.number().int(),
      fields: z.record(z.string()),
      expected_row_hash: z.string().optional(),
    },
    async ({ category, row, fields, expected_row_hash }) => {
      requireOrgMember(props, "glossary_update_entry");
      const { headers, rows } = await readTab(env, category, true); // read fresh for updates
      const idx = row - 2;
      if (idx < 0 || idx >= rows.length) return errorResult(`row ${row} out of range for '${category}'`);
      const current = rows[idx];
      if (expected_row_hash) {
        const actual = await rowHash(current);
        if (actual !== expected_row_hash) {
          return errorResult(
            `row ${row} in '${category}' has changed since last read (expected hash ${expected_row_hash}, got ${actual}). Re-read the entry before updating.`,
          );
        }
      }
      const unknown = Object.keys(fields).filter((k) => !headers.includes(k));
      if (unknown.length) {
        return errorResult(`unknown columns for '${category}': ${JSON.stringify(unknown)}; headers are ${JSON.stringify(headers)}`);
      }
      const newRow = headers.map((h, i) => (h in fields ? fields[h] : current[i] ?? ""));
      const endCol = colLetter(headers.length);
      const range = `${tabRange(category)}!A${row}:${endCol}${row}`;
      await updateValues(env, range, newRow);
      invalidate(category);
      return jsonResult({ category, row, row_hash: await rowHash(newRow), fields: fieldsOf(headers, newRow) });
    },
  );
}
