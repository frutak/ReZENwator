import { BookingRepository } from "../repositories/BookingRepository";
import { PricingService } from "./PricingService";
import { Logger } from "../_core/logger";
import { sendGuestEmail, sendAlertEmail } from "../_core/email";
import { format } from "date-fns";
import { type Property } from "@shared/config";
import { normalizeBookingDates, calculateTotalGuests, normalizeDecimalFields } from "@shared/utils";

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
}
