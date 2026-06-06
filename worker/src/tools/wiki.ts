/**
 * Aynuwiki tools — live access to the two Ainu-language MediaWiki encyclopedias:
 *
 *   - "aynuwiki"  → Aynuwiki, the standalone Ainu wiki at wiki.aynu.org
 *   - "incubator" → the Ainu Wikipedia in the Wikimedia Incubator
 *                   (incubator.wikimedia.org, articles under the `Wp/ain/` prefix)
 *
 * These are living wikis, so this is a thin live proxy over each site's
 * MediaWiki Action API (no snapshot / ETL): search returns matching articles,
 * get_page returns a clean plain-text extract (falling back to raw wikitext for
 * template-heavy pages such as the Incubator main page). Read-only; available to
 * all authenticated users.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult } from "./helpers.js";

interface Site {
  name: string;
  api: string;
  pageBase: string;
  /** Title prefix that scopes the Ainu content within the wiki (Incubator only). */
  prefix: string;
}

export const SITES: Record<string, Site> = {
  aynuwiki: {
    name: "Aynuwiki",
    api: "https://wiki.aynu.org/api.php",
    pageBase: "https://wiki.aynu.org/wiki/",
    prefix: "",
  },
  incubator: {
    name: "Ainu Wikipedia (Wikimedia Incubator)",
    api: "https://incubator.wikimedia.org/w/api.php",
    pageBase: "https://incubator.wikimedia.org/wiki/",
    prefix: "Wp/ain/",
  },
};

/** Call a MediaWiki Action API (formatversion=2, origin=* for CORS-clean GETs). */
async function mwApi(site: Site, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const res = await fetch(`${site.api}?${qs.toString()}`, {
    headers: { "user-agent": "ainu-mcp (https://mcp.aynu.org)", accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${site.name} API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Build the human-facing article URL (keep the Wp/ain/ slashes, spaces → _). */
export function articleUrl(siteKey: string, title: string): string {
  return SITES[siteKey].pageBase + encodeURI(title.replace(/ /g, "_"));
}

/** Apply a site's Ainu-content title prefix when the caller omitted it (Incubator
 * articles live under `Wp/ain/`); a no-op for sites without a prefix. */
export function resolveTitle(siteKey: string, title: string): string {
  const { prefix } = SITES[siteKey];
  return prefix && !title.startsWith(prefix) ? prefix + title : title;
}

/** Strip the HTML highlight markup MediaWiki wraps search snippets in. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

interface SearchHit {
  title: string;
  snippet: string;
  size?: number;
  wordcount?: number;
  timestamp?: string;
}

async function searchSite(site: Site, query: string, limit: number): Promise<unknown[]> {
  // Incubator scopes Ainu content by title prefix (Wp/ain/); the standalone
  // Aynuwiki has no prefix. `prefix:` is honored by the search backend.
  const srsearch = site.prefix ? `${query} prefix:${site.prefix}` : query;
  const data = await mwApi(site, { action: "query", list: "search", srsearch, srlimit: String(limit) });
  const hits = ((data.query as Record<string, unknown> | undefined)?.search as SearchHit[] | undefined) ?? [];
  const siteKey = site === SITES.aynuwiki ? "aynuwiki" : "incubator";
  // Defensive: `prefix:` is a search hint, not a hard filter — keep only titles
  // actually under the site's Ainu prefix (drops cross-language Incubator pages
  // if the backend ever returns them). A no-op for prefix-less Aynuwiki.
  const scoped = site.prefix ? hits.filter((h) => h.title.startsWith(site.prefix)) : hits;
  return scoped.map((h) => ({
    site: siteKey,
    title: h.title,
    snippet: stripHtml(h.snippet ?? ""),
    url: articleUrl(siteKey, h.title),
    wordcount: h.wordcount,
    size: h.size,
    last_edited: h.timestamp,
  }));
}

export function registerWikiTools(server: McpServer): void {
  server.tool(
    "wiki_search",
    "Search Ainu-language wiki encyclopedias for articles. `site`: 'aynuwiki' (Aynuwiki — the standalone Ainu wiki at wiki.aynu.org), 'incubator' (the Ainu Wikipedia in the Wikimedia Incubator, articles under the Wp/ain/ prefix), or 'both' (default). Returns matching article titles, a snippet, the article URL, and metadata. Pass a title + its `site` to wiki_get_page for the full text.",
    {
      query: z.string().trim().min(1),
      site: z.enum(["aynuwiki", "incubator", "both"]).default("both"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ query, site, limit }) => {
      try {
        const targets = site === "both" ? [SITES.aynuwiki, SITES.incubator] : [SITES[site]];
        const perSite = await Promise.all(targets.map((s) => searchSite(s, query, limit)));
        return jsonResult(perSite.flat());
      } catch (e) {
        return errorResult(`wiki_search failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "wiki_get_page",
    "Fetch the full content of one Ainu wiki article. `site`: 'aynuwiki' (wiki.aynu.org) or 'incubator' (Wikimedia Incubator, Wp/ain/). Pass the `title` from wiki_search (for the Incubator the 'Wp/ain/' prefix is added automatically if you omit it). Returns a clean plain-text extract; for template-heavy pages where no extract is available it returns the raw wikitext instead (see `content_format`).",
    {
      title: z.string().trim().min(1),
      site: z.enum(["aynuwiki", "incubator"]).default("aynuwiki"),
    },
    async ({ title, site }) => {
      try {
        const s = SITES[site];
        // Forgiving: prepend the Incubator's Ainu prefix if the caller omitted it.
        const fullTitle = resolveTitle(site, title);
        const data = await mwApi(s, {
          action: "query",
          prop: "extracts|info|revisions",
          inprop: "url",
          explaintext: "1",
          exlimit: "1",
          rvprop: "content",
          rvslots: "main",
          redirects: "1",
          titles: fullTitle,
        });
        const pages = ((data.query as Record<string, unknown> | undefined)?.pages as Record<string, unknown>[] | undefined) ?? [];
        const page = pages[0];
        if (!page || page.missing) {
          return errorResult(`wiki_get_page: "${fullTitle}" not found on ${s.name}.`);
        }
        const extract = (page.extract as string | undefined)?.trim();
        let content = extract ?? "";
        let format = "plaintext";
        if (!content) {
          const rev = (page.revisions as { slots?: { main?: { content?: string } } }[] | undefined)?.[0];
          content = rev?.slots?.main?.content ?? "";
          format = "wikitext";
        }
        return jsonResult({
          site,
          title: page.title,
          url: page.fullurl,
          content_format: format,
          content,
        });
      } catch (e) {
        return errorResult(`wiki_get_page failed: ${(e as Error).message}`);
      }
    },
  );
}
