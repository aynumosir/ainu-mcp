/**
 * Liveness/readiness logic for GET /health, extracted from the route handler so
 * it is unit-testable without spinning up Hono or a real Turso connection.
 *
 * Probes the Turso reference store with a cheap precomputed-`meta` lookup, which
 * confirms BOTH connectivity AND that the reference data is loaded:
 *   200  ok        reachable and seeded
 *   503  degraded  reachable but empty/half-reseeded (e.g. mid monthly refresh)
 *   503  error     unreachable
 *
 * Never throws, and never returns error detail in the body — a libSQL failure
 * can echo the database URL, so the cause is logged server-side only.
 */
import { getMeta } from "./db.js";

export interface HealthResult {
  body: { status: "ok" | "degraded" | "error"; store: "turso"; data_loaded?: boolean };
  http: 200 | 503;
}

export async function healthStatus(db: D1Database): Promise<HealthResult> {
  try {
    const loaded = (await getMeta(db, "corpus_stats")) != null;
    return loaded
      ? { body: { status: "ok", store: "turso", data_loaded: true }, http: 200 }
      : { body: { status: "degraded", store: "turso", data_loaded: false }, http: 503 };
  } catch (err) {
    console.error("Health check failed:", err);
    return { body: { status: "error", store: "turso" }, http: 503 };
  }
}
