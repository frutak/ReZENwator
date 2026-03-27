/**
 * iCal Polling Service
 *
 * Fetches iCal feeds from all configured channels, parses VEVENT entries,
 * and upserts bookings into the database. Runs on a 30-minute interval.
 */

import ical from "node-ical";
import type { VEvent, ParameterValue } from "node-ical";
import { and, eq, ne, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, syncLogs } from "../../drizzle/schema";
import { ICAL_FEEDS, type ICalFeed } from "./icalConfig";
import { checkAndAlertDoubleBookings } from "./doubleBookingDetector";
import { sendAlertEmail } from "../_core/email";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely extract a string from a ParameterValue (which can be string or object) */
function paramStr(val: ParameterValue | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && "val" in val) return String((val as { val: unknown }).val);
  return String(val);
}

/**
 * Attempts to detect the booking channel from the iCal event summary/description.
 * Falls back to the configured feed channel if detection is inconclusive.
 */
function detectChannel(
  summary: string,
  description: string,
  feedChannel: ICalFeed["channel"]
): ICalFeed["channel"] {
  const text = `${summary} ${description}`.toLowerCase();
  if (text.includes("airbnb")) return "airbnb";
  if (text.includes("booking.com") || text.includes("booking ")) return "booking";
  if (text.includes("slowhop")) return "slowhop";
  if (text.includes("alohacamp")) return "alohacamp";
  return feedChannel;
}

/** Determines the initial deposit status based on channel. */
function initialDepositStatus(
  channel: ICalFeed["channel"]
): "pending" | "not_applicable" {
  if (channel === "airbnb" || channel === "booking") return "not_applicable";
  return "pending";
}

/** Determines the initial booking status based on channel. */
function initialStatus(
  channel: ICalFeed["channel"]
): "pending" | "confirmed" {
  if (channel === "airbnb" || channel === "booking") return "confirmed";
  return "pending";
}

// ─── Core polling function ────────────────────────────────────────────────────

