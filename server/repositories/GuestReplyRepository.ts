import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
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

  /**
   * Bookings whose stay has not long finished, for the name fallback.
   *
   * Bounded by checkout rather than fetched whole: a name match only makes
   * sense against a stay the guest could still be writing about, and the
   * comparison itself has to happen in JS — MySQL cannot tell that
   * "Gibalska, Maja" and "Maja Gibalska" are one person.
   */
  static async findBookingsWithGuestNameSince(checkOutAfter: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          isNotNull(bookings.guestName),
          gte(bookings.checkOut, checkOutAfter),
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

  /**
   * Drafts for the review panel, each with the booking it was grounded in.
   *
   * Left join, not inner: a draft with no booking is exactly the case that
   * needs a human, so dropping those rows would hide the ones that matter most.
   */
  static async listForReview(statuses: Array<(typeof guestReplyDrafts.$inferSelect)["status"]>, limit = 50) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({ draft: guestReplyDrafts, booking: bookings })
      .from(guestReplyDrafts)
      .leftJoin(bookings, eq(guestReplyDrafts.bookingId, bookings.id))
      .where(inArray(guestReplyDrafts.status, statuses))
      .orderBy(desc(guestReplyDrafts.receivedAt))
      .limit(limit);
  }

  /**
   * Claims a draft for sending.
   *
   * The conditional update is the guard against double delivery: two clicks, or
   * a click racing a retry, both call this and only the one that flips the row
   * out of `pending` gets to send. Returns false when someone else got there.
   */
  static async claimForSending(id: number): Promise<boolean> {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");
    const [result]: any = await db
      .update(guestReplyDrafts)
      .set({ status: "sending" })
      .where(and(eq(guestReplyDrafts.id, id), eq(guestReplyDrafts.status, "pending")));
    return (result?.affectedRows ?? 0) > 0;
  }

  /**
   * Inbound emails waiting to be drafted, oldest first.
   *
   * Oldest first on purpose: if several arrive at once, the guest who wrote
   * first is answered first, and a backlog drains in the order it formed.
   */
  static async findPendingDrafting(limit = 20) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(guestReplyDrafts)
      .where(eq(guestReplyDrafts.status, "new"))
      .orderBy(guestReplyDrafts.receivedAt)
      .limit(limit);
  }

  static async update(id: number, fields: Partial<typeof guestReplyDrafts.$inferInsert>) {
    const db = await getDb();
    if (!db) throw new Error("Database not initialized");
    return db.update(guestReplyDrafts).set(fields).where(eq(guestReplyDrafts.id, id));
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
