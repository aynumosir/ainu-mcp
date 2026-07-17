/**
 * Archive helper tests — assertion signing and image byte caps only, no network.
 *
 * Written as .mjs (not .ts): the worker tsconfig pins DOM/Workers types that
 * make a .ts test fail to resolve `bun:test`.
 */
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { test, expect } from "bun:test";
import { assertImageSizeCap, buildArchiveAssertion } from "../src/tools/archive.ts";

test("buildArchiveAssertion signs the raw JSON assertion bytes", async () => {
  const secret = "test-secret";
  const actor = "archive-user";
  const now = 1_755_000_123;
  const nonce = "fixed-nonce";
  const expectedJson = `{"caller":"mcp","actor":"${actor}","ts":${now},"nonce":"${nonce}"}`;

  const headers = await buildArchiveAssertion(secret, actor, now, nonce);
  expect(Buffer.from(headers.assertionHeader, "base64").toString("utf8")).toBe(expectedJson);
  expect(headers.signatureHeader).toMatch(/^[0-9a-f]{64}$/);

  const expectedSignature = createHmac("sha256", secret).update(expectedJson, "utf8").digest("hex");
  expect(headers.signatureHeader).toBe(expectedSignature);
});

test("assertImageSizeCap accepts image sizes below the 2 MB cap", () => {
  expect(() => assertImageSizeCap(2 * 1024 * 1024 - 1)).not.toThrow();
});

test("assertImageSizeCap accepts the exact 2 MB boundary", () => {
  // The cap is inclusive: exactly 2 MB is accepted.
  expect(() => assertImageSizeCap(2 * 1024 * 1024)).not.toThrow();
});

test("assertImageSizeCap rejects image sizes over the 2 MB cap", () => {
  expect(() => assertImageSizeCap(2 * 1024 * 1024 + 1)).toThrow(/2097153 bytes.*2 MB/);
});
