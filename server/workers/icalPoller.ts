/**
 * iCal Polling Service
 *
 * Fetches iCal feeds from all configured channels, parses VEVENT entries,
 * and upserts bookings into the database. Runs on a 30-minute interval.
 */

import ical from "node-ical";
import type { VEvent, ParameterValue } from "node-ical";
import { and, eq, ne, inArray, gte } from "drizzle-orm";
import { setHours, setMinutes } from "date-fns";
import axios from "axios";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { getICalFeeds, type ICalFeed } from "./icalConfig";
import { checkAndAlertDoubleBookings } from "./doubleBookingDetector";
import { sendAlertEmail } from "../_core/email";
import { Logger } from "../_core/logger";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Robust fetch with retry and timeout using axios */
async function fetchWithRetry(url: string, retries = 2, timeout = 15000): Promise<string> {
  let lastError: Error | unknown;
  
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.get(url, { 
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/calendar, text/plain, */*'
        }
      });
      return response.data;
    } catch (err) {
      lastError = err;
      if (i < retries) {
        const waitTime = Math.pow(2, i) * 1000;
        console.warn(`[iCal] Fetch failed (attempt ${i + 1}/${retries + 1}), retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

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
export function initialDepositStatus(
  channel: ICalFeed["channel"]
): "pending" | "not_applicable" {
  if (channel === "airbnb" || channel === "booking") return "not_applicable";
  return "pending";
}

/** Determines the initial booking status based on channel. */
export function initialStatus(
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

  let events: Awaited<ReturnType<typeof ical.async.parseICS>>;
  try {
    const data = await fetchWithRetry(feed.url);
    events = await ical.async.parseICS(data);
  } catch (err) {
    const msg = `Failed to fetch/parse iCal from ${feed.label}: ${String(err)}`;
    console.error(`[iCal] ${msg}`);
    errors.push(msg);

    await Logger.system("ical", {
      source: feed.label,
      success: false,
      errorMessage: msg,
      durationMs: Date.now() - start,
    });

    return { newBookings: 0, updatedBookings: 0, errors };
  }
  for (const [uid, event] of Object.entries(events)) {
    if (!event || event.type !== "VEVENT") continue;

    const vevent = event as VEvent;
    if (!vevent.start || !vevent.end) continue;

    let checkIn = new Date(vevent.start);
    let checkOut = new Date(vevent.end);

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) continue;

    // Set default times if not present (iCal dates are often just YYYYMMDD)
    if (checkIn.getHours() === 0 && checkIn.getMinutes() === 0) {
      checkIn = setMinutes(setHours(checkIn, 16), 0);
    }
    if (checkOut.getHours() === 0 && checkOut.getMinutes() === 0) {
      checkOut = setMinutes(setHours(checkOut, 10), 0);
    }
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
        const existing = await db
          .select({ id: bookings.id, checkIn: bookings.checkIn, checkOut: bookings.checkOut, icalSummary: bookings.icalSummary })
          .from(bookings)
          .where(eq(bookings.icalUid, icalUid))
          .limit(1);
        
        const b = existing[0]!;
        const normalizedSummary = summary.substring(0, 500);
        
        // Compare values to avoid redundant updates/logs
        const datesChanged = b.checkIn.getTime() !== checkIn.getTime() || b.checkOut.getTime() !== checkOut.getTime();
        const summaryChanged = b.icalSummary !== normalizedSummary;

        if (datesChanged || summaryChanged) {
          await db
            .update(bookings)
            .set({ checkIn, checkOut, icalSummary: normalizedSummary })
            .where(eq(bookings.icalUid, icalUid));
          
          const changeDetail = datesChanged ? `Dates updated: ${checkIn.toLocaleDateString()} - ${checkOut.toLocaleDateString()}` : "Summary updated";
          await Logger.bookingAction(b.id, "enrichment", changeDetail, `Feed: ${feed.label}`);
          updatedBookings++;
        }
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
      const [insertResult] = await db.insert(bookings).values({
        icalUid,
        property: feed.property,
        channel,
        checkIn,
        checkOut,
        status,
        depositStatus,
        icalSummary: summary.substring(0, 500),
      });
      
      const newBookingId = (insertResult as any).insertId;
      if (newBookingId) {
        await Logger.bookingAction(newBookingId, "system", "Created via iCal sync", `Feed: ${feed.label}`);
      }

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

  // Log successful sync for this specific feed
  if (errors.length === 0) {
    await Logger.system("ical", {
      source: feed.label,
      success: true,
      newBookings,
      updatedBookings,
      durationMs: Date.now() - start,
    });
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
          
          await Logger.bookingAction(b.id, "status_change", "Marked as CANCELLED", `Reason: Removed from ${feed.label} iCal feed`);
          
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

  return { newBookings, updatedBookings, errors };
}

/**
 * Poll all configured iCal feeds sequentially.
 */
export async function pollAllICalFeeds(): Promise<void> {
  const allFeeds = getICalFeeds();
  const activeFeeds = allFeeds.filter(f => !!f.url);
  console.log(`[iCal] Starting poll of ${activeFeeds.length} feeds (out of ${allFeeds.length} total)...`);
  const start = Date.now();
  let totalNew = 0;
  let totalUpdated = 0;
  const allErrors: string[] = [];

  try {
    for (const feed of activeFeeds) {
      try {
        const result = await pollICalFeed(feed);
        totalNew += result.newBookings;
        totalUpdated += result.updatedBookings;
        if (result.errors.length > 0) {
          allErrors.push(`${feed.label}: ${result.errors[0]}`);
        }
      } catch (err) {
        console.error(`[iCal] Unhandled error for ${feed.label}:`, err);
        allErrors.push(`${feed.label}: Unhandled error`);
      }
    }

    // Log the consolidated sync run
    await Logger.system("ical", {
      source: "All iCal Feeds",
      newBookings: totalNew,
      updatedBookings: totalUpdated,
      success: allErrors.length === 0,
      errorMessage: allErrors.length > 0 ? allErrors.slice(0, 3).join("; ") : null,
      durationMs: Date.now() - start,
    });

    // Check for double-bookings and send alert if new conflicts found
    try {
      const conflicts = await checkAndAlertDoubleBookings();
      if (conflicts.length > 0) {
        console.warn(`[iCal] ⚠️  ${conflicts.length} double-booking conflict(s) detected!`);
      }
    } catch (err) {
      console.error("[iCal] Double-booking check failed:", err);
    }
  } catch (fatalErr) {
    console.error("[iCal] Fatal error during pollAllICalFeeds:", fatalErr);
    
    // Log the failure to the database
    await Logger.system("ical", {
      source: "All iCal Feeds (Fatal)",
      success: false,
      errorMessage: String(fatalErr).slice(0, 500),
      durationMs: Date.now() - start,
    });

    // Send email alert to host
    await sendAlertEmail(
      "⚠️ FATAL ERROR: iCal Sync Job Failed",
      `The background iCal synchronization job encountered a fatal error and could not complete.\n\nError details: ${String(fatalErr)}\n\nTime: ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}`
    );
  }

  console.log(`[iCal] Poll complete. New: ${totalNew}, Updated: ${totalUpdated}`);
}
