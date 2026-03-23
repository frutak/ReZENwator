/**
 * iCal Polling Service
 *
 * Fetches iCal feeds from all configured channels, parses VEVENT entries,
 * and upserts bookings into the database. Runs on a 30-minute interval.
 */

import ical from "node-ical";
import type { VEvent, ParameterValue } from "node-ical";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, syncLogs } from "../../drizzle/schema";
import { ICAL_FEEDS, type ICalFeed } from "./icalConfig";
import { checkAndAlertDoubleBookings } from "./doubleBookingDetector";

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

    // Skip Airbnb's automatic 1-day preparation blocker:
    // Airbnb always blocks "today → tomorrow" to give the host preparation time.
    // This is a system block, not a real booking, so we hide it.
    if (feed.channel === "airbnb") {
      const durationMs = checkOut.getTime() - checkIn.getTime();
      const durationDays = durationMs / (1000 * 60 * 60 * 24);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const checkInDay = new Date(checkIn);
      checkInDay.setHours(0, 0, 0, 0);
      // Filter: exactly 1 night AND check-in is today
      if (durationDays <= 1 && checkInDay.getTime() === today.getTime()) {
        console.log(`[iCal] Skipped Airbnb preparation blocker: ${checkIn.toDateString()} → ${checkOut.toDateString()}`);
        continue;
      }
    }

    const summary = paramStr(vevent.summary);
    const description = paramStr(vevent.description);

    const channel = detectChannel(summary, description, feed.channel);
    const status = initialStatus(channel);
    const depositStatus = initialDepositStatus(channel);

    // Use the iCal UID as the primary deduplication key
    const icalUid = uid || `${feed.property}-${feed.channel}-${checkIn.toISOString()}-${checkOut.toISOString()}`;

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

      // Secondary deduplication: same property + exact same check-in + check-out
      // This catches cross-channel sync (e.g. Booking.com booking appearing in both
      // the Slowhop feed and the Booking.com feed with different UIDs)
      const existingByDates = await db
        .select({ id: bookings.id, channel: bookings.channel, icalUid: bookings.icalUid })
        .from(bookings)
        .where(
          and(
            eq(bookings.property, feed.property),
            eq(bookings.checkIn, checkIn),
            eq(bookings.checkOut, checkOut)
          )
        )
        .limit(1);

      if (existingByDates.length > 0) {
        // A booking for this property+dates already exists from another feed.
        // Prefer the channel-specific UID over a cross-sync UID.
        // Update the channel if the existing one is from a different (less authoritative) feed.
        const existing = existingByDates[0];
        const existingIsFromOtherFeed = existing.channel !== channel;
        if (existingIsFromOtherFeed && (channel === "airbnb" || channel === "booking")) {
          // Upgrade channel attribution to the more authoritative source
          await db
            .update(bookings)
            .set({ channel, icalUid, icalSummary: summary.substring(0, 500) })
            .where(eq(bookings.id, existing.id));
          console.log(
            `[iCal] Merged duplicate: ${feed.label} | ${checkIn.toDateString()} → ${checkOut.toDateString()} (upgraded channel from ${existing.channel} to ${channel})`
          );
        } else {
          console.log(
            `[iCal] Skipped cross-sync duplicate: ${feed.label} | ${checkIn.toDateString()} → ${checkOut.toDateString()} (already exists as ${existing.channel})`
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
 */
export async function autoFinishBookings(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  try {
    // Get all non-finished bookings
    const active = await db
      .select({ id: bookings.id, checkOut: bookings.checkOut, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.status, "paid"));

    for (const b of active) {
      if (b.checkOut < now) {
        await db.update(bookings).set({ status: "finished" }).where(eq(bookings.id, b.id));
      }
    }

    const confirmed = await db
      .select({ id: bookings.id, checkOut: bookings.checkOut })
      .from(bookings)
      .where(eq(bookings.status, "confirmed"));

    for (const b of confirmed) {
      if (b.checkOut < now) {
        await db.update(bookings).set({ status: "finished" }).where(eq(bookings.id, b.id));
      }
    }
  } catch (err) {
    console.error("[iCal] autoFinishBookings error:", err);
  }
}
