import { and, eq, inArray, lt, gte, ne } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, guestEmails } from "../../drizzle/schema";
import { sendGuestEmail } from "../_core/email";
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
      inArray(bookings.status, ["confirmed", "paid", "finished"])
    );

  const now = new Date();

  for (const booking of activeBookings) {
    const sentEmails = await db
      .select()
      .from(guestEmails)
      .where(eq(guestEmails.bookingId, booking.id));

    const isSent = (type: GuestEmailType) =>
      sentEmails.some((e) => e.emailType === type && e.success === "true");

    const addAction = (type: string, success: boolean) => {
      if (success) {
        summary.sentCount++;
        summary.details.push(`Sent <b>${type}</b> to ${booking.guestName || "Unknown"} (#${booking.id})`);
      } else {
        summary.failedCount++;
        summary.details.push(`Failed to send <b>${type}</b> to ${booking.guestName || "Unknown"} (#${booking.id})`);
      }
    };

    // --- A. Booking Confirmed ---
    if (!isSent("booking_confirmed")) {
      const success = await sendGuestEmail("booking_confirmed", booking);
      await db.insert(guestEmails).values({
        bookingId: booking.id,
        emailType: "booking_confirmed",
        recipient: "szymonfurtak@hotmail.com",
        success: success ? "true" : "false",
      });
      addAction("booking_confirmed", success);
    }

    // --- B. Missing Data Alert ---
    const threeWeeksBefore = subDays(new Date(booking.checkIn), 21);
    const twoWeeksBefore = subDays(new Date(booking.checkIn), 14);

    const isDataMissing = !booking.guestCountry || 
                         !booking.guestName || 
                         (!["airbnb", "booking"].includes(booking.channel) && booking.totalPrice === null);

    if (isDataMissing && !isSent("missing_data_alert")) {
      if (isAfter(now, threeWeeksBefore) && isBefore(now, twoWeeksBefore)) {
         const success = await sendGuestEmail("missing_data_alert", booking);
         await db.insert(guestEmails).values({
           bookingId: booking.id,
           emailType: "missing_data_alert",
           recipient: "szymonfurtak@hotmail.com",
           success: success ? "true" : "false",
         });
         addAction("missing_data_alert", success);
      }
    }

    // --- C. Arrival Reminder ---
    if (!isDataMissing && booking.reminderSent === 0) {
      if (isAfter(now, twoWeeksBefore) && isBefore(now, new Date(booking.checkIn))) {
        // Calculate early arrival availability for Sadoleś
        let isEarlyArrival = true;
        if (booking.property === "Sadoles") {
          const checkInDate = startOfDay(new Date(booking.checkIn));
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
          
          if (blockingBookings.length > 0) {
            isEarlyArrival = false;
          }
        }

        const success = await sendGuestEmail("arrival_reminder", booking, { isEarlyArrival });
        if (success) {
          await db.update(bookings).set({ reminderSent: 1 }).where(eq(bookings.id, booking.id));
          await db.insert(guestEmails).values({
            bookingId: booking.id,
            emailType: "arrival_reminder",
            recipient: "szymonfurtak@hotmail.com",
            success: "true",
          });
          addAction("arrival_reminder", true);
        } else {
          addAction("arrival_reminder", false);
        }
      }
    }

    // --- D. Stay Finished ---
    if (!isSent("stay_finished") && booking.depositStatus === "returned") {
        const success = await sendGuestEmail("stay_finished", booking);
        await db.insert(guestEmails).values({
          bookingId: booking.id,
          emailType: "stay_finished",
          recipient: "szymonfurtak@hotmail.com",
          success: success ? "true" : "false",
        });
        addAction("stay_finished", success);
    }
  }

  console.log("[GuestEmailWorker] Finished guest email processing.");
  return summary;
}

