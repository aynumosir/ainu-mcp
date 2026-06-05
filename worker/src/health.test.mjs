import { test, expect } from "bun:test";
import { healthStatus } from "./health.js";

/** Minimal D1Database-shaped stub: getMeta only calls
 * `prepare(sql).bind(key).first()`, so that is all we model. Pass the value
 * `first()` should resolve to, or an Error it should reject with. */
function fakeDb(first) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          if (first instanceof Error) throw first;
          return first;
        },
      }),
    }),
  };
}

test("ok: meta row present → 200 ok, data_loaded true", async () => {
  const r = await healthStatus(fakeDb({ value: '{"sentences":196046}' }));
  expect(r.http).toBe(200);
  expect(r.body).toEqual({ status: "ok", store: "turso", data_loaded: true });
});

test("degraded: meta empty (unseeded) → 503 degraded, data_loaded false", async () => {
  const r = await healthStatus(fakeDb(null));
  expect(r.http).toBe(503);
  expect(r.body).toEqual({ status: "degraded", store: "turso", data_loaded: false });
});

test("error: store unreachable (query throws) → 503 error, no detail leaked", async () => {
  // healthStatus logs the cause via console.error — silence it for clean output.
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await healthStatus(fakeDb(new Error("libsql://secret-host.turso.io unreachable")));
    expect(r.http).toBe(503);
    expect(r.body).toEqual({ status: "error", store: "turso" });
    // the body must never echo the error (which can carry the database URL)
    expect(JSON.stringify(r.body)).not.toContain("turso.io");
  } finally {
    console.error = orig;
  }
});
