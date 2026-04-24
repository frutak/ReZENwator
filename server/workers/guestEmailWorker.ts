import { BookingRepository } from "../repositories/BookingRepository";
import { GuestEmailRepository } from "../repositories/GuestEmailRepository";
import { sendGuestEmail, getRecipientForEmail } from "../_core/email";
import { Logger } from "../_core/logger";
import type { GuestEmailType } from "../_core/email";
import { addDays, isBefore, isAfter, subDays, startOfDay, format } from "date-fns";

export interface GuestEmailSummary {
  sentCount: number;
  failedCount: number;
  details: string[];
}

export async function processGuestEmails(): Promise<GuestEmailSummary> {
  const summary: GuestEmailSummary = { sentCount: 0, failedCount: 0, details: [] };

  console.log("[GuestEmailWorker] Starting guest email processing...");

  // 1. Get all bookings that might need an email
  // We care about confirmed, paid, finished bookings
  const activeBookings = await BookingRepository.findActiveBookingsForEmails();

  const now = new Date();

  for (const booking of activeBookings) {
    try {
      // Skip bookings with missing essential data (name or email)
      // Exception: Airbnb bookings don't have guest email, so we allow them
      const isMissingEssential = !booking.guestName || (!booking.guestEmail && booking.channel !== "airbnb");
      if (isMissingEssential) {
        console.log(`[GuestEmailWorker] Skipping booking #${booking.id} due to missing essential data (Name: ${booking.guestName || "Missing"}, Email: ${booking.guestEmail || "Missing"})`);
        continue;
      }

      const sentEmails = await GuestEmailRepository.findEmailsByBookingId(booking.id);

      const isSent = (type: GuestEmailType) =>
        sentEmails.some((e) => e.emailType === type && e.success === "true");

      const addAction = (type: string, success: boolean, recipient: string) => {
        if (success) {
          summary.sentCount++;
          summary.details.push(`Sent <b>${type}</b> to ${booking.guestName || "Unknown"} (#${booking.id}) [${recipient}]`);
        } else {
          summary.failedCount++;
          summary.details.push(`Failed to send <b>${type}</b> to ${booking.guestName || "Unknown"} (#${booking.id}) [${recipient}]`);
        }
      };

      // --- A. Booking Confirmed ---
      if (!isSent("booking_confirmed")) {
        const checkInDate = new Date(booking.checkIn);
        // Only send confirmation for FUTURE stays and NOT finished ones
        if (isAfter(checkInDate, now) && booking.status !== "finished") {
          const fourWeeksFromNow = addDays(now, 28);
          
          if (isBefore(checkInDate, fourWeeksFromNow)) {
            // Arrival is within 4 weeks, skip confirmation email to avoid "mechanical" feeling
            console.log(`[GuestEmailWorker] Skipping confirmation for booking #${booking.id} (arrival within 4 weeks: ${format(checkInDate, "yyyy-MM-dd")})`);
            
            const recipient = await getRecipientForEmail("booking_confirmed", booking as any);
            await GuestEmailRepository.insertEmailLog({
              bookingId: booking.id,
              emailType: "booking_confirmed",
              recipient,
              success: "true", // Mark as true so we don't try again
              errorMessage: "Skipped: Arrival within 4 weeks",
            });
            
            await Logger.bookingAction(
              booking.id, 
              "email", 
              "Skipped confirmation email", 
              `Arrival date (${format(checkInDate, "dd.MM")}) is within 4 weeks; skipping to avoid redundancy.`
            );
            
            // We don't increment sentCount/details as nothing was actually sent
          } else {
            const { success, recipient } = await sendGuestEmail("booking_confirmed", booking as any);
            await GuestEmailRepository.insertEmailLog({
              bookingId: booking.id,
              emailType: "booking_confirmed",
              recipient,
              success: success ? "true" : "false",
            });
            
            await Logger.bookingAction(booking.id, "email", "Sent confirmation email", success ? "Success" : "Failed");
            
            addAction("booking_confirmed", success, recipient);
          }
        } else {
          console.log(`[GuestEmailWorker] Skipping confirmation for booking #${booking.id} (already arrived or finished)`);
        }
      }

      // --- B. Missing Data Alert ---
      const threeWeeksBefore = subDays(new Date(booking.checkIn), 21);
      const twoWeeksBefore = subDays(new Date(booking.checkIn), 14);

      const isDataMissing = !booking.guestCountry || 
                           !booking.guestName || 
                           (!booking.guestEmail && booking.channel !== "airbnb") ||
                           (!["airbnb", "booking"].includes(booking.channel) && booking.totalPrice === null);

      if (isDataMissing && !isSent("missing_data_alert")) {
        if (isAfter(now, threeWeeksBefore) && isBefore(now, twoWeeksBefore)) {
           const { success, recipient } = await sendGuestEmail("missing_data_alert", booking as any);
           await GuestEmailRepository.insertEmailLog({
             bookingId: booking.id,
             emailType: "missing_data_alert",
             recipient,
             success: success ? "true" : "false",
           });
           
           await Logger.bookingAction(booking.id, "email", "Sent missing data alert", success ? "Success" : "Failed");
           
           addAction("missing_data_alert", success, recipient);
        }
      }

      // --- C. Arrival Reminder ---
      if (booking.reminderSent === 0) {
        if (isAfter(now, twoWeeksBefore) && isBefore(now, new Date(booking.checkIn))) {
          // Calculate early arrival availability
          const checkInDate = startOfDay(new Date(booking.checkIn));
          const blockingBookings = await BookingRepository.findBlockingBookingsForEarlyArrival(booking.property as any, booking.id, checkInDate);
          const isEarlyArrival = blockingBookings.length === 0;

          const { success, recipient } = await sendGuestEmail("arrival_reminder", booking as any, { isEarlyArrival });
          if (success) {
            await BookingRepository.markReminderSent(booking.id);
            await GuestEmailRepository.insertEmailLog({
              bookingId: booking.id,
              emailType: "arrival_reminder",
              recipient,
              success: "true",
            });

            await Logger.bookingAction(booking.id, "email", "Sent arrival reminder email", `Success (Early arrival: ${isEarlyArrival})`);

            addAction("arrival_reminder", true, recipient);
          } else {
            addAction("arrival_reminder", false, recipient);
          }
        }
      }
      // --- D. Stay Finished ---
      if (!isSent("stay_finished") && booking.depositStatus === "returned") {
          const { success, recipient } = await sendGuestEmail("stay_finished", booking as any);
          await GuestEmailRepository.insertEmailLog({
            bookingId: booking.id,
            emailType: "stay_finished",
            recipient,
            success: success ? "true" : "false",
          });
          
          await Logger.bookingAction(booking.id, "email", "Sent post-stay email", success ? "Success" : "Failed");
          
          addAction("stay_finished", success, recipient);
      }
    } catch (err) {
      console.error(`[GuestEmailWorker] Error processing booking #${booking.id}:`, err);
      summary.failedCount++;
      summary.details.push(`Error processing booking #${booking.id}: ${String(err)}`);
    }
  }

  console.log("[GuestEmailWorker] Finished guest email processing.");
  return summary;
}
