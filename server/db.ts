import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let _db: ReturnType<typeof drizzle> | null = null;
export let pool: mysql.Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        timezone: "Z",
        // Bounded pool: without these, a burst of concurrent queries opens
        // unbounded connections and can exhaust the MySQL server.
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
      });

      // Force all database connections to use UTC time zone for NOW() and ON UPDATE NOW()
      pool.on("connection", (connection: any) => {
        connection.query("SET time_zone='+00:00'", (err: any) => {
          if (err) console.error("[Database] Failed to set time_zone:", err);
        });
      });

      _db = drizzle(pool) as any;
    } catch (error) {
      // Fail loud: DATABASE_URL is set but the pool could not be created. This
      // is a misconfiguration, not an empty result — swallowing it here made
      // every read silently return [] and the dashboard show zeros that look
      // real. Let it propagate so the failure is visible.
      console.error("[Database] Failed to initialize pool:", error);
      _db = null;
      throw error;
    }
  }
  return _db;
}

/**
 * Any executor that can run drizzle queries — the pooled `db` or a `tx` handle
 * inside `db.transaction(...)`. Repository methods accept this so a caller can
 * run several writes atomically in one transaction. Typed loosely (`any`)
 * because the drizzle `db` and `tx` handles are structurally different but share
 * the query-builder surface these methods use; matches the codebase's existing
 * `as any` treatment of the drizzle instance.
 */
export type DbExecutor = any;

/**
 * Run `fn` only if a MySQL advisory lock named `lockName` can be acquired
 * immediately (non-blocking). Returns `{ ran: false }` when the lock is already
 * held — used to stop two poller runs (in-app scheduler + any stray crontab, or
 * an initial startup poll overlapping the cron tick) from processing the same
 * inbox/feeds concurrently. The lock auto-releases if the connection dies.
 */
export async function runWithLock<T>(
  lockName: string,
  fn: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false }> {
  await getDb();
  if (!pool) {
    // No database configured (dev without DATABASE_URL) — run unguarded.
    return { ran: true, result: await fn() };
  }

  const conn = await pool.getConnection();
  try {
    // GET_LOCK(name, 0): 1 = acquired, 0 = already held by someone else, NULL = error.
    const [rows] = await conn.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    const acquired = Array.isArray(rows) && (rows[0] as any)?.acquired === 1;
    if (!acquired) {
      console.warn(`[Lock] '${lockName}' is held by another run — skipping this one.`);
      return { ran: false };
    }

    try {
      return { ran: true, result: await fn() };
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
  } finally {
    conn.release();
  }
}

/**
 * Close the pool during graceful shutdown so in-flight queries can drain and
 * the process exits cleanly on SIGTERM (systemd restart).
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    _db = null;
  }
}
