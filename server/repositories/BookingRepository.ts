import { and, desc, eq, gte, lte, ne, inArray, or, sql, isNull, lt, notInArray } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, bookingActivities } from "../../drizzle/schema";
import { Logger } from "../_core/logger";
import { type Property, type Channel, type BookingStatus, type DepositStatus } from "@shared/config";

export type BookingFilters = {
  property?: Property;
  channel?: Channel;
  status?: BookingStatus;
  depositStatus?: DepositStatus;
  checkInFrom?: Date;
  checkInTo?: Date;
  timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all";
  limit?: number;
  offset?: number;
};

export class BookingRepository {
  static async getBookings(filters: BookingFilters = {}) {
    const db = await getDb();
    if (!db) return [];

    const now = new Date();
    let startDate = filters.checkInFrom;
    let endDate = filters.checkInTo;

    if (filters.timeRange === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (filters.timeRange === "next_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    } else if (filters.timeRange === "3months") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);
    } else if (filters.timeRange === "6months") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 6, 0, 23, 59, 59);
    } else if (filters.timeRange === "year") {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    }

    const conditions = [];
    if (filters.property) conditions.push(eq(bookings.property, filters.property));
    if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));
    if (filters.status) conditions.push(eq(bookings.status, filters.status));
    if (filters.depositStatus) conditions.push(eq(bookings.depositStatus, filters.depositStatus));
    if (startDate) conditions.push(gte(bookings.checkIn, startDate));
    if (endDate) conditions.push(lte(bookings.checkIn, endDate));

    return db
      .select()
      .from(bookings)
      .where(
        and(
          ...conditions,
          !filters.status ? ne(bookings.status, "cancelled") : undefined
        )
      )
      .orderBy(desc(bookings.checkIn))
      .limit(filters.limit ?? 200)
      .offset(filters.offset ?? 0);
  }

  static async getBookingById(id: number) {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return result[0] ?? null;
  }

  static async updateBookingStatus(id: number, status: BookingStatus) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set({ status }).where(eq(bookings.id, id));
    await Logger.bookingAction(id, "status_change", `Status updated to ${status}`);
  }

  static async updateDepositStatus(id: number, depositStatus: DepositStatus) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set({ depositStatus }).where(eq(bookings.id, id));
    await Logger.bookingAction(id, "status_change", `Deposit status updated to ${depositStatus}`);
  }

  static async updateBookingNotes(id: number, notes: string) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set({ notes }).where(eq(bookings.id, id));
    await Logger.bookingAction(id, "manual_edit", "Updated booking notes");
  }

  static async getBookingActivities(bookingId: number) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookingActivities)
      .where(eq(bookingActivities.bookingId, bookingId))
      .orderBy(desc(bookingActivities.createdAt));
  }

  static async getBookingStats(filters: {
    property?: Property;
    channel?: Channel;
    status?: BookingStatus[];
    timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all";
  } = {}) {
    const db = await getDb();
    if (!db) return null;

    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (filters.timeRange === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (filters.timeRange === "next_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    } else if (filters.timeRange === "3months") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);
    } else if (filters.timeRange === "6months") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 6, 0, 23, 59, 59);
    } else if (filters.timeRange === "year" || !filters.timeRange) {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    }

    const conditions = [];
    if (filters.property) conditions.push(eq(bookings.property, filters.property));
    if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));
    if (filters.status && filters.status.length > 0) {
      conditions.push(inArray(bookings.status, filters.status));
    }
    if (startDate) conditions.push(gte(bookings.checkIn, startDate));
    if (endDate) conditions.push(lte(bookings.checkIn, endDate));

    const filtered = await db.select({
      id: bookings.id,
      status: bookings.status,
      property: bookings.property,
      channel: bookings.channel,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guestCountry: bookings.guestCountry,
      totalPrice: bookings.totalPrice,
      hostRevenue: bookings.hostRevenue,
    }).from(bookings).where(
      and(
        ...conditions,
        !filters.status || filters.status.length === 0 ? ne(bookings.status, "cancelled") : undefined
      )
    );

    const upcoming = filtered.filter((b) => new Date(b.checkIn) > now && b.status !== "finished");
    const active = filtered.filter((b) => {
      const cin = new Date(b.checkIn);
      const cout = new Date(b.checkOut);
      return cin <= now && cout >= now;
    });
    
    const totalRevenue = filtered
      .filter((b) => ["confirmed", "portal_paid", "paid", "finished"].includes(b.status as string))
      .reduce((sum, b) => sum + (parseFloat(String(b.hostRevenue ?? b.totalPrice ?? "0")) || 0), 0);

    return {
      total: filtered.length,
      upcoming: upcoming.length,
      active: active.length,
      paid: filtered.filter((b) => b.status === "paid" || b.status === "finished" || b.status === "portal_paid").length,
      pending: filtered.filter((b) => b.status === "pending").length,
      confirmed: filtered.filter((b) => b.status === "confirmed").length,
      finished: filtered.filter((b) => b.status === "finished").length,
      totalRevenue: Math.round(totalRevenue),
    };
  }

  static async findPortalPayoutCandidates(channel: Channel, windowStart: Date, windowEnd: Date, testMode = false) {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(bookings).where(
      and(
        eq(bookings.channel, channel),
        testMode ? undefined : inArray(bookings.status, ["portal_paid", "confirmed", "finished"]),
        gte(bookings.checkIn, windowStart),
        lte(bookings.checkIn, windowEnd)
      )
    );
  }

  static async findDirectTransferCandidates(windowStart: Date, windowEnd: Date, testMode = false) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          testMode ? undefined : or(
            eq(bookings.status, "pending"),
            eq(bookings.status, "confirmed"),
            eq(bookings.status, "paid"),
            eq(bookings.status, "portal_paid"),
            eq(bookings.status, "finished")
          ),
          gte(bookings.checkIn, windowStart),
          lte(bookings.checkIn, windowEnd)
        )
      );
  }

  static async findBookingsMissingData(now: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          or(
            isNull(bookings.guestName),
            eq(bookings.guestName, ""),
            and(
              or(isNull(bookings.guestEmail), eq(bookings.guestEmail, "")),
              ne(bookings.channel, "airbnb")
            )
          ),
          inArray(bookings.status, ["confirmed", "portal_paid", "paid", "pending"]),
          gte(bookings.checkOut, now)
        )
      );
  }

  static async findPortalBookingsForTransition(horizon: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          lte(bookings.checkIn, horizon),
          eq(bookings.status, "confirmed"),
          inArray(bookings.channel, ["airbnb", "booking"])
        )
      );
  }

  static async findExpiredPending(expiryDate: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "pending"),
          lt(bookings.createdAt, expiryDate)
        )
      );
  }

  static async findPaidEnded(now: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "paid"),
          lt(bookings.checkOut, now)
        )
      );
  }

  static async findStalePending(start: Date, end: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "pending"),
          lt(bookings.createdAt, start),
          gte(bookings.createdAt, end)
        )
      );
  }

  static async findUpcomingUnpaid(horizon: Date, now: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "confirmed"),
          lte(bookings.checkIn, horizon),
          gte(bookings.checkIn, now)
        )
      );
  }

  static async findUpcomingPendingDeposits(horizon: Date, now: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.depositStatus, "pending"),
          lte(bookings.checkIn, horizon),
          gte(bookings.checkIn, now),
          ne(bookings.status, "cancelled")
        )
      );
  }

  static async findDepositsToReturn() {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(and(eq(bookings.status, "finished"), eq(bookings.depositStatus, "paid")));
  }

  static async findStalePortalPaid(horizon: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "portal_paid"),
          lte(bookings.checkOut, horizon)
        )
      );
  }

  static async findActiveBookingsForEmails() {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        inArray(bookings.status, ["confirmed", "portal_paid", "paid", "finished"])
      );
  }

  static async findBlockingBookingsForEarlyArrival(property: Property, bookingId: number, checkInDate: Date, prevDay: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.id, bookingId),
          inArray(bookings.checkOut, [checkInDate, prevDay])
        )
      );
  }

  static async updateBookingDetails(id: number, details: Partial<typeof bookings.$inferInsert>) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set(details).where(eq(bookings.id, id));
  }

  static async deleteBooking(id: number) {
    const db = await getDb();
    if (!db) return;
    await db.delete(bookings).where(eq(bookings.id, id));
  }

  static async insertBooking(values: typeof bookings.$inferInsert) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.insert(bookings).values(values);
  }

  static async getBookingByIcalUid(icalUid: string) {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(bookings).where(eq(bookings.icalUid, icalUid)).limit(1);
    return result[0] ?? null;
  }

  static async updateIcalBooking(icalUid: string, data: Partial<typeof bookings.$inferInsert>) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set(data).where(eq(bookings.icalUid, icalUid));
  }

  static async updateBookingPayment(id: number, data: {
    status: BookingStatus;
    depositStatus: DepositStatus;
    amountPaid: string;
    transferAmount?: string;
    transferSender?: string;
    transferTitle?: string;
    transferDate?: Date;
    matchScore?: number;
  }) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set(data).where(eq(bookings.id, id));
  }

  static async findOverlapCandidates(property: Property, checkIn: Date, checkOut: Date) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.status, "cancelled"),
          sql`${bookings.checkIn} < ${checkOut}`,
          sql`${bookings.checkOut} > ${checkIn}`
        )
      );
  }

  static async findPreviousDayCheckOut(property: Property, checkInDate: Date, currentBookingId: number) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.id, currentBookingId),
          eq(bookings.checkOut, checkInDate)
        )
      );
  }

  static async markReminderSent(id: number) {
    const db = await getDb();
    if (!db) return;
    await db.update(bookings).set({ reminderSent: 1 }).where(eq(bookings.id, id));
  }

  static async getActiveBookingsForOverlapCheck() {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        id: bookings.id,
        property: bookings.property,
        channel: bookings.channel,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        guestName: bookings.guestName,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          ne(bookings.status, "finished"),
          ne(bookings.status, "cancelled")
        )
      );
  }

  static async findEmailMatchCandidates(channel: Channel, property?: Property) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.channel, channel),
          property ? eq(bookings.property, property) : undefined
        )
      );
  }

  static async findSlowhopBySummaryId(bookingId: string) {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(bookings).where(
      and(
        eq(bookings.channel, "slowhop"),
        sql`${bookings.icalSummary} LIKE ${`%${bookingId}%`}`
      )
    ).limit(1);
    return result[0] ?? null;
  }

  static async getTaxReportData(startDate: Date, endDate: Date) {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(bookings).where(
      and(
        gte(bookings.checkIn, startDate),
        lte(bookings.checkIn, endDate)
      )
    );
  }

  static async findMissingBookings(property: Property, channel: Channel, todayStart: Date, seenUids: string[]) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          eq(bookings.channel, channel),
          ne(bookings.status, "finished"),
          ne(bookings.status, "cancelled"),
          gte(bookings.checkIn, todayStart),
          seenUids.length > 0 ? notInArray(bookings.icalUid, seenUids) : undefined,
          ne(bookings.icalUid, "manual")
        )
      );
  }

  static async getAvailability(property: Property) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
      })
      .from(bookings)
      .where(eq(bookings.property, property));
  }

  static async getBookingsForExport(property: Property) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.status, "cancelled")
        )
      );
  }
}
