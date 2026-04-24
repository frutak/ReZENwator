import { getDb } from "../db";
import { priceAudits, type InsertPriceAudit, type PriceAudit } from "../../drizzle/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";

export class PricingAuditRepository {
  /**
   * Saves a new pricing audit entry to the database.
   */
  static async saveAudit(audit: InsertPriceAudit) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return await db.insert(priceAudits).values(audit);
  }

  /**
   * Returns the most recent audit for a specific date pair for a property in the last 14 days.
   * This helps in avoiding redundant probes to minimize the load on portals.
   */
  static async getRecentAudit(property: "Sadoles" | "Hacjenda", checkIn: Date, checkOut: Date): Promise<PriceAudit | null> {
    const db = await getDb();
    if (!db) return null;
    
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const result = await db
      .select()
      .from(priceAudits)
      .where(
        and(
          eq(priceAudits.property, property),
          eq(priceAudits.checkIn, checkIn),
          eq(priceAudits.checkOut, checkOut),
          gte(priceAudits.dateScraped, fourteenDaysAgo)
        )
      )
      .orderBy(sql`${priceAudits.dateScraped} DESC`)
      .limit(1);

    return result[0] || null;
  }

  /**
   * Returns the count of audits performed today.
   */
  static async getTodayAuditCount(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(priceAudits)
      .where(gte(priceAudits.dateScraped, today));

    return result[0]?.count || 0;
  }

  /**
   * Fetches the latest audits from the last 14 days for every property/checkIn/checkOut combination.
   */
  static async getRecentAuditEntries(days: number = 14): Promise<PriceAudit[]> {
    const db = await getDb();
    if (!db) return [];
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Get the most recent audit for each date range
    return await db
      .select()
      .from(priceAudits)
      .where(gte(priceAudits.dateScraped, cutoff))
      .orderBy(desc(priceAudits.dateScraped));
  }

  /**
   * Fetches audit history for a given date range and property.
   */
  static async getAudits(property: "Sadoles" | "Hacjenda", from: Date, to: Date): Promise<PriceAudit[]> {
    const db = await getDb();
    if (!db) return [];

    return await db
      .select()
      .from(priceAudits)
      .where(
        and(
          eq(priceAudits.property, property),
          gte(priceAudits.checkIn, from),
          sql`${priceAudits.checkIn} <= ${to}`
        )
      )
      .orderBy(priceAudits.checkIn);
  }
}
