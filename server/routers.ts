import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  getBookings,
  getBookingById,
  updateBookingStatus,
  updateDepositStatus,
  updateBookingNotes,
  getBookingStats,
  getRecentSyncLogs,
  getLastSyncTime,
  getPropertyRatings,
} from "./db";
import { pollAllICalFeeds, pollICalFeed } from "./workers/icalPoller";
import { pollEmails } from "./workers/emailPoller";
import { findMatchingBookings, applyTransferMatch } from "./workers/bookingMatcher";
import { detectDoubleBookings } from "./workers/doubleBookingDetector";
import { ICAL_FEEDS } from "./workers/icalConfig";
import { getDb } from "./db";
import { bookings } from "../drizzle/schema";
import { eq, and, gte, lte } from "drizzle-orm";

// ─── Booking router ───────────────────────────────────────────────────────────

const bookingRouter = router({
  list: publicProcedure
    .input(
      z.object({
        property: z.enum(["Sadoles", "Hacjenda"]).optional(),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).optional(),
        status: z.enum(["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"]).optional(),
        depositStatus: z.enum(["pending", "paid", "returned", "not_applicable"]).optional(),
        checkInFrom: z.coerce.date().optional(),
        checkInTo: z.coerce.date().optional(),
        limit: z.number().min(1).max(500).default(200),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      return getBookings(input ?? {});
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getBookingById(input.id);
    }),

  stats: publicProcedure
    .input(
      z.object({
        property: z.enum(["Sadoles", "Hacjenda"]).optional(),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).optional(),
        status: z.array(z.enum(["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"])).optional(),
        timeRange: z.enum(["month", "3months", "6months", "year", "all"]).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return getBookingStats(input ?? {});
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      await updateBookingStatus(input.id, input.status);
      return { success: true };
    }),

  updateDeposit: publicProcedure
    .input(
      z.object({
        id: z.number(),
        depositStatus: z.enum(["pending", "paid", "returned", "not_applicable"]),
      })
    )
    .mutation(async ({ input }) => {
      await updateDepositStatus(input.id, input.depositStatus);
      return { success: true };
    }),

  updateNotes: publicProcedure
    .input(
      z.object({
        id: z.number(),
        notes: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await updateBookingNotes(input.id, input.notes);
      return { success: true };
    }),

  updateDetails: publicProcedure
    .input(
      z.object({
        id: z.number(),
        guestName: z.string().optional(),
        guestCountry: z.string().optional(),
        guestEmail: z.string().optional(),
        guestPhone: z.string().optional(),
        guestCount: z.number().optional(),
        adultsCount: z.number().optional(),
        childrenCount: z.number().optional(),
        animalsCount: z.number().optional(),
        totalPrice: z.string().optional(),
        commission: z.string().optional(),
        hostRevenue: z.string().optional(),
        currency: z.string().optional(),
        amountPaid: z.string().optional(),
        depositAmount: z.string().optional(),
        depositStatus: z.enum(["pending", "paid", "returned", "not_applicable"]).optional(),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).optional(),
        status: z.enum(["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, ...details } = input;

      // Normalize decimal fields: convert empty strings to null
      const normalizedDetails: any = { ...details };
      if (normalizedDetails.totalPrice === "") normalizedDetails.totalPrice = null;
      if (normalizedDetails.commission === "") normalizedDetails.commission = null;
      if (normalizedDetails.hostRevenue === "") normalizedDetails.hostRevenue = null;
      if (normalizedDetails.amountPaid === "") normalizedDetails.amountPaid = null;
      if (normalizedDetails.depositAmount === "") normalizedDetails.depositAmount = null;

      await db.update(bookings).set(normalizedDetails).where(eq(bookings.id, id));
      return { success: true };
    }),

  create: publicProcedure
    .input(
      z.object({
        property: z.enum(["Sadoles", "Hacjenda"]),
        checkIn: z.coerce.date(),
        checkOut: z.coerce.date(),
        guestName: z.string().optional(),
        guestCountry: z.string().optional(),
        guestEmail: z.string().optional(),
        guestPhone: z.string().optional(),
        guestCount: z.number().optional(),
        adultsCount: z.number().optional(),
        childrenCount: z.number().optional(),
        animalsCount: z.number().optional(),
        totalPrice: z.string().optional(),
        commission: z.string().optional(),
        hostRevenue: z.string().optional(),
        currency: z.string().optional(),
        amountPaid: z.string().optional(),
        depositAmount: z.string().optional(),
        depositStatus: z.enum(["pending", "paid", "returned", "not_applicable"]).default("pending"),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).default("direct"),
        status: z.enum(["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"]).default("confirmed"),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Generate a unique icalUid for manual bookings
      const icalUid = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Normalize decimal fields: convert empty strings to null
      const values: any = { ...input, icalUid };
      if (values.totalPrice === "") values.totalPrice = null;
      if (values.commission === "") values.commission = null;
      if (values.hostRevenue === "") values.hostRevenue = null;
      if (values.amountPaid === "") values.amountPaid = null;
      if (values.depositAmount === "") values.depositAmount = null;

      await db.insert(bookings).values(values);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(bookings).where(eq(bookings.id, input.id));
      return { success: true };
    }),

  /** Detect overlapping bookings for the same property */
  doubleBookings: publicProcedure.query(async () => {
    const conflicts = await detectDoubleBookings();
    return conflicts.map((c) => ({
      property: c.property,
      booking1: {
        id: c.booking1.id,
        channel: c.booking1.channel,
        checkIn: c.booking1.checkIn,
        checkOut: c.booking1.checkOut,
        guestName: c.booking1.guestName,
        status: c.booking1.status,
      },
      booking2: {
        id: c.booking2.id,
        channel: c.booking2.channel,
        checkIn: c.booking2.checkIn,
        checkOut: c.booking2.checkOut,
        guestName: c.booking2.guestName,
        status: c.booking2.status,
      },
    }));
  }),

  /** Manually apply a bank transfer match to a booking */
  applyTransferMatch: publicProcedure
    .input(
      z.object({
        bookingId: z.number(),
        transferAmount: z.number().optional(),
        transferSender: z.string().optional(),
        transferTitle: z.string().optional(),
        transferDate: z.coerce.date().optional(),
        score: z.number().default(100),
      })
    )
    .mutation(async ({ input }) => {
      await applyTransferMatch(
        input.bookingId,
        {
          type: "bank",
          bank: "nestbank",
          amount: input.transferAmount,
          senderName: input.transferSender,
          transferTitle: input.transferTitle,
          transferDate: input.transferDate,
          rawText: "",
        },
        input.score
      );
      return { success: true };
    }),

  taxReport: publicProcedure
    .input(z.object({ month: z.number().min(1).max(12), year: z.number() }))
    .query(async ({ input }) => {
      console.log(`[TaxReport] Generating for ${input.month}/${input.year}`);
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Use UTC dates to avoid timezone shifts
      const startDate = new Date(Date.UTC(input.year, input.month - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(input.year, input.month, 0, 23, 59, 59));
      console.log(`[TaxReport] Date range: ${startDate.toISOString()} - ${endDate.toISOString()}`);

      const results = await db.select().from(bookings).where(
        and(
          gte(bookings.checkIn, startDate),
          lte(bookings.checkIn, endDate)
        )
      );
      console.log(`[TaxReport] Found ${results.length} results`);

      return results.map(b => ({
        guestName: b.guestName || "Unknown",
        channel: b.channel,
        property: b.property,
        checkIn: b.checkIn,
        totalPrice: parseFloat(String(b.totalPrice || "0")),
        hostRevenue: parseFloat(String(b.hostRevenue || "0")),
        // Logic: Non-Airbnb: sum host revenue (wait, user said "sum up total revenue for all channels but airbnb, there it should sum guest payout values")
        // Re-reading: "sum up total revenue for all reservations from all channels but airbnb (totalPrice?), 
        // there (airbnb) it should sum the guest payout values (hostRevenue)"
        // Let's provide a column "Taxable Value"
        taxableValue: b.channel === "airbnb" 
          ? parseFloat(String(b.hostRevenue || "0"))
          : parseFloat(String(b.totalPrice || "0"))
      }));
    }),
});

// ─── Sync router ──────────────────────────────────────────────────────────────

const syncRouter = router({
  triggerIcal: publicProcedure.mutation(async () => {
    const result = await pollAllICalFeeds();
    return { success: true, message: "iCal sync triggered" };
  }),

  triggerEmail: publicProcedure.mutation(async () => {
    const result = await pollEmails();
    return {
      success: true,
      processed: result.processed,
      enriched: result.enriched,
      matched: result.matched,
      errors: result.errors,
    };
  }),

  lastRun: publicProcedure.query(async () => {
    const [icalLast, emailLast] = await Promise.all([
      getLastSyncTime("ical"),
      getLastSyncTime("email"),
    ]);
    return { ical: icalLast, email: emailLast };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      return getRecentSyncLogs(input?.limit ?? 20);
    }),

  feeds: publicProcedure.query(() => {
    return ICAL_FEEDS.map((f) => ({
      label: f.label,
      property: f.property,
      channel: f.channel,
    }));
  }),
});

// ─── Public portal router ───────────────────────────────────────────────────

const publicPortalRouter = router({
  getRatings: publicProcedure
    .input(z.object({ property: z.enum(["Sadoles", "Hacjenda"]) }))
    .query(async ({ input }) => {
      return getPropertyRatings(input.property);
    }),

  getAvailability: publicProcedure
    .input(z.object({ property: z.enum(["Sadoles", "Hacjenda"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Fetch all bookings for this property to determine blocked dates
      return db
        .select({
          checkIn: bookings.checkIn,
          checkOut: bookings.checkOut,
        })
        .from(bookings)
        .where(eq(bookings.property, input.property));
    }),

  calculatePrice: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const days = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / (1000 * 60 * 60 * 24));
      const dailyRate = input.property === "Hacjenda" ? 1500 : 1200;
      return {
        days,
        dailyRate,
        totalPrice: days * dailyRate,
        currency: "PLN"
      };
    }),

  submitBooking: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
      guestName: z.string(),
      guestEmail: z.string().email(),
      guestPhone: z.string(),
      guestCount: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const dailyRate = input.property === "Hacjenda" ? 1500 : 1200;
      const days = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / (1000 * 60 * 60 * 24));
      const totalPrice = days * dailyRate;

      const icalUid = `portal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      await db.insert(bookings).values({
        ...input,
        totalPrice: String(totalPrice),
        hostRevenue: String(totalPrice), // For direct portal, revenue = price (assuming no comm)
        commission: "0.00",
        status: "pending",
        channel: "direct",
        icalUid,
      });

      return { success: true };
    }),
});

// ─── App router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  bookings: bookingRouter,
  booking: bookingRouter, // Alias for singular compatibility
  portal: publicPortalRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
