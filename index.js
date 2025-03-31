import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pipeline } from "@huggingface/transformers";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "Ainu MCP Server",
  version: "0.0.1",
});

const translate = await pipeline(
  "text2text-generation",
  "aynumosir/mt5-base-ainu-onnx",
  {
    revision: "b6cc98f634063743e4d911e21047b67b2c04fff7",
    dtype: "q4",
  }
);

server.tool(
  "translate",
  {
    sourceLang: z.enum(["Japanese", "Ainu"]),
    targetLang: z.enum(["Japanese", "Ainu"]),
    text: z.string(),
  },
  async ({ sourceLang, targetLang, text }) => {
    const prompt = `translate ${sourceLang} to ${targetLang}: ${text}`;
    const response = await translate(prompt, {
      max_length: 512,
      do_sample: false,
    });

    const translation = response[0].generated_text;

    return {
      contents: [
        {
          type: "text",
          text: translation,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
