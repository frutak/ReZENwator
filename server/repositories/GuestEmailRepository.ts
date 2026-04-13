import { desc, eq, and, gte } from "drizzle-orm";
import { getDb } from "../db";
import { guestEmails } from "../../drizzle/schema";

export class GuestEmailRepository {
  static async insertEmailLog(data: typeof guestEmails.$inferInsert) {
    const db = await getDb();
    if (!db) return;
    await db.insert(guestEmails).values(data);
  }

  static async findFailedEmails(since: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(guestEmails)
      .where(
        and(
          eq(guestEmails.success, "false"),
          gte(guestEmails.sentAt, since)
        )
      );
  }

  static async findEmailsByBookingId(bookingId: number) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(guestEmails)
      .where(eq(guestEmails.bookingId, bookingId));
  }
}
