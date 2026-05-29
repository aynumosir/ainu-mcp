/**
 * Minimal Google Sheets v4 REST client for Cloudflare Workers.
 *
 * Replaces google-api-python-client: we mint an OAuth access token by signing a
 * service-account JWT with Web Crypto (RS256), then call the Sheets REST API
 * directly with `fetch`. The service-account private key is a Worker secret and
 * never leaves the isolate. Transient 429/5xx responses are retried with
 * exponential backoff + jitter (mirrors the Python `_with_retry`).
 */

import type { Env } from "./types.js";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Access tokens last ~1h; cache per isolate until shortly before expiry.
let cachedToken: { token: string; exp: number } | null = null;

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_SA_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;
  const key = await importPrivateKey(env.GOOGLE_SA_PRIVATE_KEY);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google token exchange failed (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authedFetch(env: Env, url: string, init: RequestInit = {}, retries = 5): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; attempt < retries; attempt++) {
    const token = await getAccessToken(env);
    const resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (resp.ok) return resp;
    if ([429, 500, 502, 503, 504].includes(resp.status) && attempt < retries - 1) {
      await sleep(delay + Math.floor(Math.random() * 500));
      delay *= 2;
      continue;
    }
    throw new Error(`Sheets API ${init.method ?? "GET"} ${url} failed (${resp.status}): ${await resp.text()}`);
  }
  throw new Error("unreachable");
}

/** A1 range for a whole tab, single-quoted (handles spaces/CJK in tab names). */
export function tabRange(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export async function getValues(env: Env, range: string): Promise<string[][]> {
  const url = `${SHEETS_BASE}/${env.GLOSSARY_SHEET_ID}/values/${encodeURIComponent(range)}`;
  const resp = await authedFetch(env, url);
  const data = (await resp.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function batchGetValues(env: Env, ranges: string[]): Promise<string[][][]> {
  if (ranges.length === 0) return [];
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `${SHEETS_BASE}/${env.GLOSSARY_SHEET_ID}/values:batchGet?${qs}`;
  const resp = await authedFetch(env, url);
  const data = (await resp.json()) as { valueRanges?: { values?: string[][] }[] };
  return (data.valueRanges ?? []).map((vr) => vr.values ?? []);
}

export async function appendValues(env: Env, range: string, row: string[]): Promise<{ updatedRange: string }> {
  const url = `${SHEETS_BASE}/${env.GLOSSARY_SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await authedFetch(env, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  const data = (await resp.json()) as { updates?: { updatedRange?: string } };
  return { updatedRange: data.updates?.updatedRange ?? "" };
}

export async function updateValues(env: Env, range: string, row: string[]): Promise<void> {
  const url = `${SHEETS_BASE}/${env.GLOSSARY_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await authedFetch(env, url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
}
