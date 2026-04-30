import { BookingRepository } from "../repositories/BookingRepository";
import { sendAlertEmail } from "../_core/email";
import { format, isSameDay, startOfDay, addDays } from "date-fns";
import { type Property } from "@shared/config";

export class CleaningService {
  /**
   * Checks if a booking's dates conflict with any existing scheduled cleaning for the same property.
   * A conflict occurs if the gap on the scheduled cleaning date is less than 5 hours.
   */
  static async checkCleaningConflicts(property: Property, checkIn: Date, checkOut: Date, skipBookingId?: number) {
    console.log(`[CleaningService] Checking conflicts for ${property}: ${checkIn.toISOString()} - ${checkOut.toISOString()} (Skip ID: ${skipBookingId})`);
    
    // Fetch all bookings for this property (not just confirmed)
    const dbBookings = await BookingRepository.getBookings({
      property,
      limit: 1000, 
    });

    // Scheduled cleanings to check: all bookings that have a cleaningDate
    const scheduledCleanings = dbBookings.filter(b => b.cleaningDate && b.status !== "cancelled");
    
    console.log(`[CleaningService] Found ${scheduledCleanings.length} scheduled cleanings to check.`);

    for (const cleaningBooking of scheduledCleanings) {
      const cDate = new Date(cleaningBooking.cleaningDate!);
      const dStart = startOfDay(cDate);
      const dEnd = addDays(dStart, 1);
      const cleaningDateStr = format(cDate, "dd.MM.yyyy");

      // A booking affects a cleaning date if its interval [checkIn, checkOut] overlaps with the cleaning day [dStart, dEnd]
      const bookingOverlapsDay = checkIn < dEnd && checkOut > dStart;

      if (bookingOverlapsDay) {
        // Find all bookings that touch this day
        const dayBookings = dbBookings
          .filter(b => b.property === property && b.status !== "cancelled")
          .map(b => {
            // Use the NEW dates for the booking being updated
            if (b.id === skipBookingId) {
              return { ...b, checkIn, checkOut };
            }
            return b;
          })
          .filter(b => (new Date(b.checkIn) < dEnd && new Date(b.checkOut) > dStart));

        // If skipBookingId wasn't in dbBookings (new booking), add it manually
        const isNewBooking = skipBookingId && !dbBookings.find(b => b.id === skipBookingId);
        if (isNewBooking || !skipBookingId) {
           dayBookings.push({ property, checkIn, checkOut, status: "confirmed" } as any);
        }

        // Check for "Stay Through" (a booking that covers the whole 24h)
        const staysThrough = dayBookings.find(b => 
          new Date(b.checkIn) < dStart && new Date(b.checkOut) > dEnd
        );

        let available = true;
        let gapHours = 24;

        if (staysThrough) {
          available = false;
          gapHours = 0;
          console.log(`[CleaningService] Conflict: Stay-through booking found on ${cleaningDateStr}`);
        } else {
          // Find latest checkout and earliest checkin on this specific day
          const checkoutsToday = dayBookings.filter(b => isSameDay(new Date(b.checkOut), cDate));
          const checkinsToday = dayBookings.filter(b => isSameDay(new Date(b.checkIn), cDate));

          const latestCheckout = checkoutsToday.length > 0 
            ? new Date(Math.max(...checkoutsToday.map(b => new Date(b.checkOut).getTime())))
            : dStart;
            
          const earliestCheckin = checkinsToday.length > 0
            ? new Date(Math.min(...checkinsToday.map(b => new Date(b.checkIn).getTime())))
            : dEnd;

          gapHours = (earliestCheckin.getTime() - latestCheckout.getTime()) / (1000 * 60 * 60);
          console.log(`[CleaningService] Gap on ${cleaningDateStr}: ${gapHours.toFixed(2)}h (Latest out: ${latestCheckout.toISOString()}, Earliest in: ${earliestCheckin.toISOString()})`);
          if (gapHours < 5) available = false;
        }

        if (!available) {
          // Conflict detected!
          await this.sendConflictAlert(cleaningBooking, property, checkIn, checkOut, gapHours);
        }
      }
    }
  }

  private static async sendConflictAlert(
    cleaningBooking: any, 
    newProperty: string, 
    newCheckIn: Date, 
    newCheckOut: Date,
    remainingGap: number
  ) {
    const cleaningDateStr = format(new Date(cleaningBooking.cleaningDate!), "dd.MM.yyyy");
    const newInStr = format(newCheckIn, "dd.MM.yyyy HH:mm");
    const newOutStr = format(newCheckOut, "dd.MM.yyyy HH:mm");

    const subject = `⚠️ Konflikt sprzątania: ${newProperty} (${cleaningDateStr})`;
    const text = `
      Wykryto konflikt z zaplanowanym sprzątaniem!
      
      Zaplanowane sprzątanie:
      - Data: ${cleaningDateStr}
      - Dla rezerwacji gościa: ${cleaningBooking.guestName || "Nieznany"} (Przyjazd: ${format(new Date(cleaningBooking.checkIn), "dd.MM")})
      
      Nowa/Zmieniona rezerwacja:
      - Obiekt: ${newProperty}
      - Daty: ${newInStr} - ${newOutStr}
      
      Pozostałe okno czasowe na sprzątanie w dniu ${cleaningDateStr}: ${remainingGap.toFixed(1)}h.
      Wymagane minimum to 5h.
      
      Proszę sprawdź grafik sprzątania w panelu administratora.
    `.trim();

    await sendAlertEmail(subject, text);
    console.log(`[CleaningService] Conflict alert sent for ${newProperty} on ${cleaningDateStr}`);
  }
}
