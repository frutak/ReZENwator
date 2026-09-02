import { BookingRepository } from "../repositories/BookingRepository";
import { BankTransferRepository, transferContentKey } from "../repositories/BankTransferRepository";
import { PricingService } from "./PricingService";
import { Logger } from "../_core/logger";
import { getDb, type DbExecutor } from "../db";
import { sendGuestEmail, sendAlertEmail } from "../_core/email";
import { format } from "date-fns";
import { type Property } from "@shared/config";
import { normalizeBookingDates, calculateTotalGuests, normalizeDecimalFields } from "@shared/utils";

export interface RefundParams {
  bookingId: number;
  /** The refunded sum, as a positive figure. */
  amount: number;
  /** When the money left the account. Defaults to now. */
  refundDate?: Date;
  /** Free text, kept on the transfer row and in the activity log. */
  reason?: string;
}

/** Money is stored to the grosz; every figure written back is rounded to it. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CreateBookingParams {
  property: Property;
  checkIn: Date;
  checkOut: Date;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  guestCount: number;
  animalsCount: number;
  notes?: string;
  guestCountry?: string;
  purpose?: string;
  companyName?: string;
  nip?: string;
  adultsCount?: number;
  childrenCount?: number;
}

export class BookingService {
  /**
   * Submits a new booking after validating dates and calculating the final price.
   */
  static async createBooking(params: CreateBookingParams) {
    const { checkIn, checkOut } = normalizeBookingDates(params.checkIn, params.checkOut);

    // Use PricingService for availability and price calculation
    const pricing = await PricingService.calculatePrice({
      property: params.property,
      checkIn,
      checkOut,
      guestCount: params.guestCount,
      animalsCount: params.animalsCount
    });

    if (!pricing.valid) {
      throw new Error(pricing.error || "Selected dates are no longer available");
    }

    const icalUid = `portal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const depositAmount = params.purpose === "company" ? 1000 : 500;
    const reservationFee = Math.round((pricing.totalPrice * 0.3) / 100) * 100;

    const totalGuests = calculateTotalGuests(params.guestCount, params.adultsCount, params.childrenCount);

    const [insertResult] = await BookingRepository.insertBooking({
      ...params,
      checkIn,
      checkOut,
      guestCount: totalGuests,
      totalPrice: String(pricing.totalPrice),
      hostRevenue: String(pricing.totalPrice),
      commission: "0.00",
      status: "pending",
      channel: "direct",
      icalUid,
      depositAmount: String(depositAmount),
      reservationFee: String(reservationFee),
    });

    const bookingId = (insertResult as any).insertId;

    // Log the creation source
    await Logger.bookingAction(
      bookingId, 
      "system", 
      "Created via Booking Portal", 
      `Guest: ${params.guestName} (${params.guestEmail}), Purpose: ${params.purpose || 'leisure'}`
    );

    // Send notifications
    try {
      const newBooking = await BookingRepository.getBookingById(bookingId);
      if (newBooking) {
        console.log(`[BookingService] Sending booking_pending email for #${bookingId} to ${newBooking.guestEmail}`);
        const emailRes = await sendGuestEmail("booking_pending", newBooking as any);
        console.log(`[BookingService] Guest email result for #${bookingId}:`, emailRes);

        // Notify admin about new portal booking
        const checkInStr = format(new Date(newBooking.checkIn), "dd.MM.yyyy");
        const checkOutStr = format(new Date(newBooking.checkOut), "dd.MM.yyyy");
        
        await sendAlertEmail(
          `New Portal Booking: ${newBooking.property} (${checkInStr})`,
          `A new pending booking has been created via the guest portal.\n\n` +
          `Property: ${newBooking.property}\n` +
          `Dates: ${checkInStr} - ${checkOutStr}\n` +
          `Guest: ${newBooking.guestName} (${newBooking.guestEmail})\n` +
          `Total Price: ${newBooking.totalPrice} PLN\n\n` +
          `Please review it in the dashboard.`
        );
      }
    } catch (err) {
      console.error("[BookingService] Failed to send pending/admin email:", err);
    }

    return { success: true, bookingId };
  }

  /**
   * Creates a booking manually from the dashboard without enforcing pricing/availability checks.
   */
  static async createManualBooking(input: any) {
    const icalUid = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const { checkIn, checkOut } = normalizeBookingDates(input.checkIn, input.checkOut);
    const finalGuestCount = calculateTotalGuests(input.guestCount, input.adultsCount, input.childrenCount);

    const values = normalizeDecimalFields({ 
      ...input, 
      icalUid, 
      checkIn, 
      checkOut, 
      guestCount: finalGuestCount 
    });

    const [result] = await BookingRepository.insertBooking(values);
    const newId = (result as any).insertId;
    
    if (newId) {
      await Logger.bookingAction(newId, "system", "Booking created manually");
    }
    
    return { success: true, bookingId: newId };
  }

  /**
   * Updates an existing booking's details.
   */
  static async updateBookingDetails(id: number, details: any) {
    console.log(`[updateDetails] Updating booking #${id}:`, JSON.stringify(details));

    const normalizedDetails = normalizeDecimalFields(details);
    await BookingRepository.updateBookingDetails(id, normalizedDetails);
    await Logger.bookingAction(id, "manual_edit", "Updated booking details");
    
    return { success: true };
  }

  /**
   * Pays part of a settled booking back to the guest.
   *
   * A price cut after the fact is two events, not one: the stay is worth less,
   * *and* money left the account. Editing the price by hand only records the
   * first, and the second then shows up as a reconciliation finding — the
   * booking claims to have received less than the transfers matched to it add
   * up to. That is precisely the gap this closes, in one step:
   *
   *   totalPrice  −= amount   the stay is worth less
   *   hostRevenue  = totalPrice − commission   (the modal's own rule)
   *   amountPaid  −= amount   the guest is not holding that money any more
   *   bank_transfers += one row of −amount, matched to this booking
   *
   * Both sides of `amountPaid − (Σ transfers − returned kaucja)` move by the
   * same amount, so a booking that reconciled before still reconciles after.
   * The negative row also reaches the cashflow view, which reads transfers, so
   * the month the refund was paid is a month of lower inflow rather than an
   * unexplained one.
   *
   * The kaucja is *not* touched. It comes back to the guest through
   * `depositStatus`, which the reconciliation query already subtracts; adding it
   * here as well would take it off the booking twice. A refund made in the same
   * bank transfer as the kaucja return is still recorded as its own row — the
   * two are separate obligations that happened to travel together.
   *
   * The transfer row is written first and is the idempotency gate: its content
   * key makes a repeat of the same refund (same booking, day, amount and reason)
   * collide, and the price cut is rolled back with it. Without that, a
   * double-click discounts the stay twice.
   */
  static async refundToGuest(params: RefundParams) {
    const amount = round2(params.amount);
    if (!(amount > 0)) throw new Error("Refund amount must be greater than zero");

    const booking = await BookingRepository.getBookingById(params.bookingId);
    if (!booking) throw new Error("Booking not found");

    const totalPrice = parseFloat(String(booking.totalPrice ?? "0"));
    const commission = parseFloat(String(booking.commission ?? "0"));
    const amountPaid = parseFloat(String(booking.amountPaid ?? "0"));

    if (!(totalPrice > 0)) {
      throw new Error("Booking has no price to refund from");
    }
    // A cent of slack: these are decimals read back as floats.
    if (amount > totalPrice + 0.005) {
      throw new Error(`Refund of ${amount.toFixed(2)} exceeds the price of ${totalPrice.toFixed(2)}`);
    }
    // Refunding more than ever arrived is not a refund. A price cut before the
    // guest has paid is an edit of the price, with no money moving and so no
    // transfer to record.
    if (amount > amountPaid + 0.005) {
      throw new Error(`Refund of ${amount.toFixed(2)} exceeds the ${amountPaid.toFixed(2)} received on this booking`);
    }

    const refundDate = params.refundDate ?? new Date();
    const reason = params.reason?.trim();
    const newTotalPrice = round2(totalPrice - amount);
    const newAmountPaid = round2(amountPaid - amount);
    const newHostRevenue = round2(newTotalPrice - commission);

    const transferRow = {
      // Negative: the money went the other way. Everything that sums transfers
      // — reconciliation, cashflow — then subtracts it without a special case.
      amount: String((-amount).toFixed(2)),
      currency: booking.currency ?? "PLN",
      senderName: booking.guestName || "Gość",
      transferTitle: reason ? `Zwrot: ${reason}` : `Zwrot części ceny (#${params.bookingId})`,
      transferDate: refundDate,
      accountNumber: "",
    };
    const contentKey = transferContentKey(transferRow);

    const insert = {
      ...transferRow,
      externalId: `refund-${contentKey.slice(0, 32)}`,
      contentKey,
      source: "manual" as const,
      // Already attributed: a refund is raised against one booking by name, so
      // it never passes through the pending queue waiting to be matched.
      status: "matched" as const,
      matchedBookingId: params.bookingId,
    };

    const bookingUpdate = {
      totalPrice: newTotalPrice.toFixed(2),
      hostRevenue: newHostRevenue.toFixed(2),
      amountPaid: newAmountPaid.toFixed(2),
    };

    const writes = async (tx?: DbExecutor) => {
      const { inserted, duplicateOf } = await BankTransferRepository.insertTransfer(insert, tx);
      if (!inserted) {
        return { duplicate: true as const, duplicateOfTransferId: duplicateOf?.id ?? null };
      }
      await BookingRepository.updateBookingDetails(params.bookingId, bookingUpdate, tx);
      return { duplicate: false as const, duplicateOfTransferId: null };
    };

    const db = await getDb();
    let outcome: { duplicate: boolean; duplicateOfTransferId: number | null };

    if (db) {
      let result!: { duplicate: boolean; duplicateOfTransferId: number | null };
      await db.transaction(async (tx: DbExecutor) => {
        result = await writes(tx);
        // Nothing was written, so there is nothing to roll back — returning
        // normally keeps the duplicate an answer rather than an error.
      });
      outcome = result;
    } else {
      // No DB configured (dev) — best-effort, non-transactional.
      outcome = await writes();
    }

    if (outcome.duplicate) {
      return {
        success: false as const,
        duplicate: true as const,
        duplicateOfTransferId: outcome.duplicateOfTransferId,
      };
    }

    // Post-commit: an activity entry must not describe a write a rollback erased.
    await Logger.bookingAction(
      params.bookingId,
      "manual_edit",
      `Refunded ${amount.toFixed(2)} ${booking.currency ?? "PLN"} to guest`,
      `${reason ? `${reason}. ` : ""}Price ${totalPrice.toFixed(2)} → ${newTotalPrice.toFixed(2)}, ` +
        `paid ${amountPaid.toFixed(2)} → ${newAmountPaid.toFixed(2)}, ` +
        `recorded as an outgoing transfer on ${format(refundDate, "yyyy-MM-dd")}`
    );

    return {
      success: true as const,
      duplicate: false as const,
      totalPrice: bookingUpdate.totalPrice,
      hostRevenue: bookingUpdate.hostRevenue,
      amountPaid: bookingUpdate.amountPaid,
    };
  }
}
