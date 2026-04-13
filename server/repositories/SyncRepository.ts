import { desc, eq, and, gte } from "drizzle-orm";
import { getDb } from "../db";
import { syncLogs, syncStatus } from "../../drizzle/schema";

export class SyncRepository {
  static async getRecentSyncLogs(limit = 20) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(syncLogs)
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);
  }

  static async getLastSyncTime(syncType: "ical" | "email") {
    const db = await getDb();
    if (!db) return null;
    const result = await db
      .select({ createdAt: syncLogs.createdAt })
      .from(syncLogs)
      .where(and(eq(syncLogs.syncType, syncType), eq(syncLogs.success, "true")))
      .orderBy(desc(syncLogs.createdAt))
      .limit(1);
    return result[0]?.createdAt ?? null;
  }

  static async findFailedSyncs(since: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(syncLogs)
      .where(
        and(
          eq(syncLogs.success, "false"),
          gte(syncLogs.createdAt, since)
        )
      );
  }

  static async findLatestSyncsBySource(since: Date) {
    const db = await getDb();
    if (!db) return [];

    const allSources = await db
      .select({ source: syncLogs.source })
      .from(syncLogs)
      .where(gte(syncLogs.createdAt, since));
    
    const uniqueSources = Array.from(new Set(allSources.map(s => s.source)));
    const latestSyncs: any[] = [];
    
    for (const source of uniqueSources) {
      const [latest] = await db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.source, source))
        .orderBy(desc(syncLogs.createdAt))
        .limit(1);
      if (latest) {
        latestSyncs.push(latest);
      }
    }
    return latestSyncs;
  }

  static async getSyncStatus() {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(syncStatus);
  }
}
