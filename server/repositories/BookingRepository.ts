import { and, desc, eq, gte, lte, ne, inArray, or, sql, isNull, isNotNull, lt, notInArray } from "drizzle-orm";
import { format, startOfDay, differenceInCalendarMonths, startOfMonth, addMonths, differenceInCalendarDays, eachWeekendOfInterval, isAfter, startOfYear, endOfYear } from "date-fns";
import { getDb, type DbExecutor } from "../db";
import { bookings, bookingActivities, expenses, monthlyAdjustments } from "../../drizzle/schema";
import { Logger } from "../_core/logger";
import { PROPERTIES, type Property, type Channel, type BookingStatus, type DepositStatus } from "@shared/config";
import { CleaningService } from "../services/CleaningService";

export type BookingFilters = {
  property?: Property;
  channel?: Channel;
  status?: BookingStatus;
  depositStatus?: DepositStatus;
  checkInFrom?: Date;
  checkInTo?: Date;
  timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all" | "previous_month";
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
    } else if (filters.timeRange === "previous_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
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
    timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all" | "previous_month";
  } = {}) {
    const db = await getDb();
    if (!db) return null;

    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (filters.timeRange === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (filters.timeRange === "previous_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
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
      depositStatus: bookings.depositStatus,
    }).from(bookings).where(
      and(
        ...conditions,
        !filters.status || filters.status.length === 0 ? ne(bookings.status, "cancelled") : undefined
      )
    ).then(rows => {
      // If status filter is provided and contains 'finished', 
      // we might want to apply special logic for 'active' view consistency.
      // However, usually filters.status being [pending, confirmed, portal_paid, paid, finished] 
      // comes from "active" or "all" in dashboard.
      // To match the UI list: when in "active" mode, finished bookings only count if deposit is paid.
      
      // Let's see if we can detect 'active' mode. In dashboard, active = [pending, confirmed, portal_paid, paid, finished] (after my change)
      const isActiveMode = filters.status?.includes("pending") && filters.status?.includes("finished");
      
      if (isActiveMode) {
        return rows.filter(b => b.status !== "finished" || b.depositStatus === "paid");
      }
      return rows;
    });

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
          ne(bookings.type, "internal"),
          or(
            // Leisure: must have guestName
            and(
              ne(bookings.purpose, "company"),
              ne(bookings.purpose, "production"),
              or(isNull(bookings.guestName), eq(bookings.guestName, ""))
            ),
            // Company/Production: must have either guestName or companyName
            and(
              or(eq(bookings.purpose, "company"), eq(bookings.purpose, "production")),
              or(isNull(bookings.guestName), eq(bookings.guestName, "")),
              or(isNull(bookings.companyName), eq(bookings.companyName, ""))
            ),
            // Email check (except Airbnb)
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

  static async findBlockingBookingsForEarlyArrival(property: Property, bookingId: number, checkInDate: Date) {
    const db = await getDb();
    if (!db) return [];
    const checkInDateStr = format(checkInDate, "yyyy-MM-dd");
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.id, bookingId),
          ne(bookings.status, "cancelled"),
          sql`DATE(${bookings.checkOut}) = ${checkInDateStr}`
        )
      );
  }

  static async updateBookingDetails(id: number, details: Partial<typeof bookings.$inferInsert>) {
    const db = await getDb();
    if (!db) return;

    // Check for cleaning conflicts if dates or property change
    if (details.checkIn || details.checkOut || details.property) {
      const current = await this.getBookingById(id);
      if (current) {
        const prop = (details.property as Property) || current.property;
        const cin = details.checkIn ? new Date(details.checkIn) : new Date(current.checkIn);
        const cout = details.checkOut ? new Date(details.checkOut) : new Date(current.checkOut);
        
        CleaningService.checkCleaningConflicts(prop, cin, cout, id || (current as any).id).catch(err => 
          console.error("[CleaningService] Background conflict check failed:", err)
        );
      }
    }

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

    // Check for cleaning conflicts
    if (values.property && values.checkIn && values.checkOut) {
      CleaningService.checkCleaningConflicts(
        values.property as Property, 
        new Date(values.checkIn), 
        new Date(values.checkOut)
      ).catch(err => 
        console.error("[CleaningService] Background conflict check failed:", err)
      );
    }

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

    // Check for cleaning conflicts if dates or property change
    if (data.checkIn || data.checkOut || data.property) {
      const current = await this.getBookingByIcalUid(icalUid);
      if (current) {
        const prop = (data.property as Property) || current.property;
        const cin = data.checkIn ? new Date(data.checkIn) : new Date(current.checkIn);
        const cout = data.checkOut ? new Date(data.checkOut) : new Date(current.checkOut);
        
        CleaningService.checkCleaningConflicts(prop, cin, cout, current.id).catch(err => 
          console.error("[CleaningService] Background conflict check failed:", err)
        );
      }
    }

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
  }, executor?: DbExecutor) {
    const db = executor ?? await getDb();
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
    const dateStr = format(checkInDate, "yyyy-MM-dd");
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.id, currentBookingId),
          ne(bookings.status, "cancelled"),
          sql`DATE(${bookings.checkOut}) = ${dateStr}`
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
    
    const startMonthStr = format(startDate, "yyyy-MM");
    const endMonthStr = format(endDate, "yyyy-MM");

    // We fetch bookings where:
    // 1. invoiceMonth matches the target month
    // 2. invoiceMonth is NULL and checkIn matches the target month
    // 3. invoiceMonth is NOT NULL, but checkIn is EARLIER than invoiceMonth and checkIn matches the target month
    
    // Simplest approach: fetch anything that COULD potentially be in this month's report.
    // That means checkIn <= endDate OR invoiceMonth <= endMonthStr.
    // Then we filter strictly in the service/router.
    
    return db.select().from(bookings).where(
      and(
        ne(bookings.status, "cancelled"),
        or(
          and(
            gte(bookings.checkIn, startDate),
            lte(bookings.checkIn, endDate)
          ),
          and(
            isNotNull(bookings.invoiceMonth),
            gte(bookings.invoiceMonth, startMonthStr),
            lte(bookings.invoiceMonth, endMonthStr)
          )
        )
      )
    );
  }

  static async getAirbnbBookingsCreatedInRange(startDate: Date, endDate: Date) {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(bookings).where(
      and(
        eq(bookings.channel, "airbnb"),
        gte(bookings.createdAt, startDate),
        lte(bookings.createdAt, endDate),
        ne(bookings.status, "cancelled")
      )
    );
  }

  static async findMissingBookings(property: Property, channel: Channel, todayStart: Date, seenUids: string[]) {
    const db = await getDb();
    if (!db) return [];

    // Safety: If seenUids is empty, it's very likely a transient iCal feed issue.
    // We don't want to auto-cancel everything for this channel/property.
    if (seenUids.length === 0) {
      console.warn(`[BookingRepository] Skipping findMissingBookings for ${property}/${channel} because seenUids is empty (safety check).`);
      return [];
    }

    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

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
          notInArray(bookings.icalUid, seenUids),
          ne(bookings.icalUid, "manual"),
          // Grace period: don't auto-cancel email-created bookings if they are less than 1 hour old
          // and haven't been matched to a real iCal UID yet.
          sql`(${bookings.icalUid} NOT LIKE 'email-%' OR ${bookings.createdAt} < ${oneHourAgo})`
        )
      );
  }

  static async countActiveBookings(property: Property, channel: Channel, todayStart: Date) {
    const db = await getDb();
    if (!db) return 0;

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          eq(bookings.channel, channel),
          ne(bookings.status, "finished"),
          ne(bookings.status, "cancelled"),
          gte(bookings.checkIn, todayStart)
        )
      );

    return result[0]?.count || 0;
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
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.status, "cancelled")
        )
      );
  }

  static async getBookingsForExport(property: Property) {
    const db = await getDb();
    if (!db) return [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property),
          ne(bookings.status, "cancelled"),
          gte(bookings.checkOut, todayStart)
        )
      );
  }

  static async getAnalytics(filters: {
    property?: Property;
    channel?: Channel;
    year?: number;
  } = {}) {
    const db = await getDb();
    if (!db) return { monthlyData: [], weekendStats: { pastYear: 0, next3Months: 0, next6Months: 0 } };

    const targetYear = filters.year || new Date().getFullYear();
    const startDate = new Date(targetYear, 0, 1);
    const endDate = new Date(targetYear, 11, 31, 23, 59, 59);

    // 1. Fetch relevant bookings for financials
    const commercialConditions = [
      inArray(bookings.status, ["confirmed", "portal_paid", "paid", "finished"]),
      ne(bookings.type, "block"),
      gte(bookings.checkIn, startDate),
      lte(bookings.checkIn, endDate),
    ];
    if (filters.property) commercialConditions.push(eq(bookings.property, filters.property));
    if (filters.channel) commercialConditions.push(eq(bookings.channel, filters.channel));

    const periodBookings = await db
      .select()
      .from(bookings)
      .where(and(...commercialConditions))
      .orderBy(bookings.checkIn);

    // 2. Fetch expenses
    const expenseConditions = [];
    if (filters.property) expenseConditions.push(eq(expenses.property, filters.property));
    const allExpenses = await db.select().from(expenses).where(and(...expenseConditions));

    // 3. Fetch all property timeline for Sadoles rules
    const propertyConditions = [];
    if (filters.property) propertyConditions.push(eq(bookings.property, filters.property));
    const timelineBookings = await db
      .select({
        id: bookings.id,
        property: bookings.property,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        animalsCount: bookings.animalsCount,
        status: bookings.status,
      })
      .from(bookings)
      .where(and(
        ...propertyConditions,
        inArray(bookings.status, ["confirmed", "portal_paid", "paid", "finished"])
      ))
      .orderBy(bookings.checkIn);

    // 4. Initialize months
    const resultsByMonth: Record<string, any> = {};
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${targetYear}-${String(m).padStart(2, '0')}`;
      resultsByMonth[monthKey] = {
        month: monthKey,
        totalPrice: 0,
        hostRevenue: 0,
        commission: 0,
        cleaningCosts: 0,
        utilityCosts: 0,
        purchaseCosts: 0,
        profit: 0,
        count: 0,
        totalNights: 0,
        extraCleaning: 0,
      };
    }

    // 5. Aggregate bookings
    for (const booking of periodBookings) {
      const bDate = new Date(booking.checkIn);
      const monthKey = `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!resultsByMonth[monthKey]) continue;

      let previousBooking = null;
      if (booking.property === "Sadoles") {
        const index = timelineBookings.findIndex(b => b.id === booking.id);
        if (index > 0) previousBooking = timelineBookings[index - 1];
      }

      const cleaningFee = CleaningService.calculateCleaningFee(booking as any, previousBooking as any);
      const totalPrice = parseFloat(String(booking.totalPrice || "0"));
      const commission = parseFloat(String(booking.commission || "0"));
      const hostRevenue = parseFloat(String(booking.hostRevenue || "0"));
      const nights = Math.max(1, differenceInCalendarDays(new Date(booking.checkOut), new Date(booking.checkIn)));

      resultsByMonth[monthKey].totalPrice += totalPrice;
      resultsByMonth[monthKey].hostRevenue += hostRevenue;
      resultsByMonth[monthKey].commission += commission;
      resultsByMonth[monthKey].cleaningCosts += cleaningFee;
      resultsByMonth[monthKey].count += 1;
      resultsByMonth[monthKey].totalNights += nights;
    }

    // 6. Aggregate expenses
    for (const expense of allExpenses) {
      const amount = parseFloat(String(expense.amount));
      if (expense.type === "purchase") {
        const pDate = new Date(expense.paymentDate);
        const monthKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
        if (resultsByMonth[monthKey]) resultsByMonth[monthKey].purchaseCosts += amount;
      } else if (expense.type === "utility" && expense.startDate && expense.endDate) {
        const start = startOfMonth(new Date(expense.startDate));
        const end = startOfMonth(new Date(expense.endDate));
        const monthCount = differenceInCalendarMonths(end, start) + 1;
        const monthlyAmount = amount / monthCount;
        for (let i = 0; i < monthCount; i++) {
          const uDate = addMonths(start, i);
          const monthKey = `${uDate.getFullYear()}-${String(uDate.getMonth() + 1).padStart(2, '0')}`;
          if (resultsByMonth[monthKey]) resultsByMonth[monthKey].utilityCosts += monthlyAmount;
        }
      }
    }

    // 7. Process Monthly Adjustments
    const adjustments = await db
      .select()
      .from(monthlyAdjustments)
      .where(and(
        filters.property ? eq(monthlyAdjustments.property, filters.property) : undefined,
        sql`${monthlyAdjustments.month} LIKE ${`${targetYear}-%`}`
      ));

    for (const adj of adjustments) {
      if (resultsByMonth[adj.month]) {
        const amount = parseFloat(String(adj.amount || "0"));
        if (adj.category === "extra_cleaning") {
          resultsByMonth[adj.month].cleaningCosts += amount;
          resultsByMonth[adj.month].extraCleaning += amount;
        }
      }
    }

    // 8. Calculate final profit
    for (const key in resultsByMonth) {
      const m = resultsByMonth[key];
      m.profit = m.totalPrice - m.commission - m.cleaningCosts - m.utilityCosts - m.purchaseCosts;
    }

    // 9. Weekend Stats (Optimized Range)
    const now = new Date();
    const currentYear = now.getFullYear();
    const p1S = startOfYear(targetYear === currentYear ? now : new Date(targetYear, 0, 1));
    const p1E = targetYear === currentYear ? now : endOfYear(new Date(targetYear, 0, 1));
    const p2S = now, p2E = addMonths(now, 3);
    const p3S = now, p3E = addMonths(now, 6);

    const globalStart = p1S < p2S ? p1S : p2S;
    const globalEnd = p1E > p3E ? p1E : p3E;

    const occBookings = await db
      .select({ property: bookings.property, checkIn: bookings.checkIn, checkOut: bookings.checkOut })
      .from(bookings)
      .where(and(
        ne(bookings.status, "cancelled"),
        gte(bookings.checkOut, globalStart),
        lte(bookings.checkIn, globalEnd)
      ));

    if (filters.property) {
      const filtered = occBookings.filter(b => b.property === filters.property);
      occBookings.length = 0;
      occBookings.push(...filtered);
    }

    const props = filters.property ? [filters.property] : (PROPERTIES as unknown as Property[]);
    const weekendStats = {
      pastYear: this.calculateWeekendOccupancy(occBookings, p1S, p1E, props),
      next3Months: this.calculateWeekendOccupancy(occBookings, p2S, p2E, props),
      next6Months: this.calculateWeekendOccupancy(occBookings, p3S, p3E, props),
    };

    return {
      monthlyData: Object.values(resultsByMonth).sort((a, b) => a.month.localeCompare(b.month)),
      weekendStats
    };
  }

  private static calculateWeekendOccupancy(bookings: any[], start: Date, end: Date, properties: Property[]) {
    if (isAfter(start, end)) return 0;
    const weekends = eachWeekendOfInterval({ start, end });
    const saturdays = weekends.filter(d => d.getDay() === 6);
    if (saturdays.length === 0) return 0;

    let totalPossible = saturdays.length * properties.length;
    let bookedCount = 0;

    const parsed = bookings.map(b => ({
      prop: b.property,
      in: new Date(b.checkIn).getTime(),
      out: new Date(b.checkOut).getTime()
    }));

    for (const sat of saturdays) {
      const satTime = sat.getTime() + 43200000;
      const friTime = satTime - 86400000;
      for (const prop of properties) {
        const booked = parsed.some(b => b.prop === prop && (b.in < satTime && b.out > friTime));
        if (booked) bookedCount++;
      }
    }
    return (bookedCount / totalPossible) * 100;
  }
}
