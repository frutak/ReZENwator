import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { monthlyAdjustments } from "../../drizzle/schema";
import { type Property } from "@shared/config";

export class MonthlyAdjustmentRepository {
  static async getAdjustments(filters: {
    property?: Property;
    year?: number;
  } = {}) {
    const db = await getDb();
    if (!db) return [];

    const conditions = [];
    if (filters.property) conditions.push(eq(monthlyAdjustments.property, filters.property));
    if (filters.year) {
      conditions.push(sql`${monthlyAdjustments.month} LIKE ${`${filters.year}-%`}`);
    }

    return db
      .select()
      .from(monthlyAdjustments)
      .where(and(...conditions))
      .orderBy(monthlyAdjustments.month);
  }

  static async upsertAdjustment(data: {
    property: Property;
    month: string;
    amount: string;
    category: string;
    notes?: string;
  }) {
    const db = await getDb();
    if (!db) return;

    await db.insert(monthlyAdjustments).values(data).onDuplicateKeyUpdate({
      set: {
        amount: data.amount,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      }
    });
  }
}
