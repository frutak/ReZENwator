import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, guestReplyDrafts, type InsertGuestReplyDraft } from "../../drizzle/schema";

export class GuestReplyRepository {
  /**
   * Records an inbound guest email.
   *
   * Relies on the unique index on `inboundMessageId`: a message that has already
   * been recorded is skipped rather than updated, and `inserted: false` is
   * returned. This is the idempotency gate for the reply pipeline — the same
   * email is re-fetched whenever a previous poll failed before flagging it
   * \Seen, and without this it would produce a second draft for one question.
   */
  static async insertInbound(draft: InsertGuestReplyDraft): Promise<{ inserted: boolean }> {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");

    const [result] = await db.insert(guestReplyDrafts).ignore().values(draft);
    return { inserted: result.affectedRows > 0 };
  }

  /**
   * Bookings reachable at this email address, ordered for the tie-breaker in
   * `guestReplyMatcher`.
   *
   * Blocks and internal bookings are excluded because they have no guest, and
   * cancelled ones because answering against a cancelled stay would quote dates
   * and prices that no longer apply. MySQL's default collation is
   * case-insensitive, so the caller only needs to trim the address.
   */
  static async findBookingsByGuestEmail(email: string) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.guestEmail, email),
          inArray(bookings.type, ["normal"]),
          ne(bookings.status, "cancelled")
        )
      )
      .orderBy(bookings.checkIn);
  }

  static async listByStatus(status: (typeof guestReplyDrafts.$inferSelect)["status"]) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(guestReplyDrafts)
      .where(eq(guestReplyDrafts.status, status))
      .orderBy(desc(guestReplyDrafts.receivedAt));
  }

  static async getById(id: number) {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(guestReplyDrafts)
      .where(eq(guestReplyDrafts.id, id))
      .limit(1);
    return row ?? null;
  }
}
