import { and, eq, inArray, lt, gte, ne } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, guestEmails } from "../../drizzle/schema";
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
  const db = await getDb();
  const summary: GuestEmailSummary = { sentCount: 0, failedCount: 0, details: [] };
  if (!db) return summary;

  console.log("[GuestEmailWorker] Starting guest email processing...");

  // 1. Get all bookings that might need an email
  // We care about confirmed, paid, finished bookings
  const activeBookings = await db
    .select()
    .from(bookings)
    .where(
      inArray(bookings.status, ["confirmed", "portal_paid", "paid", "finished"])
    );

  const now = new Date();

  for (const booking of activeBookings) {
    try {
      const sentEmails = await db
        .select()
        .from(guestEmails)
        .where(eq(guestEmails.bookingId, booking.id));

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
            
            const recipient = await getRecipientForEmail("booking_confirmed", booking);
            await db.insert(guestEmails).values({
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
            const { success, recipient } = await sendGuestEmail("booking_confirmed", booking);
            await db.insert(guestEmails).values({
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
                           (!["airbnb", "booking"].includes(booking.channel) && booking.totalPrice === null);

      if (isDataMissing && !isSent("missing_data_alert")) {
        if (isAfter(now, threeWeeksBefore) && isBefore(now, twoWeeksBefore)) {
           const { success, recipient } = await sendGuestEmail("missing_data_alert", booking);
           await db.insert(guestEmails).values({
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
          let isEarlyArrival = true;
          const checkInDate = startOfDay(new Date(booking.checkIn));

          if (booking.property === "Sadoles") {
            const prevDay = subDays(checkInDate, 1);
            const blockingBookings = await db
              .select()
              .from(bookings)
              .where(
                and(
                  eq(bookings.property, "Sadoles"),
                  ne(bookings.id, booking.id),
                  inArray(bookings.checkOut, [checkInDate, prevDay])
                )
              );
            if (blockingBookings.length > 0) isEarlyArrival = false;
          } else if (booking.property === "Hacjenda") {
            const blockingBookings = await db
              .select()
              .from(bookings)
              .where(
                and(
                  eq(bookings.property, "Hacjenda"),
                  ne(bookings.id, booking.id),
                  eq(bookings.checkOut, checkInDate)
                )
              );
            if (blockingBookings.length > 0) isEarlyArrival = false;
          }

          const { success, recipient } = await sendGuestEmail("arrival_reminder", booking, { isEarlyArrival });
          if (success) {
            await db.update(bookings).set({ reminderSent: 1 }).where(eq(bookings.id, booking.id));
            await db.insert(guestEmails).values({
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
          const { success, recipient } = await sendGuestEmail("stay_finished", booking);
          await db.insert(guestEmails).values({
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
