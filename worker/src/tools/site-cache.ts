/** Republish the itak.aynu.org R2 cache (port of ainu_mcp/site_cache.py).
 *
 * Uses the bound R2 bucket directly instead of boto3 — the binding is the SAME
 * bucket the website reads `table.json` / `sheets.json` from. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../types.js";
import { listCategories, batchReadTabs, invalidate } from "./glossary.js";
import { requireOrgMember } from "../auth.js";
import { jsonResult } from "./helpers.js";

export function registerSiteCacheTool(server: McpServer, env: Env, props: Props): void {
  server.tool(
    "glossary_refresh_site_cache",
    "Rebuild and upload table.json and sheets.json to the Cloudflare R2 bucket the itak.aynu.org website reads from. Call this after edits to make changes live without waiting for the weekly cron. With dry_run=true, builds payloads and reports sizes without uploading.",
    { dry_run: z.boolean().default(false) },
    async ({ dry_run }) => {
      requireOrgMember(props, "glossary_refresh_site_cache");
      invalidate(); // always read fresh for a publish

      const sheetsMeta = await listCategories(env, true);
      const contentSheets = sheetsMeta.filter((s) => s.isContent);
      const names = contentSheets.map((s) => s.sheetName);
      const tabData = await batchReadTabs(env, names);

      const flattened: Record<string, string>[] = [];
      for (const name of names) {
        const { headers, rows } = tabData.get(name) ?? { headers: [], rows: [] };
        if (!headers.length) continue;
        for (const row of rows) {
          const entry: Record<string, string> = {};
          headers.forEach((h, i) => {
            if (h) entry[h] = row[i] ?? "";
          });
          entry.sheetName = name;
          flattened.push(entry);
        }
      }

      const tableJson = JSON.stringify(flattened);
      const sheetsJson = JSON.stringify(contentSheets);
      const enc = new TextEncoder();

      const result: Record<string, unknown> = {
        content_sheets: contentSheets.length,
        entries: flattened.length,
        table_bytes: enc.encode(tableJson).length,
        sheets_bytes: enc.encode(sheetsJson).length,
        dry_run,
      };

      if (dry_run) {
        result.uploaded = false;
        return jsonResult(result);
      }

      await env.SITE_CACHE.put("table.json", tableJson, { httpMetadata: { contentType: "application/json" } });
      await env.SITE_CACHE.put("sheets.json", sheetsJson, { httpMetadata: { contentType: "application/json" } });
      result.uploaded = true;
      result.keys = ["table.json", "sheets.json"];
      return jsonResult(result);
    },
  );
}
