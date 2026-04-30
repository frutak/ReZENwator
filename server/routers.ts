import { z } from "zod";
import { format, setHours, setMinutes, startOfDay, addMonths, addDays } from "date-fns";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { BookingRepository } from "./repositories/BookingRepository";
import { UserRepository } from "./repositories/UserRepository";
import { PropertyRepository } from "./repositories/PropertyRepository";
import { SyncRepository } from "./repositories/SyncRepository";
import { PortalRepository } from "./repositories/PortalRepository";
import { TRPCError } from "@trpc/server";
import { pollAllICalFeeds, pollICalFeed } from "./workers/icalPoller";
import { pollEmails } from "./workers/emailPoller";
import { findMatchingBookings, applyTransferMatch } from "./workers/bookingMatcher";
import { updateAllPropertyRatings } from "./workers/ratingScraper";
import { PricingAuditor } from "./workers/pricingAuditor";
import { PricingAuditRepository } from "./repositories/PricingAuditRepository";
import { sendGuestEmail, sendAlertEmail } from "./_core/email";
import { detectDoubleBookings } from "./workers/doubleBookingDetector";
import { getICalFeeds } from "./workers/icalConfig";
import { Logger } from "./_core/logger";
import { PricingService } from "./services/PricingService";
import { BookingService } from "./services/BookingService";
import { PROPERTIES, CHANNELS, STATUSES, DEPOSIT_STATUSES, CLEANING_STAFF } from "@shared/config";
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
        property: z.enum(PROPERTIES).optional(),
        channel: z.enum(CHANNELS).optional(),
        status: z.enum(STATUSES).optional(),
        depositStatus: z.enum(DEPOSIT_STATUSES).optional(),
        checkInFrom: z.coerce.date().optional(),
        checkInTo: z.coerce.date().optional(),
        timeRange: z.enum(["month", "next_month", "3months", "6months", "year", "all"]).optional(),
        limit: z.number().min(1).max(500).default(200),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      return BookingRepository.getBookings(input ?? {});
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return BookingRepository.getBookingById(input.id);
    }),

  stats: publicProcedure
    .input(
      z.object({
        property: z.enum(PROPERTIES).optional(),
        channel: z.enum(CHANNELS).optional(),
        status: z.array(z.enum(STATUSES)).optional(),
        timeRange: z.enum(["month", "next_month", "3months", "6months", "year", "all"]).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return BookingRepository.getBookingStats(input ?? {});
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(STATUSES),
      })
    )
    .mutation(async ({ input }) => {
      await BookingRepository.updateBookingStatus(input.id, input.status);
      return { success: true };
    }),

  updateDeposit: publicProcedure
    .input(
      z.object({
        id: z.number(),
        depositStatus: z.enum(DEPOSIT_STATUSES),
      })
    )
    .mutation(async ({ input }) => {
      await BookingRepository.updateDepositStatus(input.id, input.depositStatus);
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
      await BookingRepository.updateBookingNotes(input.id, input.notes);
      return { success: true };
    }),

  updateDetails: publicProcedure
    .input(
      z.object({
        id: z.number(),
        property: z.enum(PROPERTIES).optional(),
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
        depositStatus: z.enum(DEPOSIT_STATUSES).optional(),
        channel: z.enum(CHANNELS).optional(),
        status: z.enum(STATUSES).optional(),
        notes: z.string().optional(),
        purpose: z.string().optional(),
        companyName: z.string().optional(),
        nip: z.string().optional(),
        cleaningDate: z.coerce.date().optional(),
        cleaningStaff: z.enum(CLEANING_STAFF).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...details } = input;
      console.log(`[updateDetails] Updating booking #${id}:`, JSON.stringify(details));

      // Normalize decimal fields: convert empty strings to null
      const normalizedDetails: any = { ...details };
      if (normalizedDetails.totalPrice === "") normalizedDetails.totalPrice = null;
      if (normalizedDetails.commission === "") normalizedDetails.commission = null;
      if (normalizedDetails.hostRevenue === "") normalizedDetails.hostRevenue = null;
      if (normalizedDetails.amountPaid === "") normalizedDetails.amountPaid = null;
      if (normalizedDetails.depositAmount === "") normalizedDetails.depositAmount = null;

      await BookingRepository.updateBookingDetails(id, normalizedDetails);
      
      await Logger.bookingAction(id, "manual_edit", "Updated booking details");
      
      return { success: true };
    }),

  create: publicProcedure
    .input(
      z.object({
        property: z.enum(PROPERTIES),
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
        depositStatus: z.enum(DEPOSIT_STATUSES).default("pending"),
        channel: z.enum(CHANNELS).default("direct"),
        status: z.enum(STATUSES).default("confirmed"),
        notes: z.string().optional(),
        purpose: z.string().optional(),
        companyName: z.string().optional(),
        nip: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
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

      const [result] = await BookingRepository.insertBooking(values);
      const newId = (result as any).insertId;
      
      if (newId) {
        await Logger.bookingAction(newId, "system", "Booking created manually");
      }
      
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await BookingRepository.deleteBooking(input.id);
      return { success: true };
    }),

  getActivities: publicProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      return BookingRepository.getBookingActivities(input.bookingId);
    }),

  /** Pricing procedures */
  getPricingPlans: publicProcedure
    .input(z.object({ property: z.enum(PROPERTIES) }))
    .query(async ({ input }) => {
      return PropertyRepository.getPricingPlans(input.property);
    }),

  getCalendarPricing: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      from: z.coerce.date(),
      to: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const from = new Date(input.from);
      from.setDate(from.getDate() - 2);
      const to = new Date(input.to);
      to.setDate(to.getDate() + 2);

      return PropertyRepository.getCalendarPricing(input.property, from, to);
    }),

  getPropertySettings: publicProcedure
    .input(z.object({ property: z.enum(PROPERTIES) }))
    .query(async ({ input }) => {
      const result = await PropertyRepository.getPropertySettings(input.property);
      return result || { 
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

      // Use UTC dates to avoid timezone shifts
      const startDate = new Date(Date.UTC(input.year, input.month - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(input.year, input.month, 0, 23, 59, 59));
      console.log(`[TaxReport] Date range: ${startDate.toISOString()} - ${endDate.toISOString()}`);

      const results = await BookingRepository.getTaxReportData(startDate, endDate);
      console.log(`[TaxReport] Found ${results.length} results`);

      return results.map(b => ({
        guestName: b.guestName || "Unknown",
        channel: b.channel,
        property: b.property,
        checkIn: b.checkIn,
        totalPrice: parseFloat(String(b.totalPrice || "0")),
        hostRevenue: parseFloat(String(b.hostRevenue || "0")),
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
    return { 
      success: result.errors.length === 0, 
      newBookings: result.newBookings, 
      updatedBookings: result.updatedBookings,
      errors: result.errors
    };
  }),

  triggerEmail: publicProcedure.mutation(async () => {
    const result = await pollEmails();
    return {
      success: true,
      processed: result.processed,
      added: result.added,
      enriched: result.enriched,
      matched: result.matched,
      errors: result.errors,
    };
  }),

  triggerRatings: publicProcedure.mutation(async () => {
    await updateAllPropertyRatings();
    return { success: true };
  }),

  lastRun: publicProcedure.query(async () => {
    const [icalLast, emailLast] = await Promise.all([
      SyncRepository.getLastSyncTime("ical"),
      SyncRepository.getLastSyncTime("email"),
    ]);

    // For ratings, it uses 'ical' type with 'Rating Scraper' source
    const logs = await SyncRepository.getRecentSyncLogs(100);
    const ratingsLast = logs.find(l => l.source === "Rating Scraper" && l.success === "true")?.createdAt ?? null;

    return { ical: icalLast, email: emailLast, ratings: ratingsLast };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      return SyncRepository.getRecentSyncLogs(input?.limit ?? 20);
    }),

  feeds: publicProcedure.query(() => {
    return getICalFeeds().map((f) => ({
      label: f.label,
      property: f.property,
      channel: f.channel,
    }));
  }),

  status: publicProcedure.query(async () => {
    return SyncRepository.getSyncStatus();
  }),
});

// ─── Public portal router ───────────────────────────────────────────────────

const publicPortalRouter = router({
  getRatings: publicProcedure
    .input(z.object({ property: z.enum(PROPERTIES) }))
    .query(async ({ input }) => {
      return PropertyRepository.getPropertyRatings(input.property);
    }),

  logVisit: publicProcedure
    .input(z.object({ page: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
      const today = startOfDay(new Date());

      try {
        await PortalRepository.logVisit(input.page, ipHash, today);
      } catch (err) {
        // Ignore duplicate key errors or other log failures
        console.error("[Analytics] Failed to log visit:", err);
      }
    }),

  getAvailability: publicProcedure
    .input(z.object({ property: z.enum(PROPERTIES) }))
    .query(async ({ input }) => {
      return BookingRepository.getAvailability(input.property);
    }),

  getPricingPlanForDate: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      date: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return PropertyRepository.getPricingPlanForDate(input.property, input.date);
    }),

  calculatePrice: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
      guestCount: z.number().optional(),
      animalsCount: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return PricingService.calculatePrice({
        property: input.property,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guestCount: input.guestCount ?? 1,
        animalsCount: input.animalsCount ?? 0,
      });
    }),

  submitBooking: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
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
      return BookingService.createBooking(input);
    }),
});

