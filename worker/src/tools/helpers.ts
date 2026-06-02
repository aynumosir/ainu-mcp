/** Shared helpers for tool handlers. */

/** Wrap any JSON-serializable result as an MCP text content block. */
export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an error message as an MCP error result (so the model sees it cleanly). */
export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Call a service-bound sibling Worker (e.g. mdb.aynu.org / db.aynu.org) and
 * parse its JSON reply. The hostname is cosmetic — a service binding routes by
 * binding, not host — but we keep the real domain for readable logs. Throws on
 * a non-2xx so the caller can surface it via errorResult.
 */
export async function fetchJson(binding: Fetcher, url: string): Promise<unknown> {
  const res = await binding.fetch(new Request(url));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res.json();
}

/**
 * Send a JSON body to a service-bound sibling Worker (POST/PATCH/…) with a
 * bearer token, and parse its JSON reply. Used for the authenticated write
 * endpoints (e.g. ainu-sources POST/PATCH /api/sources). Throws on non-2xx.
 */
export async function sendJson(
  binding: Fetcher,
  url: string,
  opts: { method: string; token: string; body?: unknown },
): Promise<unknown> {
  const res = await binding.fetch(
    new Request(url, {
      method: opts.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res.json();
}
