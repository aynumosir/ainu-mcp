/**
 * The Ainu MCP server, hosted as a SQLite-backed Durable Object (free-tier
 * eligible) via Cloudflare's Agents SDK.
 *
 * Tool registration enforces least privilege: the read/reference surface is
 * available to every authenticated GitHub user, while the glossary write +
 * maintenance tools are only registered when the connected user is an aynumosir
 * org member (props.isOrgMember). Non-members never see those tools at all.
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "./types.js";

import { registerCorpusTools } from "./tools/corpus.js";
import { registerDictionaryTools } from "./tools/dictionaries.js";
import { registerGrammarTools } from "./tools/grammar.js";
import { registerScriptTools } from "./tools/script.js";
import { registerResearchTools } from "./tools/research.js";
import { registerGlossaryReadTools, registerGlossaryWriteTools } from "./tools/glossary.js";
import { registerMorphemeTools } from "./tools/morpheme.js";
import { registerSourcesTools } from "./tools/sources.js";
import { registerAuditTool } from "./tools/audit.js";
import { registerGapsTool } from "./tools/gaps.js";
import { registerSiteCacheTool } from "./tools/site-cache.js";

export class AinuMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "ainu-mcp",
    version: "0.1.0",
  });

  async init(): Promise<void> {
    const env = this.env;
    const props = this.props;

    // ── Reference / read surface — all authenticated users ──
    registerCorpusTools(this.server, env);
    registerDictionaryTools(this.server, env);
    registerGrammarTools(this.server, env);
    registerScriptTools(this.server);
    registerResearchTools(this.server, env);
    registerGlossaryReadTools(this.server, env);
    registerMorphemeTools(this.server, env);
    registerSourcesTools(this.server, env);

    // ── Write + maintenance surface — aynumosir org members only ──
    // (props is undefined only if the OAuth layer is bypassed; treat as read-only.)
    if (props?.isOrgMember) {
      registerGlossaryWriteTools(this.server, env, props);
      registerAuditTool(this.server, env);
      registerGapsTool(this.server, env);
      registerSiteCacheTool(this.server, env, props);
    }
  }
}
