import { getDb } from "../db";
import { priceAudits, type InsertPriceAudit, type PriceAudit } from "../../drizzle/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { format } from "date-fns";

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
   * How far back an observation stays worth showing.
   *
   * A stored audit is only as trustworthy as the code that produced it, and both the
   * scraper and the benchmark have been reworked repeatedly — prices read before those
   * changes are wrong in ways no longer worth explaining on the dashboard. Anything the
   * auditor still cares about gets re-probed well inside this window, so a reading that
   * has aged out is one nothing has confirmed since.
   */
  static readonly MAX_AUDIT_AGE_DAYS = 60;

  /**
   * Current audit picture for a property: the newest observation of each stay whose
   * check-in falls in the requested range, ignoring readings that have aged out.
   */
  static async getAudits(property: "Sadoles" | "Hacjenda", from: Date, to: Date): Promise<PriceAudit[]> {
    const db = await getDb();
    if (!db) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PricingAuditRepository.MAX_AUDIT_AGE_DAYS);

    const rows = await db
      .select()
      .from(priceAudits)
      .where(
        and(
          eq(priceAudits.property, property),
          gte(priceAudits.checkIn, from),
          sql`${priceAudits.checkIn} <= ${to}`,
          gte(priceAudits.dateScraped, cutoff)
        )
      )
      .orderBy(desc(priceAudits.dateScraped));

    // Every probe appends a row, so a stay probed nightly for a fortnight carries a
    // fortnight of rows — which the calendar drew as a stack of identical bars, the
    // oldest of them contradicting the newest. Keep only the latest reading per stay.
    //
    // Keyed on the calendar day, not the timestamp: the same stay sits in the table
    // under 14:00, 15:00 and 00:00 check-ins depending on the daylight-saving offset
    // in force when the row was written, and the calendar places a bar by its day
    // regardless.
    const latest = new Map<string, PriceAudit>();
    for (const row of rows) {
      const key = `${format(new Date(row.checkIn), "yyyy-MM-dd")}|${format(new Date(row.checkOut), "yyyy-MM-dd")}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    return [...latest.values()].sort(
      (a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
    );
  }
}