export async function pollICalFeed(feed: ICalFeed): Promise<{
  newBookings: number;
  updatedBookings: number;
  errors: string[];
}> {
  const start = Date.now();
  let newBookings = 0;
  let updatedBookings = 0;
  const errors: string[] = [];

  const db = await getDb();
  if (!db) {
    return { newBookings: 0, updatedBookings: 0, errors: ["Database not available"] };
  }

  const seenUids: string[] = [];

  let events: Awaited<ReturnType<typeof ical.async.fromURL>>;
  try {
    events = await ical.async.fromURL(feed.url);
  } catch (err) {
    const msg = `Failed to fetch iCal from ${feed.label}: ${String(err)}`;
    console.error(`[iCal] ${msg}`);
    errors.push(msg);

    await db.insert(syncLogs).values({
      syncType: "ical",
      source: feed.label,
      newBookings: 0,
      updatedBookings: 0,
      success: "false",
      errorMessage: msg,
      durationMs: Date.now() - start,
    }).catch(() => {});

    return { newBookings: 0, updatedBookings: 0, errors };
  }

  for (const [uid, event] of Object.entries(events)) {
    if (!event || event.type !== "VEVENT") continue;

    const vevent = event as VEvent;
    if (!vevent.start || !vevent.end) continue;

    const checkIn = new Date(vevent.start);
    const checkOut = new Date(vevent.end);

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) continue;
    // Skip events that ended more than 1 year ago (historical cleanup)
    if (checkOut < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)) continue;
    // Skip placeholder blocks more than 363 days ahead (iCal channels block a year forward)
    const maxFutureDate = new Date(Date.now() + 363 * 24 * 60 * 60 * 1000);
    if (checkIn > maxFutureDate) continue;

    // Filter: skip long blocks ending about a year in the future (horizon/seasonal blocks)
    const durationMs = checkOut.getTime() - checkIn.getTime();
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    const daysUntilEnd = (checkOut.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

    if (durationDays > 14 && daysUntilEnd > 330) {
      console.log(`[iCal] Skipped horizon/seasonal block: ${checkIn.toDateString()} → ${checkOut.toDateString()} (${Math.round(durationDays)} days)`);
      continue;
    }

    // Skip Airbnb's automatic preparation blockers:
    // Airbnb blocks "today → tomorrow" (or similar short blocks) to give the host preparation time.
    // These often have summaries like "Airbnb (Not available)".
    const summary = paramStr(vevent.summary);
    const description = paramStr(vevent.description);

    if (feed.channel === "airbnb") {
      const isNotAvailable = summary.toLowerCase().includes("not available");
      const durationMs = checkOut.getTime() - checkIn.getTime();
      const durationDays = durationMs / (1000 * 60 * 60 * 24);
      
      // Filter: short block (<= 1 night) AND either "not available" summary OR starts very soon
      const startsWithin2Days = (checkIn.getTime() - Date.now()) < 2 * 24 * 60 * 60 * 1000;
      
      if (durationDays <= 1.1 && (isNotAvailable || startsWithin2Days)) {
        console.log(`[iCal] Skipped Airbnb system block: ${summary} | ${checkIn.toDateString()} → ${checkOut.toDateString()}`);
        continue;
      }
    }

    const channel = detectChannel(summary, description, feed.channel);
    const status = initialStatus(channel);
    const depositStatus = initialDepositStatus(channel);

    // Use the iCal UID as the primary deduplication key
    const icalUid = uid || `${feed.property}-${feed.channel}-${checkIn.toISOString()}-${checkOut.toISOString()}`;
    seenUids.push(icalUid);

    try {
      // Primary deduplication: by iCal UID
      const existingByUid = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.icalUid, icalUid))
        .limit(1);

      if (existingByUid.length > 0) {
        // Update dates only (do not overwrite guest details or status set by email parser)
        await db
          .update(bookings)
          .set({ checkIn, checkOut, icalSummary: summary.substring(0, 500) })
          .where(eq(bookings.icalUid, icalUid));
        updatedBookings++;
        continue;
      }

      // Secondary deduplication: same property + same date range (ignoring exact time)
      // This catches cross-channel sync (e.g. Booking.com booking appearing in both
      // the Slowhop feed and the Booking.com feed with different UIDs/times)
      
      // Normalize to midnight for comparison
      const checkInDate = new Date(checkIn); checkInDate.setHours(0,0,0,0);
      const checkOutDate = new Date(checkOut); checkOutDate.setHours(0,0,0,0);

      const allBookings = await db
        .select({ id: bookings.id, channel: bookings.channel, checkIn: bookings.checkIn, checkOut: bookings.checkOut })
        .from(bookings)
        .where(eq(bookings.property, feed.property));

      const duplicate = allBookings.find(b => {
        const bIn = new Date(b.checkIn); bIn.setHours(0,0,0,0);
        const bOut = new Date(b.checkOut); bOut.setHours(0,0,0,0);
        return bIn.getTime() === checkInDate.getTime() && bOut.getTime() === checkOutDate.getTime();
      });

      if (duplicate) {
        // A booking for this property+dates already exists from another feed.
        // Prefer the channel-specific UID over a cross-sync UID.
        const existingIsFromOtherFeed = duplicate.channel !== channel;
        if (existingIsFromOtherFeed && (channel === "airbnb" || channel === "booking")) {
          // Upgrade channel attribution to the more authoritative source
          await db
            .update(bookings)
            .set({ channel, icalUid, icalSummary: summary.substring(0, 500), checkIn, checkOut })
            .where(eq(bookings.id, duplicate.id));
          console.log(
            `[iCal] Merged duplicate: ${feed.label} | ${checkIn.toDateString()} → ${checkOut.toDateString()} (upgraded channel from ${duplicate.channel} to ${channel})`
          );
        } else {
          console.log(
            `[iCal] Skipped cross-sync duplicate: ${feed.label} | ${checkIn.toDateString()} → ${checkOut.toDateString()} (already exists as ${duplicate.channel})`
          );
        }
        updatedBookings++;
        continue;
      }

      // No existing booking found — insert as new
      await db.insert(bookings).values({
        icalUid,
        property: feed.property,
        channel,
        checkIn,
        checkOut,
        status,
        depositStatus,
        icalSummary: summary.substring(0, 500),
      });
      newBookings++;
      console.log(
        `[iCal] New booking: ${feed.label} | ${checkIn.toDateString()} → ${checkOut.toDateString()}`
      );
    } catch (err) {
      const msg = `Error processing event ${icalUid.substring(0, 60)}: ${String(err)}`;
      console.error(`[iCal] ${msg}`);
      errors.push(msg);
    }
  }

  // ─── Detect and handle cancellations ───────────────────────────────────────
  try {
    // Find active bookings (not finished or cancelled) that were matched to this feed
    // but were NOT present in the current iCal fetch.
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const missingBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, feed.property),
          eq(bookings.channel, feed.channel),
          ne(bookings.status, "finished"),
          ne(bookings.status, "cancelled"),
          gte(bookings.checkIn, todayStart), // Only consider future/starting-today bookings for auto-cancel
          seenUids.length > 0 ? ne(bookings.icalUid, "manual") : undefined
        )
      );

    for (const b of missingBookings) {
      // If the UID is not in seenUids, it means it's gone from the feed
      if (!seenUids.includes(b.icalUid)) {
        // REFINEMENT: Only auto-cancel if the booking starts AFTER today.
        // If it starts today or in the past, it disappearing from iCal is normal cleanup/housekeeping.
        const checkInDate = new Date(b.checkIn);
        const isFutureBooking = checkInDate > now;
        
        if (isFutureBooking) {
          await db
            .update(bookings)
            .set({ status: "cancelled" })
            .where(eq(bookings.id, b.id));
          
          console.log(`[iCal] Booking #${b.id} marked as CANCELLED (removed from future calendar: ${feed.label})`);
          
          // Notify host
          const checkInStr = new Date(b.checkIn).toLocaleDateString();
          const checkOutStr = new Date(b.checkOut).toLocaleDateString();
          const subject = `❌ Booking CANCELLED: ${b.guestName || "Unknown"} (${b.property})`;
          const text = `
            The following booking has been removed from the ${feed.channel} iCal feed and marked as CANCELLED.
            
            Guest: ${b.guestName || "Unknown"}
            Property: ${b.property}
            Channel: ${b.channel}
            Dates: ${checkInStr} - ${checkOutStr}
            
            The dates are now available for new bookings.
          `.trim();
          
          await sendAlertEmail(subject, text);
        } else {
          console.log(`[iCal] Booking #${b.id} (${b.guestName}) removed from feed but not cancelled (already started/historical)`);
        }
      }
    }
  } catch (err) {
    console.error(`[iCal] Error handling cancellations for ${feed.label}:`, err);
  }

  // Log the sync run
  await db.insert(syncLogs).values({
    syncType: "ical",
    source: feed.label,
    newBookings,
    updatedBookings,
    success: errors.length === 0 ? "true" : "false",
    errorMessage: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
    durationMs: Date.now() - start,
  }).catch((e) => console.error("[iCal] Failed to write sync log:", e));

  return { newBookings, updatedBookings, errors };
}

