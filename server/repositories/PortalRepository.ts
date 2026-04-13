import { and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { portalAnalytics } from "../../drizzle/schema";

export class PortalRepository {
  static async getYesterdayStats(yesterdayStart: Date, yesterdayEnd: Date) {
    const db = await getDb();
    if (!db) return [];
    
    const stats = await db
      .select({
        page: portalAnalytics.page,
        count: sql`count(distinct ${portalAnalytics.ipHash})`,
      })
      .from(portalAnalytics)
      .where(
        and(
          gte(portalAnalytics.date, yesterdayStart),
          lte(portalAnalytics.date, yesterdayEnd)
        )
      )
      .groupBy(portalAnalytics.page);
    
    return stats.map(s => ({ page: s.page, count: Number(s.count) }));
  }

  static async logVisit(page: string, ipHash: string, today: Date) {
    const db = await getDb();
    if (!db) return;

    await db.insert(portalAnalytics).values({
      date: today,
      page,
      ipHash,
    }).onDuplicateKeyUpdate({
      set: { createdAt: sql`createdAt` } // Do nothing if already exists
    });
  }
}
