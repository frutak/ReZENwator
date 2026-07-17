import { getDb } from "../db";
import { bankTransfers, bookings, type InsertBankTransfer, type BankTransfer } from "../../drizzle/schema";
import { eq, and, isNull, desc, gte, lte, sql } from "drizzle-orm";
import type { Property, Channel } from "@shared/config";

/**
 * First month with complete transfer data.
 *
 * Bank transfers only started being recorded on 2026-04-30, so April holds a
 * single stray transfer and earlier months none at all. Cashflow is reported
 * from May 2026 onward; anything before that would understate reality rather
 * than simply be empty.
 */
export const CASHFLOW_START_MONTH = "2026-05";

export class BankTransferRepository {
  /**
   * Fetches all transfers with a specific status.
   */
  static async getTransfersByStatus(status: BankTransfer["status"]) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.status, status))
      .orderBy(desc(bankTransfers.transferDate));
  }

  /**
   * Fetches matched transfers joined with their corresponding booking.
   */
  static async getMatchedTransfers() {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        transfer: bankTransfers,
        booking: bookings,
      })
      .from(bankTransfers)
      .leftJoin(bookings, eq(bankTransfers.matchedBookingId, bookings.id))
      .where(eq(bankTransfers.status, "matched"))
      .orderBy(desc(bankTransfers.transferDate));
  }

  /**
   * Fetches a single transfer by its internal ID.
   */
  static async getTransferById(id: number) {
    const db = await getDb();
    if (!db) return null;
    const [result] = await db
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.id, id))
      .limit(1);
    return result || null;
  }

  /**
   * Inserts a new bank transfer record.
   *
   * Relies on the unique index on `externalId`: a transfer that has already been
   * seen is skipped rather than updated, and `inserted: false` is returned. The
   * insert is the idempotency gate for applying payments to a booking — callers
   * must not apply the money when this returns false, or a re-delivered email
   * double-counts the transfer.
   */
  static async insertTransfer(transfer: InsertBankTransfer): Promise<{ inserted: boolean }> {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [result] = await db.insert(bankTransfers).ignore().values(transfer);
    return { inserted: result.affectedRows > 0 };
  }

  /**
   * Updates a transfer's status by its internal ID.
   */
  static async updateTransferStatus(id: number, status: BankTransfer["status"], matchedBookingId?: number) {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");
    
    return db.update(bankTransfers)
      .set({ 
        status, 
        matchedBookingId: matchedBookingId ?? null 
      })
      .where(eq(bankTransfers.id, id));
  }

  /**
   * Updates a transfer's status by its external ID (email Message-ID).
   */
  static async updateTransferStatusByExternalId(externalId: string, status: BankTransfer["status"], matchedBookingId?: number) {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");
    
    return db.update(bankTransfers)
      .set({
        status,
        matchedBookingId: matchedBookingId ?? null
      })
      .where(eq(bankTransfers.externalId, externalId));
  }

  /**
   * Monthly cash inflow, aggregated by the date money actually arrived.
   *
   * This is deliberately different from the booking-based analytics, which
   * group by check-in date: a stay in August paid for in May counts here as
   * May. Only `matched` transfers are included — `ignored` ones are the
   * owner's flag for "not rental income" (ZUS, bailiff, personal transfers).
   *
   * Property/channel filters resolve through the matched booking, so a
   * filtered view necessarily drops transfers whose booking is gone.
   */
  static async getMonthlyCashflow(filters: {
    property?: Property;
    channel?: Channel;
    year?: number;
  } = {}): Promise<Array<{ month: string; total: number; count: number }>> {
    const db = await getDb();
    if (!db) return [];

    const conditions = [eq(bankTransfers.status, "matched")];

    // Never report months whose data is known to be incomplete.
    conditions.push(gte(bankTransfers.transferDate, new Date(`${CASHFLOW_START_MONTH}-01T00:00:00Z`)));

    if (filters.year) {
      conditions.push(gte(bankTransfers.transferDate, new Date(filters.year, 0, 1)));
      conditions.push(lte(bankTransfers.transferDate, new Date(filters.year, 11, 31, 23, 59, 59)));
    }
    if (filters.property) conditions.push(eq(bookings.property, filters.property));
    if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));

    const rows = await db
      .select({
        month: sql<string>`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`,
        total: sql<string>`SUM(${bankTransfers.amount})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(bankTransfers)
      // Inner join: a matched transfer always has a booking, and filtering by
      // property/channel is only meaningful through it.
      .innerJoin(bookings, eq(bookings.id, bankTransfers.matchedBookingId))
      .where(and(...conditions))
      .groupBy(sql`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`);

    return rows.map((r) => ({
      month: r.month,
      total: parseFloat(String(r.total ?? "0")) || 0,
      count: Number(r.count ?? 0),
    }));
  }
}
