/** Glossary consistency audit (port of ainu_mcp/audit.py). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { contentSheetNames, batchReadTabs } from "./glossary.js";
import { jsonResult } from "./helpers.js";

interface Finding {
  category: string;
  row: number;
  rule: string;
  detail: string;
  aynu: string;
  fields: Record<string, string>;
}

type Tabs = Map<string, { headers: string[]; rows: string[][] }>;

// `N1 ... verb=an` — intransitive verb taking a direct-object N1.
// Use explicit ASCII-letter boundaries (not \b): JS \b treats CJK as a word
// boundary while Python's re does not, which would over-flag kana/kanji-adjacent
// N-tokens. This matches the boundary semantics of N1_TOKEN below.
const AN_VERB_WITH_N1 = /(?<![A-Za-z])N\d+\s+\S*=an(?![A-Za-z])/;
// 全角 or 半角 parens.
const PAREN_JP = /[（(][^）)]*[）)]/;
// Standalone N1/N2 token (CJK-adjacent allowed) or full/half-width tilde.
const N1_TOKEN = /(?<![A-Za-z])N\d+(?![A-Za-z])|[～〜~]/;
const POSTPOSITIONS = new Set(["ta", "peka", "wa", "un", "or", "orowa", "pakno"]);

const repr = (s: string) => JSON.stringify(s);
const fieldsOf = (headers: string[], row: string[]): Record<string, string> => {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => (o[h] = row[i] ?? ""));
  return o;
};

function findIntransitiveWithN1(tabs: Tabs): Finding[] {
  const out: Finding[] = [];
  for (const [cat, { headers, rows }] of tabs) {
    if (!headers.includes("Aynu")) continue;
    const ai = headers.indexOf("Aynu");
    rows.forEach((row, i) => {
      const aynu = ai < row.length ? row[ai] : "";
      if (!aynu) return;
      for (const part of aynu.split(",")) {
        const f = part.trim();
        if (AN_VERB_WITH_N1.test(f)) {
          const toks = f.split(/\s+/).filter(Boolean);
          if (toks.length >= 4 && toks.slice(1, -1).some((t) => POSTPOSITIONS.has(t))) continue;
          out.push({
            category: cat,
            row: i + 2,
            rule: "intransitive_with_n1",
            detail: `\`${f}\` — \`=an\` is intransitive; N1 cannot be its direct object`,
            aynu,
            fields: fieldsOf(headers, row),
          });
          break;
        }
      }
    });
  }
  return out;
}

function findParensInText(tabs: Tabs, columns = ["日本語", "中文"]): Finding[] {
  const out: Finding[] = [];
  for (const [cat, { headers, rows }] of tabs) {
    const colIdx = columns.filter((c) => headers.includes(c)).map((c) => [c, headers.indexOf(c)] as const);
    if (!colIdx.length) continue;
    rows.forEach((row, i) => {
      for (const [col, ci] of colIdx) {
        if (ci >= row.length) continue;
        const cell = row[ci];
        if (PAREN_JP.test(cell)) {
          out.push({
            category: cat,
            row: i + 2,
            rule: "parens_in_text",
            detail: `\`${col}\` contains parens: ${repr(cell)}`,
            aynu: headers.includes("Aynu") ? row[headers.indexOf("Aynu")] ?? "" : "",
            fields: fieldsOf(headers, row),
          });
        }
      }
    });
  }
  return out;
}

function findTransitivityMismatch(tabs: Tabs): Finding[] {
  const out: Finding[] = [];
  for (const [cat, { headers, rows }] of tabs) {
    if (!headers.includes("Aynu") || !headers.includes("日本語")) continue;
    const ai = headers.indexOf("Aynu");
    const ji = headers.indexOf("日本語");
    rows.forEach((row, i) => {
      if (ai >= row.length || ji >= row.length) return;
      const aynu = row[ai];
      const jp = row[ji];
      if (!aynu || !jp) return;
      const aynuHasN = N1_TOKEN.test(aynu);
      const jpHasN = N1_TOKEN.test(jp);
      if (aynuHasN && !jpHasN) {
        out.push({
          category: cat,
          row: i + 2,
          rule: "transitivity_mismatch_aynu_has_n_jp_doesnt",
          detail: `Aynu mentions N-arg but JA doesn't — JA: ${repr(jp)}`,
          aynu,
          fields: fieldsOf(headers, row),
        });
      } else if (jpHasN && !aynuHasN) {
        out.push({
          category: cat,
          row: i + 2,
          rule: "transitivity_mismatch_jp_has_n_aynu_doesnt",
          detail: `JA mentions N-arg but Aynu doesn't — Aynu: ${repr(aynu)}`,
          aynu,
          fields: fieldsOf(headers, row),
        });
      }
    });
  }
  return out;
}

function findDuplicateAynu(tabs: Tabs): Finding[] {
  const index = new Map<string, { cat: string; row: number; fields: Record<string, string> }[]>();
  for (const [cat, { headers, rows }] of tabs) {
    if (!headers.includes("Aynu")) continue;
    const ai = headers.indexOf("Aynu");
    rows.forEach((row, i) => {
      const aynu = ai < row.length ? row[ai] : "";
      if (!aynu) return;
      const key = aynu.split(",")[0].trim().toLowerCase();
      if (!key) return;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push({ cat, row: i + 2, fields: fieldsOf(headers, row) });
    });
  }
  const out: Finding[] = [];
  for (const [key, hits] of index) {
    const cats = new Set(hits.map((h) => h.cat));
    if (cats.size < 2) continue;
    const jas = hits.map((h) => (h.fields["日本語"] ?? "").trim());
    const nonempty = jas.filter(Boolean);
    if (new Set(nonempty).size > 1) continue; // different glosses → intentional polysemy
    for (const h of hits) {
      // Dedup (cat,row) as objects — no fragile string round-trip.
      const seen = new Set<string>();
      const others: { cat: string; row: number }[] = [];
      for (const o of hits) {
        if (o.cat === h.cat && o.row === h.row) continue;
        const dk = o.cat + "\u0001" + o.row;
        if (seen.has(dk)) continue;
        seen.add(dk);
        others.push({ cat: o.cat, row: o.row });
      }
      others.sort((a, b) => (a.cat === b.cat ? a.row - b.row : a.cat < b.cat ? -1 : 1));
      out.push({
        category: h.cat,
        row: h.row,
        rule: "duplicate_aynu_across_categories",
        detail: `\`${key}\` also appears at: ` + others.map((o) => `${o.cat} row ${o.row}`).join(", "),
        aynu: key,
        fields: h.fields,
      });
    }
  }
  return out;
}

export function registerAuditTool(server: McpServer, env: Env): void {
  server.tool(
    "glossary_audit",
    "Run all inconsistency checks across the glossary. Reports per-rule findings: intransitive verbs taking N1 directly, parens in JA/中, Aynu/JA transitivity mismatches, duplicate Aynu forms across categories. Returns a summary + the full finding list grouped by rule.",
    {},
    async () => {
      const cats = await contentSheetNames(env);
      const tabs = await batchReadTabs(env, cats);
      const checks: [string, (t: Tabs) => Finding[]][] = [
        ["intransitive_with_n1", findIntransitiveWithN1],
        ["parens_in_text", findParensInText],
        ["transitivity_mismatch", findTransitivityMismatch],
        ["duplicate_aynu_across_categories", findDuplicateAynu],
        ["aynu_has_parens", () => []], // intentionally a no-op (see audit.py)
      ];
      const byRule: Record<string, Finding[]> = {};
      for (const [name, fn] of checks) byRule[name] = fn(tabs);
      const summary: Record<string, number> = {};
      let total = 0;
      for (const [k, v] of Object.entries(byRule)) {
        summary[k] = v.length;
        total += v.length;
      }
      summary.total = total;
      return jsonResult({ summary, findings: byRule });
    },
  );
}