// ─── Pricing router ───────────────────────────────────────────────────────────

const pricingRouter = router({
  getPricing: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      from: z.coerce.date(),
      to: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return PropertyRepository.getCalendarPricing(input.property, input.from, input.to);
    }),

  updatePlan: publicProcedure
    .input(z.object({
      id: z.number(),
      nightlyPrice: z.number(),
      minStay: z.number(),
    }))
    .mutation(async ({ input }) => {
      await PropertyRepository.updatePricingPlan(input.id, {
          nightlyPrice: input.nightlyPrice,
          minStay: input.minStay,
        });
      return { success: true };
    }),

  updateSettings: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      fixedBookingPrice: z.number(),
      petFee: z.number(),
      peopleDiscount: z.array(z.object({ maxGuests: z.number(), multiplier: z.number() })),
      lastMinuteDiscount: z.number(),
      lastMinuteDays: z.number(),
      stayDurationDiscounts: z.array(z.object({ minNights: z.number(), discount: z.number() })),
    }))
    .mutation(async ({ input }) => {
      const { property, ...values } = input;
      
      await PropertyRepository.updatePropertySettings(property, {
          ...values,
          lastMinuteDiscount: String(values.lastMinuteDiscount),
          peopleDiscount: values.peopleDiscount,
          stayDurationDiscounts: values.stayDurationDiscounts,
        });
      
      return { success: true };
    }),
});

