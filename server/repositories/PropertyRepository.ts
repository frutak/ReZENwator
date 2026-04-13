import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { propertyRatings, propertySettings, pricingPlans, calendarPricing } from "../../drizzle/schema";
import { type Property } from "@shared/config";

export class PropertyRepository {
  static async getPropertyRatings(property: Property) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(propertyRatings)
      .where(eq(propertyRatings.property, property));
  }

  static async getPropertySettings(property: Property) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db.select().from(propertySettings).where(eq(propertySettings.property, property)).limit(1);
    return result[0] || null;
  }

  static async getPricingPlans(property: Property) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.select().from(pricingPlans).where(eq(pricingPlans.property, property));
  }

  static async getCalendarPricing(property: Property, from: Date, to: Date) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    return db
      .select({
        date: sql<string>`DATE_FORMAT(${calendarPricing.date}, '%Y-%m-%d')`,
        planId: calendarPricing.planId,
        planName: pricingPlans.name,
        nightlyPrice: pricingPlans.nightlyPrice,
        minStay: pricingPlans.minStay,
      })
      .from(calendarPricing)
      .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
      .where(
        and(
          eq(calendarPricing.property, property),
          gte(calendarPricing.date, from),
          lte(calendarPricing.date, to)
        )
      );
  }

  static async getPricingPlanForDate(property: Property, date: Date) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const dateStr = date.toISOString().split("T")[0];

    const result = await db
      .select({
        minStay: pricingPlans.minStay,
        nightlyPrice: pricingPlans.nightlyPrice,
      })
      .from(calendarPricing)
      .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
      .where(
        and(
          eq(calendarPricing.property, property),
          sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") = ${dateStr}`
        )
      )
      .limit(1);

    return result[0] || { minStay: 1, nightlyPrice: 0 };
  }

  static async findNightsPricing(property: Property, checkInStr: string, checkOutStr: string) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    return db
      .select({
        planName: pricingPlans.name,
        nightlyPrice: pricingPlans.nightlyPrice,
        minStay: pricingPlans.minStay,
        date: calendarPricing.date,
      })
      .from(calendarPricing)
      .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
      .where(
        and(
          eq(calendarPricing.property, property),
          sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") >= ${checkInStr}`,
          sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") < ${checkOutStr}`
        )
      );
  }

  static async updatePropertySettings(property: Property, settings: Partial<typeof propertySettings.$inferInsert>) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.update(propertySettings).set(settings).where(eq(propertySettings.property, property));
  }

  static async updatePricingPlan(id: number, plan: Partial<typeof pricingPlans.$inferInsert>) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.update(pricingPlans).set(plan).where(eq(pricingPlans.id, id));
  }

  static async upsertPropertyRating(data: typeof propertyRatings.$inferInsert) {
    const db = await getDb();
    if (!db) return;
    await db.insert(propertyRatings).values(data).onDuplicateKeyUpdate({
      set: {
        rating: data.rating,
        count: data.count,
        updatedAt: new Date(),
      }
    });
  }
}
