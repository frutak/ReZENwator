import { getDb } from "../db";
import { bankTransfers, bookings, type InsertBankTransfer, type BankTransfer } from "../../drizzle/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

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
   * Uses upsert-like logic via externalId to avoid duplicates.
   */
  static async insertTransfer(transfer: InsertBankTransfer) {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");
    
    return db.insert(bankTransfers).values(transfer).onDuplicateKeyUpdate({
      set: { 
        amount: transfer.amount,
        senderName: transfer.senderName,
        transferTitle: transfer.transferTitle,
        transferDate: transfer.transferDate,
      }
    });
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
}
