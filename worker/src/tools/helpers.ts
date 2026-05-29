/** Shared helpers for tool handlers. */

/** Wrap any JSON-serializable result as an MCP text content block. */
export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an error message as an MCP error result (so the model sees it cleanly). */
export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
