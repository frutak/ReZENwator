import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { expenses } from "../../drizzle/schema";
import { type Property } from "@shared/config";

export type ExpenseType = "utility" | "purchase";

export class ExpenseRepository {
  static async getExpenses(filters: {
    property?: Property;
    type?: ExpenseType;
    year?: number;
  } = {}) {
    const db = await getDb();
    if (!db) return [];

    const conditions = [];
    if (filters.property) conditions.push(eq(expenses.property, filters.property));
    if (filters.type) conditions.push(eq(expenses.type, filters.type));
    if (filters.year) {
      const startOfYear = new Date(filters.year, 0, 1);
      const endOfYear = new Date(filters.year, 11, 31, 23, 59, 59);
      conditions.push(gte(expenses.paymentDate, startOfYear));
      conditions.push(lte(expenses.paymentDate, endOfYear));
    }

    return db
      .select()
      .from(expenses)
      .where(and(...conditions))
      .orderBy(desc(expenses.paymentDate));
  }

  static async insertExpense(values: typeof expenses.$inferInsert) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.insert(expenses).values(values);
  }

  static async deleteExpense(id: number) {
    const db = await getDb();
    if (!db) return;
    await db.delete(expenses).where(eq(expenses.id, id));
  }
}
