/**
 * Early-records tools — thin proxies to the Early Records Database of the Ainu
 * Language (ainu-records / rec.aynu.org) over a service binding (env.RECORDS).
 *
 * That site holds the crowd transcriptions (みんなで翻刻, project アイヌ関連資料)
 * of Ainu-language records written between the seventeenth and nineteenth
 * centuries: a diplomatic transcription per page, the wordlists parsed into
 * items, and an editorial layer giving each item a modern Ainu reading with a
 * certainty and a citation. That app owns the data and its queries; these tools
 * call its read API and render the transcription markup as plain text.
 *
 * Markup renders with these markers:
 *   ⟨a｜b⟩     割書 — two columns written small inside one line
 *   rb（rt）    振り仮名 — reading gloss beside a word
 *   ⟦del→add⟧  a correction in the manuscript
 *   〔s〕       an editorial supplement by the transcriber (〔ママ〕 = sic)
 *   ／          separates alternative forms given for one gloss
 *   ［欠：…］    a gap: illegible, blank, or unidentified
 *   ［注 n］     a note reference; ［※ …］ a transcriber's comment
 *   ［右線：s］   傍線 beside the text; ［圏点：s］ emphasis dots over it
 *   「…」       a quotation
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { jsonResult, errorResult } from "./helpers.js";

const RECORDS = "https://rec.aynu.org";

/** Envelope-unwrapping GET against the records API over the service binding. */
async function get<T>(env: Env, path: string): Promise<T> {
  const res = await env.RECORDS.fetch(new Request(`${RECORDS}${path}`));
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`records API ${path} → HTTP ${res.status}, not JSON: ${text.slice(0, 200)}`);
  }
  const envelope = body as { data?: T; error?: { code: string; message: string } };
  if (envelope?.error) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  if (!res.ok) throw new Error(`records API ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  // An envelope without `data` would otherwise reach the model as an empty result.
  if (body === null || typeof body !== "object" || envelope.data === undefined)
    throw new Error(`records API ${path} → reply carries no data`);
  return envelope.data;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, String(v));
  return u.toString();
}

// ── Shapes the API returns (only the fields these tools read) ──

interface Unit {
  slug: string;
  label: string | null;
  platformUrl: string;
  witness: { holder: string | null; holderEn: string | null; shelfmark: string | null };
  pages: number;
  completed: number;
  withText: number;
  items: number;
  tei: string | null;
}

interface Source {
  slug: string;
  title: string;
  titleLatin: string | null;
  authors: string[];
  date: string | null;
  kind: string;
  language: string;
  catalogueUrl: string | null;
  sections: string[];
  units: Unit[];
}

interface Index {
  site: { harvestedAt: string; builtAt: string; licence: string; platform: string; totals: Record<string, number> };
  sources: Source[];
}

/** The transcription markup the records site parses; kept in step with its
 *  own `scripts/lib/markup.ts`. */
export type Node =
  | { t: "text"; s: string }
  | { t: "warigaki"; lines: Node[][] }
  | { t: "ruby"; rt: string; rb: string }
  | { t: "hi"; rend: "right-line" | "kenten"; s: string; mark?: string }
  | { t: "subst"; del: string; add: string }
  | { t: "editorial"; s: string }
  | { t: "sic" }
  | { t: "gap"; reason: "illegible" | "blank" | "unidentified" }
  | { t: "alt" }
  | { t: "noteref"; n: string }
  | { t: "comment"; s: string }
  | { t: "quote"; nodes: Node[]; lang: "ain" | null };

interface PageResult {
  source: string;
  unit: string;
  page: {
    n: number;
    status: string;
    updatedAt: string | null;
    platformUrl: string;
    image: string | null;
    /** Descriptions of the leaf itself — a blank recto, a seal, a stamp. */
    physical: string[];
    notes: { type: string; content: string; by: string | null; at: string | null }[];
    halves: { side: string | null; lines: { n: number; nodes: Node[] }[] }[];
  };
  items: unknown[];
}

const GAP_REASON: Record<Extract<Node, { t: "gap" }>["reason"], string> = {
  illegible: "判読不能",
  blank: "空白",
  unidentified: "不明",
};

const REND: Record<Extract<Node, { t: "hi" }>["rend"], string> = {
  "right-line": "右線",
  kenten: "圏点",
};

/** Render one line's markup nodes as plain text (markers as documented above). */
export function renderNodes(nodes: Node[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return n.s;
        case "warigaki":
          return `⟨${n.lines.map(renderNodes).join("｜")}⟩`;
        case "ruby":
          return `${n.rb}（${n.rt}）`;
        case "hi":
          return `［${REND[n.rend]}${n.mark ? `：${n.mark}` : ""}：${n.s}］`;
        case "subst":
          return `⟦${n.del}→${n.add}⟧`;
        case "editorial":
          return `〔${n.s}〕`;
        case "sic":
          return "〔ママ〕";
        case "gap":
          return `［欠：${GAP_REASON[n.reason]}］`;
        case "alt":
          return "／";
        case "noteref":
          return `［注 ${n.n}］`;
        case "comment":
          return `［※ ${n.s}］`;
        case "quote":
          return `「${renderNodes(n.nodes)}」`;
        default: {
          // Markup the site adds later must break the build rather than vanish
          // from a line a reader will take as a faithful transcription.
          const unknown: never = n;
          throw new Error(`unrecognised transcription markup: ${JSON.stringify(unknown)}`);
        }
      }
    })
    .join("");
}

/** Unit slugs are shared between works, so a unit names one only with its source. */
export function unitNeedsSource(opts: { source?: string; unit?: string }): boolean {
  return opts.unit != null && opts.source == null;
}

export function registerRecordsTools(server: McpServer, env: Env): void {
  server.tool(
    "records_search",
    "Search the wordlist items of the early Ainu-language records at rec.aynu.org (records written 17th–19th c., crowd-transcribed on みんなで翻刻). `query` matches the transcribed kana form, its alternatives, the modern Ainu reading (latin or kana), the Japanese gloss and the item's remark at once — substring, case-insensitive, katakana and hiragana equivalent, ranked exact before prefix before substring. Narrow by `source` slug (records_list_sources), `unit` slug (which needs its `source`, since units of different works share slugs), `section` (the wordlist's own subject heading, e.g. 天地), `certainty` of the modern reading ('high' | 'medium' | 'low' | 'guess'), or `interpreted` (false = items still without a modern reading). Each hit carries the transcribed `form` and its `alternatives`, the Japanese `gloss`, the modern reading (`modern`, `modernKana`) with its `certainty` and `citation`, and a URL onto the page beside the facsimile. `origin` says how the line was written: 'line' is an entry written on the line itself, 'warigaki' one written small in a split column, usually an alternative or a note on the entry above. `line` is the line of the page; `block` and `blockEnd` are the first and last line of the manuscript entry the item belongs to, which can span several lines; `side` names the half of an opening for a page copied on both; `head` and `sub` carry a heading and a sub-heading where the wordlist groups entries under one; `continued` marks an item whose entry carries on from the line before. `capped` in the reply means the search stopped at its candidate ceiling: `total` is a lower bound, ranking held only among the candidates examined, and a narrower filter or query answers completely.",
    {
      query: z.string().trim().min(1).optional(),
      source: z.string().trim().min(1).optional(),
      unit: z.string().trim().min(1).optional(),
      section: z.string().trim().min(1).optional(),
      certainty: z.enum(["high", "medium", "low", "guess"]).optional(),
      interpreted: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).max(1000).default(0),
    },
    async ({ query: q, source, unit, section, certainty, interpreted, limit, offset }) => {
      try {
        if (unitNeedsSource({ source, unit }))
          return errorResult(`records_search: unit "${unit}" needs its source — unit slugs are shared between works.`);
        const data = await get<unknown>(
          env,
          `/api/entries?${query({ q, source, unit, section, certainty, interpreted, limit, offset })}`,
        );
        return jsonResult(data);
      } catch (e) {
        return errorResult(`records_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "records_list_sources",
    "List the early Ainu-language records published at rec.aynu.org: for each source its title, authors, date, kind (wordlist / prose), language of the Ainu material, catalogue record in db.aynu.org, wordlist section headings, and the units (a witness, or one volume of it) with their holding institution, page and item counts, and TEI download. Use a source or unit slug as the filter in records_search / records_get_page.",
    {},
    async () => {
      try {
        const index = await get<Index>(env, "/api/sources");
        return jsonResult({
          site: { ...index.site, url: RECORDS },
          sources: index.sources.map((s) => ({
            slug: s.slug,
            title: s.title,
            title_latin: s.titleLatin,
            authors: s.authors,
            date: s.date,
            kind: s.kind,
            language: s.language,
            catalogue_url: s.catalogueUrl,
            sections: s.sections,
            url: `${RECORDS}/sources/${s.slug}`,
            units: s.units.map((u) => ({
              slug: u.slug,
              label: u.label,
              holder: u.witness?.holder,
              holder_en: u.witness?.holderEn,
              shelfmark: u.witness?.shelfmark,
              pages: u.pages,
              completed: u.completed,
              pages_with_text: u.withText,
              items: u.items,
              platform_url: u.platformUrl,
              tei_url: u.tei ? `${RECORDS}${u.tei}` : null,
            })),
          })),
        });
      } catch (e) {
        return errorResult(`records_list_sources failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "records_get_page",
    "Read one page of an early Ainu-language record at rec.aynu.org: the diplomatic transcription as plain text, line by line (a page copied on both halves of an opening comes back as two halves), plus the facsimile image URL, the page's transcription status, and — for a wordlist page — the parsed items with their modern readings. Pass the `source` and `unit` slugs from records_list_sources and the page number as the site numbers it (the leaf of /sources/<source>/<unit>/<page>). Items come back in the order the lines are read. `include_markup` adds each line's parsed markup beside its text — the nodes behind the ⟨…｜…⟩, ／ and 〔…〕 markers, with the entity marks — which is worth asking for when the exact markup matters and costs several times the reply size when it does not.",
    {
      source: z.string().trim().min(1),
      unit: z.string().trim().min(1),
      page: z.number().int().min(1),
      include_items: z.boolean().default(true),
      include_markup: z.boolean().default(false),
    },
    async ({ source, unit, page, include_items, include_markup }) => {
      try {
        const result = await get<PageResult>(
          env,
          `/api/pages/${encodeURIComponent(source)}/${encodeURIComponent(unit)}/${page}`,
        );
        const p = result.page;
        return jsonResult({
          source,
          unit,
          page: p.n,
          status: p.status,
          updated_at: p.updatedAt,
          url: `${RECORDS}/sources/${source}/${unit}/${page}`,
          platform_url: p.platformUrl,
          image_url: p.image,
          // The leaf's own description (a blank recto, a seal) and the
          // transcribers' notes sit outside the lines and carry the same weight
          // as them; the markup rides beside its rendering, so nothing a reader
          // may need exists only as plain text.
          physical: p.physical,
          notes: p.notes,
          halves: p.halves.map((h) => ({
            side: h.side,
            lines: h.lines.map((l) => (include_markup
              ? { n: l.n, text: renderNodes(l.nodes), nodes: l.nodes }
              : { n: l.n, text: renderNodes(l.nodes) })),
          })),
          items: include_items ? result.items : [],
        });
      } catch (e) {
        return errorResult(`records_get_page failed: ${(e as Error).message}`);
      }
    },
  );
}
