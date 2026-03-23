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
} from "./db";
import { pollAllICalFeeds, pollICalFeed } from "./workers/icalPoller";
import { pollEmails } from "./workers/emailPoller";
import { findMatchingBookings, applyTransferMatch } from "./workers/bookingMatcher";
import { detectDoubleBookings } from "./workers/doubleBookingDetector";
import { ICAL_FEEDS } from "./workers/icalConfig";
import { getDb } from "./db";
import { bookings } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Booking router ───────────────────────────────────────────────────────────

const bookingRouter = router({
  list: publicProcedure
    .input(
      z.object({
        property: z.enum(["Sadoles", "Hacjenda"]).optional(),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).optional(),
        status: z.enum(["pending", "confirmed", "paid", "finished"]).optional(),
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
        status: z.enum(["pending", "confirmed", "paid_to_intermediary", "paid", "finished"]),
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
        guestEmail: z.string().optional(),
        guestPhone: z.string().optional(),
        guestCount: z.number().optional(),
        adultsCount: z.number().optional(),
        childrenCount: z.number().optional(),
        animalsCount: z.number().optional(),
        totalPrice: z.string().optional(),
        hostRevenue: z.string().optional(),
        currency: z.string().optional(),
        amountPaid: z.string().optional(),
        channel: z.enum(["slowhop", "airbnb", "booking", "alohacamp", "direct"]).optional(),
        status: z.enum(["pending", "confirmed", "paid_to_intermediary", "paid", "finished"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, ...details } = input;

      // Normalize decimal fields: convert empty strings to null
      const normalizedDetails: any = { ...details };
      if (normalizedDetails.totalPrice === "") normalizedDetails.totalPrice = null;
      if (normalizedDetails.hostRevenue === "") normalizedDetails.hostRevenue = null;
      if (normalizedDetails.amountPaid === "") normalizedDetails.amountPaid = null;

      await db.update(bookings).set(normalizedDetails).where(eq(bookings.id, id));
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
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
