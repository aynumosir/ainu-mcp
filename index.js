#!/usr/bin/env node
import outdent from "outdent";
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
  "ainu_translate",
  {
    source: z
      .enum(["Japanese", "Ainu"])
      .describe("Language to translate from."),
    target: z.enum(["Japanese", "Ainu"]).describe("Language to translate to."),
    dialect: z
      .enum([
        "沙流",
        "千歳",
        "幌別",
        "静内",
        "様似",
        "十勝",
        "釧路",
        "美幌",
        "石狩",
      ])
      .describe("Dialect of Ainu to use in the translation.")
      .default("沙流"),
    pronoun: z
      .enum(["first", "fourth"])
      .describe(
        "Preferred pronoun to use in the translation. In Ainu, the first person pronoun is used for ordinary conversation, while the fourth person pronoun is used for storytelling. Use `first` if not sure."
      )
      .default("first"),
    text: z
      .string()
      .describe("Text to translate.")
      .min(1, "Text must not be empty."),
  },
  async ({ source, target, dialect, pronoun, text }) => {
    let prompt = "";
    if (source === "Japanese" && target === "Ainu") {
      prompt = `translate Japanese to Ainu (${dialect}, ${pronoun}): ${text}`;
    } else {
      prompt = `translate Ainu (${dialect}, ${pronoun}) to Japanese: ${text}`;
    }

    const response = await translate(prompt, {
      max_length: 512,
      do_sample: false,
    });

    const translation = response[0].generated_text;

    return {
      content: [
        {
          type: "text",
          text: translation,
        },
      ],
    };
  }
);

server.prompt("ainu_conversation", () => {
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: outdent`
            あなたは、アイヌ語が理解できませんが、ユーザーとアイヌ語で会話しなければなりません。
            次の手順で、ユーザーとの会話を成立させてください。

            1. ユーザーが送信した内容を input とする
            2. ainu_translate を使って日本語での意味を理解する: ainu_translate(text=input, source=Ainu, target=Japanese)
            3. 2で理解した意味を踏まえて、返答 output を考える。
            4. ainu_translate を使ってアイヌ語に翻訳する: translate(text=output, source=Ainu, target=Japanese)
            5. 4の結果をユーザーに送信する。

            つまり、ユーザーが１度話しかけてくる毎に、２回 ainu_translate を使う必要があります。

            以下の制約は必ず守ってください。
            * ユーザーにはアイヌ語だけで話しかけてください。
            * ainu_translate の文字数に制限があるため、ユーザーへの返答はなるべく簡潔（１行以内）にしてください。
            * ainu_translate の品質が低いため、なるべく平易な日本語（JLPT N3レベル）を使ってください。
            * ainu_translate の品質が低いため、主語を省略せずに記述してください（「思った」ではなく「私は思った」など。）
             
            それでは、会話を始めてください。
            `,
        },
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
