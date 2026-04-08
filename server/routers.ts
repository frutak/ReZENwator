import { z } from "zod";
import { format, setHours, setMinutes } from "date-fns";
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
  getBookingActivities,
  getUserByUsername,
} from "./db";
import { TRPCError } from "@trpc/server";
import { pollAllICalFeeds, pollICalFeed } from "./workers/icalPoller";
import { pollEmails } from "./workers/emailPoller";
import { findMatchingBookings, applyTransferMatch } from "./workers/bookingMatcher";
import { sendGuestEmail, sendAlertEmail } from "./_core/email";
import { detectDoubleBookings } from "./workers/doubleBookingDetector";
import { getICalFeeds } from "./workers/icalConfig";
import { getDb } from "./db";
import { bookings, calendarPricing, pricingPlans, propertySettings, syncStatus, portalAnalytics } from "../drizzle/schema";
import { eq, and, gte, lte, sql, ne } from "drizzle-orm";
import { Logger } from "./_core/logger";
import crypto from "crypto";
import { ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./_core/sdk";

function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
    return hash === verifyHash;
  } catch (e) {
    return false;
  }
}

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
        timeRange: z.enum(["month", "next_month", "3months", "6months", "year", "all"]).optional(),
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
        timeRange: z.enum(["month", "next_month", "3months", "6months", "year", "all"]).optional(),
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
        property: z.enum(["Sadoles", "Hacjenda"]).optional(),
        checkIn: z.coerce.date().optional(),
        checkOut: z.coerce.date().optional(),
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
        notes: z.string().optional(),
        purpose: z.string().optional(),
        companyName: z.string().optional(),
        nip: z.string().optional(),
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
      
      await Logger.bookingAction(id, "manual_edit", "Updated booking details");
      
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
        purpose: z.string().optional(),
        companyName: z.string().optional(),
        nip: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Generate a unique icalUid for manual bookings
      const icalUid = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      let checkIn = input.checkIn;
      let checkOut = input.checkOut;

      if (checkIn.getHours() === 0 && checkIn.getMinutes() === 0) {
        checkIn = setMinutes(setHours(checkIn, 16), 0);
      }
      if (checkOut.getHours() === 0 && checkOut.getMinutes() === 0) {
        checkOut = setMinutes(setHours(checkOut, 10), 0);
      }

      // Normalize decimal fields: convert empty strings to null
      const adults = input.adultsCount ?? 0;
      const children = input.childrenCount ?? 0;
      const calculatedTotal = adults + children;
      const finalGuestCount = calculatedTotal > 0 ? calculatedTotal : (input.guestCount ?? 0);

      const values: any = { ...input, icalUid, checkIn, checkOut, guestCount: finalGuestCount };
      if (values.totalPrice === "") values.totalPrice = null;
      if (values.commission === "") values.commission = null;
      if (values.hostRevenue === "") values.hostRevenue = null;
      if (values.amountPaid === "") values.amountPaid = null;
      if (values.depositAmount === "") values.depositAmount = null;

      const [result] = await db.insert(bookings).values(values);
      const newId = (result as any).insertId;
      
      if (newId) {
        await Logger.bookingAction(newId, "system", "Booking created manually");
      }
      
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

  getActivities: publicProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      return getBookingActivities(input.bookingId);
    }),

  /** Pricing procedures */
  getPricingPlans: publicProcedure
    .input(z.object({ property: z.enum(["Sadoles", "Hacjenda"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      return db.select().from(pricingPlans).where(eq(pricingPlans.property, input.property));
    }),

  getCalendarPricing: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      from: z.coerce.date(),
      to: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const from = new Date(input.from);
      from.setDate(from.getDate() - 2);
      const to = new Date(input.to);
      to.setDate(to.getDate() + 2);

      const assignments = await db
        .select({
          date: sql<string>`DATE_FORMAT(${calendarPricing.date}, '%Y-%m-%d')`,
          planId: calendarPricing.planId,
          planName: pricingPlans.name,
          nightlyPrice: pricingPlans.nightlyPrice,
          minStay: pricingPlans.minStay,
        })
        .from(calendarPricing)
        .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
        .where(
          and(
            eq(calendarPricing.property, input.property),
            gte(calendarPricing.date, from),
            lte(calendarPricing.date, to)
          )
        );
      
      return assignments;
    }),

  getPropertySettings: publicProcedure
    .input(z.object({ property: z.enum(["Sadoles", "Hacjenda"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const result = await db.select().from(propertySettings).where(eq(propertySettings.property, input.property)).limit(1);
      return result[0] || { 
        property: input.property, 
        fixedBookingPrice: 800,
        petFee: 200,
        peopleDiscount: [],
        lastMinuteDiscount: "0.05",
        lastMinuteDays: 14,
        stayDurationDiscounts: []
      };
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
    return getICalFeeds().map((f) => ({
      label: f.label,
      property: f.property,
      channel: f.channel,
    }));
  }),

  status: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(syncStatus);
  }),
});

