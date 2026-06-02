/**
 * libSQL-backed shim presenting the small slice of the D1Database API the query
 * layer uses — `prepare(sql).bind(...args).all<T>()` / `.first<T>()` (and
 * `prepare(sql).all<T>()` without bind). This lets the reference store move from
 * Cloudflare D1 to Turso (libSQL over HTTP) without touching db.ts or any tool
 * module. Mirrors how the sibling ainu-sources Worker talks to the same Turso
 * account.
 *
 * Uses the `/web` entry (fetch-based, no Node built-ins) for the Workers runtime.
 */
import { createClient, type Client, type InValue } from "@libsql/client/web";

class LibsqlStatement {
  constructor(
    private readonly client: Client,
    private readonly sql: string,
    private readonly args: InValue[] = [],
  ) {}

  bind(...args: unknown[]): LibsqlStatement {
    return new LibsqlStatement(this.client, this.sql, args as InValue[]);
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: rs.rows as unknown as T[] };
  }

  async first<T = unknown>(): Promise<T | null> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return (rs.rows[0] as unknown as T) ?? null;
  }
}

/** Minimal D1Database-shaped wrapper over a libSQL client. */
export class LibsqlDb {
  private readonly client: Client;
  constructor(url: string, authToken: string) {
    this.client = createClient({ url, authToken });
  }
  prepare(sql: string): LibsqlStatement {
    return new LibsqlStatement(this.client, sql);
  }
}