/**
 * Poll all configured iCal feeds sequentially.
 */
export async function pollAllICalFeeds(): Promise<void> {
  console.log(`[iCal] Starting poll of ${ICAL_FEEDS.length} feeds...`);
  let totalNew = 0;
  let totalUpdated = 0;

  for (const feed of ICAL_FEEDS) {
    try {
      const result = await pollICalFeed(feed);
      totalNew += result.newBookings;
      totalUpdated += result.updatedBookings;
    } catch (err) {
      console.error(`[iCal] Unhandled error for ${feed.label}:`, err);
    }
  }

  // Auto-finish bookings whose checkout date has passed
  await autoFinishBookings();

  // Check for double-bookings and send alert if new conflicts found
  try {
    const conflicts = await checkAndAlertDoubleBookings();
    if (conflicts.length > 0) {
      console.warn(`[iCal] ⚠️  ${conflicts.length} double-booking conflict(s) detected!`);
    }
  } catch (err) {
    console.error("[iCal] Double-booking check failed:", err);
  }

  console.log(`[iCal] Poll complete. New: ${totalNew}, Updated: ${totalUpdated}`);
}

/**
 * Automatically move bookings to 'finished' status when checkout date has passed.
 * Only applies to fully 'paid' bookings. 'portal_paid' or 'confirmed' bookings
 * must be manually moved to 'paid' first (once payment is received).
 */
export async function autoFinishBookings(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  try {
    // Get all fully paid bookings that have ended
    const active = await db
      .select({ id: bookings.id, checkOut: bookings.checkOut, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.status, "paid"));

    for (const b of active) {
      if (b.checkOut < now) {
        await db.update(bookings).set({ status: "finished" }).where(eq(bookings.id, b.id));
        console.log(`[iCal] Booking #${b.id} auto-finished (checkout date passed)`);
      }
    }
  } catch (err) {
    console.error("[iCal] autoFinishBookings error:", err);
  }
}
