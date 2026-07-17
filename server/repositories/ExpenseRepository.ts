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

  /**
   * Total expenses grouped by the month they were actually paid
   * (`paymentDate`), split into utilities and purchases.
   *
   * This is deliberately by payment date, not by the covered period — for a
   * cash view we want the month money left the account, even if a utility
   * invoice covers several months. Expenses carry no channel, so only the
   * property filter applies here.
   */
  static async getMonthlyPaidByType(filters: {
    property?: Property;
    year?: number;
  } = {}): Promise<Array<{ month: string; utilities: number; purchases: number }>> {
    const db = await getDb();
    if (!db) return [];

    const conditions = [];
    if (filters.property) conditions.push(eq(expenses.property, filters.property));
    if (filters.year) {
      conditions.push(gte(expenses.paymentDate, new Date(filters.year, 0, 1)));
      conditions.push(lte(expenses.paymentDate, new Date(filters.year, 11, 31, 23, 59, 59)));
    }

    const rows = await db
      .select({
        month: sql<string>`DATE_FORMAT(${expenses.paymentDate}, '%Y-%m')`,
        type: expenses.type,
        total: sql<string>`SUM(${expenses.amount})`,
      })
      .from(expenses)
      .where(and(...conditions))
      .groupBy(sql`DATE_FORMAT(${expenses.paymentDate}, '%Y-%m')`, expenses.type);

    const byMonth = new Map<string, { month: string; utilities: number; purchases: number }>();
    for (const r of rows) {
      const m = byMonth.get(r.month) ?? { month: r.month, utilities: 0, purchases: 0 };
      const amount = parseFloat(String(r.total ?? "0")) || 0;
      if (r.type === "utility") m.utilities += amount;
      else if (r.type === "purchase") m.purchases += amount;
      byMonth.set(r.month, m);
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  static async insertExpense(values: typeof expenses.$inferInsert) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.insert(expenses).values(values);
  }

  static async updateExpense(id: number, values: Partial<typeof expenses.$inferInsert>) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.update(expenses).set(values).where(eq(expenses.id, id));
  }

  static async deleteExpense(id: number) {
    const db = await getDb();
    if (!db) return;
    await db.delete(expenses).where(eq(expenses.id, id));
  }
}
