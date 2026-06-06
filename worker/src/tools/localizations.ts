/**
 * Localization (i18n) tools — search how real Ainu-language software has
 * translated its UI. Backed by l10n_fts / l10n_projects in the Turso reference
 * store (gathered at seed time from public GitHub message catalogues by
 * src/ainu_mcp/localizations.py). Read-only; available to all authenticated users.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { localizationSearch, listLocalizationProjects } from "../db.js";
import { jsonResult } from "./helpers.js";

export function registerLocalizationTools(server: McpServer, env: Env): void {
  server.tool(
    "localizations_search",
    "Search software localization (i18n) strings from real Ainu-language software — how UI concepts have actually been translated into Ainu, paired with the source-language original (usually English or Japanese). `query` matches the Ainu text, the source string, OR the message key at once (substring, case-insensitive). Optionally narrow by `project` (substring on the 'owner/name' slug, e.g. 'tunci', 'mediawiki') or `lang` (exact BCP-47 tag: 'ain', 'ain-Latn', 'ain-Kana', 'ain-Cyrl'). Returns project, file path, key, Ainu text, and source original. Use localizations_list_projects to see the projects.",
    {
      query: z.string(),
      project: z.string().optional(),
      lang: z.string().optional(),
      limit: z.number().int().default(20),
    },
    async ({ query, project, lang, limit }) => {
      const rows = await localizationSearch(env.DB, { query, project, lang, limit });
      return jsonResult(rows);
    },
  );

  server.tool(
    "localizations_list_projects",
    "List the Ainu-language software projects whose localization (i18n) strings are indexed — each with its repo, description, message-catalogue format (inlang / next-intl / mediawiki), source language, and translated-string count. Use the slug as the `project` filter in localizations_search.",
    {},
    async () => {
      return jsonResult(await listLocalizationProjects(env.DB));
    },
  );
}