// ─── Public portal router ───────────────────────────────────────────────────

const publicPortalRouter = router({
  getRatings: publicProcedure
    .input(z.object({ property: z.enum(["Sadoles", "Hacjenda"]) }))
    .query(async ({ input }) => {
      return getPropertyRatings(input.property);
    }),

  logVisit: publicProcedure
    .input(z.object({ page: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return;

      const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
      const today = startOfDay(new Date());

      try {
        await db.insert(portalAnalytics).values({
          date: today,
          page: input.page,
          ipHash,
        }).onDuplicateKeyUpdate({
          set: { createdAt: sql`createdAt` } // Do nothing if already exists
        });
      } catch (err) {
        // Ignore duplicate key errors or other log failures
        console.error("[Analytics] Failed to log visit:", err);
      }
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

  getPricingPlanForDate: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      date: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const dateStr = input.date.toISOString().split("T")[0];

      const plan = await db
        .select({
          minStay: pricingPlans.minStay,
          nightlyPrice: pricingPlans.nightlyPrice,
        })
        .from(calendarPricing)
        .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
        .where(
          and(
            eq(calendarPricing.property, input.property),
            sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") = ${dateStr}`
          )
        )
        .limit(1);

      return plan[0] || { minStay: 1, nightlyPrice: 0 };
    }),

  calculatePrice: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
      guestCount: z.number().optional(),
      animalsCount: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const guestCount = input.guestCount ?? 1;
      const animalsCount = input.animalsCount ?? 0;

      console.log(`[Pricing] Calculating for ${input.property}: ${input.checkIn.toISOString()} to ${input.checkOut.toISOString()} (Guests: ${guestCount}, Pets: ${animalsCount})`);

      // 4 PM is the standard check-in time, 10 AM is the standard check-out time.
      // If check-in is earlier than 4 PM, add one day to the calculation.
      // If check-out is later than 10 AM, add one day to the calculation.
      const isEarlyCheckIn = input.checkIn.getHours() < 16;
      const isLateCheckOut = input.checkOut.getHours() > 10 || (input.checkOut.getHours() === 10 && input.checkOut.getMinutes() > 0);

      const baseDays = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / (1000 * 60 * 60 * 24));
      let pricingDays = baseDays;
      if (isEarlyCheckIn) pricingDays += 1;
      if (isLateCheckOut) pricingDays += 1;

      if (pricingDays <= 0) throw new Error("Check-out must be after check-in");

      // Fetch dynamic settings
      const settingsResult = await db.select().from(propertySettings).where(eq(propertySettings.property, input.property)).limit(1);
      const settings = settingsResult[0];
      if (!settings) throw new Error("Property settings not found");

      // Check availability (double booking prevention)
      // Use the actual selected times for checking overlaps
      const overlapping = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.property, input.property),
            ne(bookings.status, "cancelled"),
            // Overlap exists if:
            // (existing.checkIn < selected.checkOut) AND (existing.checkOut > selected.checkIn)
            // AND we must ensure at least 6h gap for same-day turnover
            sql`${bookings.checkIn} < ${input.checkOut}`,
            sql`${bookings.checkOut} > ${input.checkIn}`
          )
        );

      // Filter out same-day turnover cases that HAVE enough gap (>= 6h)
      // Standard: Check-out 10:00, Check-in 16:00 (6h gap)
      const actualConflicts = overlapping.filter(b => {
        const bIn = new Date(b.checkIn);
        const bOut = new Date(b.checkOut);
        
        // If selected check-out is on the same day as existing check-in
        if (format(input.checkOut, "yyyy-MM-dd") === format(bIn, "yyyy-MM-dd")) {
          const gap = bIn.getTime() - input.checkOut.getTime();
          if (gap >= 6 * 60 * 60 * 1000) return false; // Enough gap
        }
        
        // If selected check-in is on the same day as existing check-out
        if (format(input.checkIn, "yyyy-MM-dd") === format(bOut, "yyyy-MM-dd")) {
          const gap = input.checkIn.getTime() - bOut.getTime();
          if (gap >= 6 * 60 * 60 * 1000) return false; // Enough gap
        }
        
        return true; // Real overlap
      });

      if (actualConflicts.length > 0) {
        return {
          valid: false,
          error: "Selected dates are no longer available",
          days: pricingDays,
          totalPrice: 0,
          currency: "PLN"
        };
      }

      let effectiveCheckIn = new Date(input.checkIn);
      if (isEarlyCheckIn) effectiveCheckIn.setDate(effectiveCheckIn.getDate() - 1);
      
      let effectiveCheckOut = new Date(input.checkOut);
      if (isLateCheckOut) effectiveCheckOut.setDate(effectiveCheckOut.getDate() + 1);

      const effectiveCheckInStr = format(effectiveCheckIn, "yyyy-MM-dd");
      const effectiveCheckOutStr = format(effectiveCheckOut, "yyyy-MM-dd");

      const nights = await db
        .select({
          planName: pricingPlans.name,
          nightlyPrice: pricingPlans.nightlyPrice,
          minStay: pricingPlans.minStay,
          date: calendarPricing.date,
        })
        .from(calendarPricing)
        .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
        .where(
          and(
            eq(calendarPricing.property, input.property),
            sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") >= ${effectiveCheckInStr}`,
            sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") < ${effectiveCheckOutStr}`
          )
        );

      if (nights.length < pricingDays) {
        throw new Error(`Pricing data missing for selected dates (requested ${pricingDays}, found ${nights.length})`);
      }

      // Check min stay (based on actual nights)
      const violatedMinStay = nights.find(n => pricingDays < n.minStay);
      if (violatedMinStay) {
        return {
          valid: false,
          error: `Minimum stay for this period is ${violatedMinStay.minStay} nights`,
          days: pricingDays,
          totalPrice: 0,
          currency: "PLN"
        };
      }

      // Apply guest count discount (multiplier)
      let multiplier = 1.0;
      if (settings.peopleDiscount) {
        const discounts = (typeof settings.peopleDiscount === 'string' 
          ? JSON.parse(settings.peopleDiscount) 
          : settings.peopleDiscount) as Array<{ maxGuests: number, multiplier: number }>;
        
        // Find the first bracket where guestCount <= maxGuests
        const match = [...discounts].sort((a, b) => a.maxGuests - b.maxGuests).find(d => guestCount <= d.maxGuests);
        if (match) multiplier = match.multiplier;
      }

      const nightlySumBase = nights.reduce((sum, n) => sum + n.nightlyPrice * multiplier, 0);

      // Duration discounts
      let durationDiscount = 0;
      if (settings.stayDurationDiscounts) {
        const discounts = (typeof settings.stayDurationDiscounts === 'string'
          ? JSON.parse(settings.stayDurationDiscounts)
          : settings.stayDurationDiscounts) as Array<{ minNights: number, discount: number }>;
        
        // Find the highest minNights where days >= minNights
        const match = [...discounts].sort((a, b) => b.minNights - a.minNights).find(d => pricingDays >= d.minNights);
        if (match) durationDiscount = match.discount;
      }

      // Last minute discount
      const now = new Date();
      const diffMs = input.checkIn.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      let lastMinuteDiscountApplied = 0;
      if (diffDays >= 0 && diffDays <= settings.lastMinuteDays) {
        lastMinuteDiscountApplied = parseFloat(String(settings.lastMinuteDiscount));
      }

      const totalDiscountMultiplier = durationDiscount + lastMinuteDiscountApplied;
      const discountAmount = Math.round(nightlySumBase * totalDiscountMultiplier);
      const nightlySum = nightlySumBase - discountAmount;
      
      const fixedFee = settings.fixedBookingPrice;
      const petFee = animalsCount * settings.petFee;
      
      const totalPrice = Math.round((fixedFee + nightlySum + petFee) / 10) * 10;
      const basePriceNoDiscounts = Math.round((fixedFee + nightlySumBase + petFee) / 10) * 10;

      return {
        valid: true,
        days: pricingDays,
        totalPrice,
        basePrice: basePriceNoDiscounts,
        discountAmount: basePriceNoDiscounts - totalPrice,
        appliedDiscounts: {
          duration: durationDiscount,
          lastMinute: lastMinuteDiscountApplied > 0
        },
        petFee,
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
      animalsCount: z.number().default(0),
      notes: z.string().optional(),
      guestCountry: z.string().optional(),
      purpose: z.string().optional(),
      companyName: z.string().optional(),
      nip: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      let inputCheckIn = input.checkIn;
      let inputCheckOut = input.checkOut;

      if (inputCheckIn.getHours() === 0 && inputCheckIn.getMinutes() === 0) {
        inputCheckIn = setMinutes(setHours(inputCheckIn, 16), 0);
      }
      if (inputCheckOut.getHours() === 0 && inputCheckOut.getMinutes() === 0) {
        inputCheckOut = setMinutes(setHours(inputCheckOut, 10), 0);
      }

      // 4 PM is the standard check-in time, 10 AM is the standard check-out time.
      const isEarlyCheckIn = inputCheckIn.getHours() < 16;
      const isLateCheckOut = inputCheckOut.getHours() > 10 || (inputCheckOut.getHours() === 10 && inputCheckOut.getMinutes() > 0);

      const baseDays = Math.round((inputCheckOut.getTime() - inputCheckIn.getTime()) / (1000 * 60 * 60 * 24));
      let pricingDays = baseDays;
      if (isEarlyCheckIn) pricingDays += 1;
      if (isLateCheckOut) pricingDays += 1;

      if (pricingDays <= 0) throw new Error("Check-out must be after check-in");

      // Double booking prevention check
      const overlapping = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.property, input.property),
            ne(bookings.status, "cancelled"),
            sql`${bookings.checkIn} < ${inputCheckOut}`,
            sql`${bookings.checkOut} > ${inputCheckIn}`
          )
        );

      // Filter out same-day turnover cases that HAVE enough gap (>= 6h)
      const actualConflicts = overlapping.filter(b => {
        const bIn = new Date(b.checkIn);
        const bOut = new Date(b.checkOut);
        
        if (format(inputCheckOut, "yyyy-MM-dd") === format(bIn, "yyyy-MM-dd")) {
          const gap = bIn.getTime() - inputCheckOut.getTime();
          if (gap >= 6 * 60 * 60 * 1000) return false;
        }
        
        if (format(inputCheckIn, "yyyy-MM-dd") === format(bOut, "yyyy-MM-dd")) {
          const gap = inputCheckIn.getTime() - bOut.getTime();
          if (gap >= 6 * 60 * 60 * 1000) return false;
        }
        
        return true;
      });

      if (actualConflicts.length > 0) {
        throw new Error("Selected dates are no longer available");
      }
      
      let effectiveCheckIn = new Date(inputCheckIn);
      if (isEarlyCheckIn) effectiveCheckIn.setDate(effectiveCheckIn.getDate() - 1);
      
      let effectiveCheckOut = new Date(inputCheckOut);
      if (isLateCheckOut) effectiveCheckOut.setDate(effectiveCheckOut.getDate() + 1);

      const effectiveCheckInStr = format(effectiveCheckIn, "yyyy-MM-dd");
      const effectiveCheckOutStr = format(effectiveCheckOut, "yyyy-MM-dd");

      const nights = await db
        .select({
          nightlyPrice: pricingPlans.nightlyPrice,
          minStay: pricingPlans.minStay,
        })
        .from(calendarPricing)
        .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
        .where(
          and(
            eq(calendarPricing.property, input.property),
            sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") >= ${effectiveCheckInStr}`,
            sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d") < ${effectiveCheckOutStr}`
          )
        );

      if (nights.length < pricingDays) throw new Error(`Pricing data missing (${nights.length}/${pricingDays})`);
      if (nights.some(n => pricingDays < n.minStay)) throw new Error("Minimum stay requirement not met");

      const propertySettingsRows = await db.select().from(propertySettings).where(eq(propertySettings.property, input.property)).limit(1);
      const settings = propertySettingsRows[0];
      if (!settings) throw new Error("Property settings not found");

      // Calculate base nightly sum
      let multiplier = 1;
      if (settings.peopleDiscount) {
        const discounts = (typeof settings.peopleDiscount === 'string' 
          ? JSON.parse(settings.peopleDiscount) 
          : settings.peopleDiscount) as Array<{ maxGuests: number, multiplier: number }>;
        const match = [...discounts].sort((a, b) => a.maxGuests - b.maxGuests).find(d => input.guestCount <= d.maxGuests);
        if (match) multiplier = match.multiplier;
      }

      const nightlySumBase = nights.reduce((sum, n) => sum + n.nightlyPrice * multiplier, 0);

      // Duration discounts
      let durationDiscount = 0;
      if (settings.stayDurationDiscounts) {
        const discounts = (typeof settings.stayDurationDiscounts === 'string'
          ? JSON.parse(settings.stayDurationDiscounts)
          : settings.stayDurationDiscounts) as Array<{ minNights: number, discount: number }>;
        const match = [...discounts].sort((a, b) => b.minNights - a.minNights).find(d => pricingDays >= d.minNights);
        if (match) durationDiscount = match.discount;
      }

      // Last minute discount
      const now = new Date();
      const diffMs = input.checkIn.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      let lastMinuteDiscountApplied = 0;
      if (diffDays >= 0 && diffDays <= settings.lastMinuteDays) {
        lastMinuteDiscountApplied = parseFloat(String(settings.lastMinuteDiscount));
      }

      const totalDiscountMultiplier = durationDiscount + lastMinuteDiscountApplied;
      const discountAmount = Math.round(nightlySumBase * totalDiscountMultiplier);
      const nightlySum = nightlySumBase - discountAmount;

      const fixedFee = settings.fixedBookingPrice;
      const petFee = input.animalsCount * settings.petFee;
      const totalPrice = Math.round((fixedFee + nightlySum + petFee) / 10) * 10;

      const icalUid = `portal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const depositAmount = input.purpose === "company" ? 1000 : 500;
      const reservationFee = Math.round((totalPrice * 0.3) / 100) * 100;
// Final insert
const adults = input.adultsCount ?? input.guestCount ?? 0;
const children = input.childrenCount ?? 0;
const totalGuests = (adults + children) > 0 ? (adults + children) : input.guestCount;

const [insertResult] = await db.insert(bookings).values({
  ...input,
  checkIn: inputCheckIn,
  checkOut: inputCheckOut,
  guestCount: totalGuests,
  totalPrice: String(totalPrice),
        hostRevenue: String(totalPrice),
        commission: "0.00",
        status: "pending",
        channel: "direct",
        icalUid,
        depositAmount: String(depositAmount),
        reservationFee: String(reservationFee),
      });

      // Log the creation source
      await Logger.bookingAction(
        insertResult.insertId, 
        "system", 
        "Created via Booking Portal", 
        `Guest: ${input.guestName} (${input.guestEmail}), Purpose: ${input.purpose || 'leisure'}`
      );

      // Send pending email
      try {
        const newBooking = await db.select().from(bookings).where(eq(bookings.id, insertResult.insertId)).limit(1);
        if (newBooking[0]) {
          await sendGuestEmail("booking_pending", newBooking[0]);

          // Notify admin about new portal booking
          const checkInStr = format(new Date(newBooking[0].checkIn), "dd.MM.yyyy");
          const checkOutStr = format(new Date(newBooking[0].checkOut), "dd.MM.yyyy");
          
          await sendAlertEmail(
            `New Portal Booking: ${newBooking[0].property} (${checkInStr})`,
            `A new pending booking has been created via the guest portal.\n\n` +
            `Property: ${newBooking[0].property}\n` +
            `Dates: ${checkInStr} - ${checkOutStr}\n` +
            `Guest: ${newBooking[0].guestName} (${newBooking[0].guestEmail})\n` +
            `Total Price: ${newBooking[0].totalPrice} PLN\n\n` +
            `Please review it in the dashboard.`
          );
        }
      } catch (err) {
        console.error("[Routers] Failed to send pending/admin email:", err);
      }

      return { success: true };
    }),
});

// ─── Pricing router ───────────────────────────────────────────────────────────

const pricingRouter = router({
  getPricing: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      from: z.coerce.date(),
      to: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      return db
        .select({
          id: calendarPricing.id,
          date: sql`DATE_FORMAT(${calendarPricing.date}, "%Y-%m-%d")`,
          planId: calendarPricing.planId,
          planName: pricingPlans.name,
          nightlyPrice: pricingPlans.nightlyPrice,
          minStay: pricingPlans.minStay,
        })
        .from(calendarPricing)
        .innerJoin(pricingPlans, eq(calendarPricing.planId, pricingPlans.id))
        .where(
          and(
            eq(calendarPricing.property, input.property),
            gte(calendarPricing.date, input.from),
            lte(calendarPricing.date, input.to)
          )
        );
    }),

  updatePlan: publicProcedure
    .input(z.object({
      id: z.number(),
      nightlyPrice: z.number(),
      minStay: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("No DB");
      await db.update(pricingPlans)
        .set({
          nightlyPrice: input.nightlyPrice,
          minStay: input.minStay,
        })
        .where(eq(pricingPlans.id, input.id));
      return { success: true };
    }),

  updateSettings: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      fixedBookingPrice: z.number(),
      petFee: z.number(),
      peopleDiscount: z.array(z.object({ maxGuests: z.number(), multiplier: z.number() })),
      lastMinuteDiscount: z.number(),
      lastMinuteDays: z.number(),
      stayDurationDiscounts: z.array(z.object({ minNights: z.number(), discount: z.number() })),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("No DB");
      
      const { property, ...values } = input;
      
      await db.update(propertySettings)
        .set({
          ...values,
          lastMinuteDiscount: String(values.lastMinuteDiscount),
          peopleDiscount: values.peopleDiscount,
          stayDurationDiscounts: values.stayDurationDiscounts,
        })
        .where(eq(propertySettings.property, property));
      
      return { success: true };
    }),
});

// ─── App router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByUsername(input.username);
        
        if (!user || !user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid username or password" });
        }

        const sessionToken = await sdk.createSessionToken(user.username!, {
          name: user.name || user.username!,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return { success: true };
      }),
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
  pricing: pricingRouter,
});

export type AppRouter = typeof appRouter;
