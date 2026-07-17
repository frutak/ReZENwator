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
import { ExpenseRepository } from "./repositories/ExpenseRepository";
import { TRPCError } from "@trpc/server";
import { pollAllICalFeeds, pollICalFeed } from "./workers/icalPoller";
import { pollEmails } from "./workers/emailPoller";
import { findMatchingBookings, applyTransferMatch, revertTransferMatch } from "./workers/bookingMatcher";
import { updateAllPropertyRatings } from "./workers/ratingScraper";
import { PricingAuditor } from "./workers/pricingAuditor";
import { PricingAuditRepository } from "./repositories/PricingAuditRepository";
import { sendGuestEmail, sendAlertEmail } from "./_core/email";
import { detectDoubleBookings } from "./workers/doubleBookingDetector";
import { getICalFeeds } from "./workers/icalConfig";
import { Logger } from "./_core/logger";
import { PricingService } from "./services/PricingService";
import { BookingService } from "./services/BookingService";
import { BankTransferRepository, CASHFLOW_START_MONTH } from "./repositories/BankTransferRepository";
import { MatchingEngine } from "./services/MatchingEngine";
import { MonthlyAdjustmentRepository } from "./repositories/MonthlyAdjustmentRepository";
import { type ParsedBankData } from "./workers/emailParsers";
import { PROPERTIES, CHANNELS, STATUSES, DEPOSIT_STATUSES, CLEANING_STAFF } from "@shared/config";
import { 
  bookingFilterSchema, 
  updateBookingDetailsSchema, 
  createBookingSchema, 
  submitBookingSchema, 
  calculatePriceSchema 
} from "@shared/schema";
import crypto from "crypto";
import { ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./_core/sdk";

const AIRBNB_CUTOFF = new Date("2024-04-01");

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
    .input(bookingFilterSchema.optional())
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
        timeRange: z.enum(["month", "next_month", "3months", "6months", "year", "all", "previous_month"]).optional(),
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
    .input(updateBookingDetailsSchema)
    .mutation(async ({ input }) => {
      const { id, ...details } = input;
      return BookingService.updateBookingDetails(id, details);
    }),

  create: publicProcedure
    .input(createBookingSchema)
    .mutation(async ({ input }) => {
      return BookingService.createManualBooking(input);
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

  analytics: publicProcedure
    .input(
      z.object({
        property: z.enum(PROPERTIES).optional(),
        channel: z.enum(CHANNELS).optional(),
        year: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return BookingRepository.getAnalytics(input ?? {});
    }),

  /**
   * Cash-based analytics grouped by when money moved, not by check-in.
   *
   * Returns two things per month (from CASHFLOW_START_MONTH onward):
   *   - cashIn: matched bank transfers received that month.
   *   - freeCashflow: cashIn minus the cash that went out that month —
   *       utilities and purchases by their payment date, plus the cleaning
   *       COMPUTED for the PREVIOUS month's stays (the cleaner is paid the
   *       month after the guests leave).
   *
   * Cleaning is not stored anywhere; it is derived per booking by
   * getAnalytics (which attributes it to the check-in month), so here we take
   * month M-1's cleaning figure. Expenses carry no channel, so a channel
   * filter narrows cashIn and cleaning but not utilities/purchases.
   */
  cashflow: publicProcedure
    .input(
      z.object({
        property: z.enum(PROPERTIES).optional(),
        channel: z.enum(CHANNELS).optional(),
        year: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const filters = input ?? {};
      const year = filters.year ?? new Date().getFullYear();

      const [inflow, expensesPaid, analytics] = await Promise.all([
        BankTransferRepository.getMonthlyCashflow(filters),
        ExpenseRepository.getMonthlyPaidByType({ property: filters.property, year }),
        BookingRepository.getAnalytics(filters),
      ]);

      // Cleaning by check-in month (from existing analytics logic).
      const cleaningByMonth = new Map<string, number>();
      for (const m of analytics.monthlyData) {
        cleaningByMonth.set(m.month, Number(m.cleaningCosts) || 0);
      }
      // A January row needs the prior December's cleaning, which the current
      // year's analytics doesn't cover — fetch it only when actually needed.
      if (inflow.some((r) => r.month.endsWith("-01"))) {
        const prev = await BookingRepository.getAnalytics({ ...filters, year: year - 1 });
        for (const m of prev.monthlyData) cleaningByMonth.set(m.month, Number(m.cleaningCosts) || 0);
      }

      const expenseByMonth = new Map(expensesPaid.map((e) => [e.month, e]));
      const prevMonthKey = (month: string) => {
        const [y, m] = month.split("-").map(Number);
        const d = new Date(y, m - 2, 1); // m is 1-based; m-2 => previous month
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      };

      const monthlyData = inflow.map((row) => {
        const exp = expenseByMonth.get(row.month);
        const utilitiesPaid = exp?.utilities ?? 0;
        const purchasesPaid = exp?.purchases ?? 0;
        const cleaningPrev = cleaningByMonth.get(prevMonthKey(row.month)) ?? 0;
        const freeCashflow = row.total - utilitiesPaid - purchasesPaid - cleaningPrev;
        return {
          month: row.month,
          total: row.total,
          count: row.count,
          utilitiesPaid,
          purchasesPaid,
          cleaningPrev,
          freeCashflow,
        };
      });

      return { monthlyData, startMonth: CASHFLOW_START_MONTH };
    }),

  getMonthlyAdjustments: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      year: z.number(),
    }))
    .query(async ({ input }) => {
      return MonthlyAdjustmentRepository.getAdjustments(input);
    }),

  updateMonthlyAdjustment: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      month: z.string(), // "YYYY-MM"
      amount: z.string(),
      category: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return MonthlyAdjustmentRepository.upsertAdjustment(input);
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
          amount: input.transferAmount ?? 0,
          currency: "PLN",
          senderName: input.transferSender ?? "",
          transferTitle: input.transferTitle ?? "",
          transferDate: input.transferDate ?? new Date(),
          accountNumber: "",
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

      const [taxBookings, airbnbCreated] = await Promise.all([
        BookingRepository.getTaxReportData(startDate, endDate),
        BookingRepository.getAirbnbBookingsCreatedInRange(startDate, endDate)
      ]);

      console.log(`[TaxReport] Found ${taxBookings.length} raw tax bookings and ${airbnbCreated.length} airbnb created bookings`);

      const currentMonthStr = format(startDate, "yyyy-MM");

      // Filter and map bookings based on the "earliest month" rule
      const mappedTaxBookings = taxBookings
        .filter(b => {
          const checkInMonth = format(new Date(b.checkIn), "yyyy-MM");
          const effectiveMonth = (b.invoiceIssued === 1 && b.invoiceMonth)
            ? (b.invoiceMonth < checkInMonth ? b.invoiceMonth : checkInMonth)
            : checkInMonth;
          
          return effectiveMonth === currentMonthStr;
        })
        .map(b => {
          const isNewAirbnbRule = b.channel === "airbnb" && new Date(b.createdAt) >= AIRBNB_CUTOFF;
          
          return {
            guestName: b.guestName || "Unknown",
            channel: b.channel,
            property: b.property,
            checkIn: b.checkIn,
            totalPrice: parseFloat(String(b.totalPrice || "0")),
            hostRevenue: parseFloat(String(b.hostRevenue || "0")),
            invoiceIssued: b.invoiceIssued === 1,
            invoiceMonth: b.invoiceMonth,
            taxableValue: (b.channel === "airbnb" && !isNewAirbnbRule)
              ? parseFloat(String(b.hostRevenue || "0"))
              : parseFloat(String(b.totalPrice || "0"))
          };
        });

      const mappedAirbnbCreated = airbnbCreated.map(b => ({
        guestName: b.guestName || "Unknown",
        property: b.property,
        createdAt: b.createdAt,
        checkIn: b.checkIn,
        totalPrice: parseFloat(String(b.totalPrice || "0")),
        commission: parseFloat(String(b.commission || "0")),
        hostRevenue: parseFloat(String(b.hostRevenue || "0"))
      }));

      return {
        taxBookings: mappedTaxBookings,
        airbnbCreatedInMonth: mappedAirbnbCreated
      };
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
    .input(calculatePriceSchema)
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
    .input(submitBookingSchema)
    .mutation(async ({ input }) => {
      return BookingService.createBooking(input as any); // using 'any' safely since Zod schema is strictly matching
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


// ─── Transfer router ──────────────────────────────────────────────────────────

const transferRouter = router({
  listPending: publicProcedure
    .query(async () => {
      return BankTransferRepository.getTransfersByStatus('pending');
    }),

  listMatched: publicProcedure
    .query(async () => {
      return BankTransferRepository.getMatchedTransfers();
    }),

  getMatches: publicProcedure
    .input(z.object({ transferId: z.number() }))
    .query(async ({ input }) => {
      const transfer = await BankTransferRepository.getTransferById(input.transferId);
      if (!transfer) throw new Error('Transfer not found');
      
      const parsed: ParsedBankData = {
        amount: parseFloat(transfer.amount),
        currency: transfer.currency,
        senderName: transfer.senderName,
        transferTitle: transfer.transferTitle,
        transferDate: transfer.transferDate,
        accountNumber: transfer.accountNumber ?? '',
      };

      const windowStart = new Date(transfer.transferDate);
      windowStart.setFullYear(windowStart.getFullYear() - 1);
      const windowEnd = new Date(transfer.transferDate);
      windowEnd.setFullYear(windowEnd.getFullYear() + 1);
      
      const tTitle = transfer.transferTitle.toUpperCase();
      const tSender = transfer.senderName.toUpperCase();
      
      const isAirbnbPayout = tTitle.includes('AIRBNB') || tSender.includes('PAYONEER') || tSender.includes('AIRBNB');
      const isBookingPayout = tTitle.includes('BOOKING.COM') || tSender.includes('BOOKING.COM') || tTitle.includes('BOOKING') || tSender.includes('BOOKING');
      const isPortalPayout = isAirbnbPayout || isBookingPayout;

      let candidates: any[] = [];
      if (isPortalPayout) {
         candidates = await BookingRepository.findPortalPayoutCandidates(isAirbnbPayout ? 'airbnb' : 'booking', windowStart, windowEnd);
      } else {
         candidates = await BookingRepository.findDirectTransferCandidates(windowStart, windowEnd);
      }

      return MatchingEngine.scoreCandidates(parsed, candidates as any, !!isPortalPayout);
    }),

  manualMatch: publicProcedure
    .input(z.object({ transferId: z.number(), bookingId: z.number() }))
    .mutation(async ({ input }) => {
      const transfer = await BankTransferRepository.getTransferById(input.transferId);
      if (!transfer) throw new Error('Transfer not found');

      // If already matched, revert the previous booking's payment
      if (transfer.status === 'matched' && transfer.matchedBookingId) {
        await revertTransferMatch(transfer.matchedBookingId, parseFloat(transfer.amount));
      }

      const parsed: ParsedBankData = {
        amount: parseFloat(transfer.amount),
        currency: transfer.currency,
        senderName: transfer.senderName,
        transferTitle: transfer.transferTitle,
        transferDate: transfer.transferDate,
        accountNumber: transfer.accountNumber ?? '',
      };

      await applyTransferMatch(input.bookingId, parsed, 100);
      await BankTransferRepository.updateTransferStatus(input.transferId, 'matched', input.bookingId);

      return { success: true };
    }),
  markIrrelevant: publicProcedure
    .input(z.object({ transferId: z.number() }))
    .mutation(async ({ input }) => {
      await BankTransferRepository.updateTransferStatus(input.transferId, 'ignored');
      return { success: true };
    }),
});

const expenseRouter = router({
  list: publicProcedure
    .input(z.object({ 
      property: z.enum(PROPERTIES).optional(),
      type: z.enum(["utility", "purchase"]).optional(),
      year: z.number().optional()
    }).optional())
    .query(async ({ input }) => {
      return ExpenseRepository.getExpenses(input ?? {});
    }),

  add: publicProcedure
    .input(z.object({
      property: z.enum(PROPERTIES),
      type: z.enum(["utility", "purchase"]),
      category: z.string(),
      amount: z.string(),
      paymentDate: z.coerce.date(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return ExpenseRepository.insertExpense({
        ...input,
        amount: input.amount,
      });
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      property: z.enum(PROPERTIES),
      type: z.enum(["utility", "purchase"]),
      category: z.string(),
      amount: z.string(),
      paymentDate: z.coerce.date(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...values } = input;
      return ExpenseRepository.updateExpense(id, values);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ExpenseRepository.deleteExpense(input.id);
      return { success: true };
    }),
});

export const appRouter = router({
  expenses: expenseRouter,
  transfers: transferRouter,
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