// ─── Pricing audit router ───────────────────────────────────────────────────

const pricingAuditRouter = router({
  getAudits: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      from: z.coerce.date(),
      to: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      const audits = await PricingAuditRepository.getAudits(input.property, input.from, input.to);

      const enrichedAudits = await Promise.all(audits.map(async (audit: any) => {
        try {
          const checkIn = new Date(audit.checkIn);
          const checkOut = new Date(audit.checkOut);
          
          const pricing = await PricingService.getAuditPricing(input.property, checkIn, checkOut);
          const { benchmarkPrice, portalPrice, offset: offsetPrice } = pricing;

          // Deviation calculation
          const deviations: Record<string, number> = {};
          const triggers: number[] = [];
          const channels = ["booking", "airbnb", "slowhop", "alohacamp"] as const;

          for (const channel of channels) {
            const price = audit[`${channel}Price` as keyof typeof audit] as string | null;
            const status = audit[`${channel}Status` as keyof typeof audit] as string | null;

            if (price && status === "OK") {
              const pPrice = parseFloat(price);
              const rawDeviation = (pPrice - benchmarkPrice) / benchmarkPrice;
              const absDeviation = Math.abs(rawDeviation);
              
              deviations[channel] = absDeviation;

              // AlohaCamp constraint relaxation: only downside (lower price) matters for the red/green trigger.
              if (channel === "alohacamp") {
                if (rawDeviation < -0.05) {
                  triggers.push(absDeviation);
                } else {
                  triggers.push(0);
                }
              } else {
                triggers.push(absDeviation);
              }
            }
          }

          const maxDeviation = triggers.length > 0 
            ? Math.max(...triggers) 
            : 0;

          return {
            ...audit,
            internalPrice: benchmarkPrice,
            portalPrice,
            offsetPrice,
            internalValid: true,
            deviations,
            maxDeviation,
          };
        } catch (e) {
          return { ...audit, internalValid: false, internalError: (e as Error).message, deviations: {}, maxDeviation: 0 };
        }
      }));

      return enrichedAudits;
    }),

  trigger: publicProcedure.mutation(async () => {
    if (PricingAuditor.getIsRunning()) {
      throw new Error("Audit already in progress");
    }
    // Run in background to avoid UI timeout (takes ~10-15 minutes)
    PricingAuditor.runDailyAudit().catch(err => {
      console.error("[PricingAuditor] Triggered audit failed:", err);
    });
    return { success: true };
  }),

  triggerManual: publicProcedure
    .input(z.object({
      property: z.enum(["Sadoles", "Hacjenda"]),
      checkIn: z.date(),
      checkOut: z.date(),
    }))
    .mutation(async ({ input }) => {
      // Validate preconditions synchronously (awaited)
      await PricingAuditor.checkPreconditions(input.property, input.checkIn, input.checkOut);

      // Once validated, run in background but return immediately
      PricingAuditor.runManualAudit(input.property, input.checkIn, input.checkOut).catch(err => {
        console.error("[PricingAuditor] Manual audit failed:", err);
      });
      return { success: true };
    }),
});

// ─── User router ───────────────────────────────────────────────────────────────

const userRouter = router({
  updateLanguage: publicProcedure
    .input(z.object({ language: z.enum(["PL", "EN"]) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not logged in" });
      }
      await UserRepository.updateUserLanguage(ctx.user.id, input.language);
      return { success: true };
    }),
});

// ─── App router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  user: userRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const user = await UserRepository.getUserByUsername(input.username);
        
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
  pricingAudit: pricingAuditRouter,
});

export type AppRouter = typeof appRouter;
