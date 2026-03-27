/**
 * Double-Booking Detector
 *
 * After each iCal sync, scans for bookings on the same property that overlap
 * in time. A genuine double-booking is when two *different* bookings (different
 * channels or different guests) occupy the same property on overlapping dates.
 *
 * Cross-channel sync duplicates (same dates, same property, different UIDs from
 * different feeds) are handled by the iCal poller's date-based deduplication.
 * This module handles the case where a real double-booking slips through.
 */

import nodemailer from "nodemailer";
import { and, eq, ne, lt, gt } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import type { Booking } from "../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DoubleBookingConflict = {
  property: string;
  booking1: Pick<Booking, "id" | "channel" | "checkIn" | "checkOut" | "guestName" | "status">;
  booking2: Pick<Booking, "id" | "channel" | "checkIn" | "checkOut" | "guestName" | "status">;
};

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns all pairs of bookings for the same property that have overlapping
 * date ranges, excluding finished bookings.
 */
export async function detectDoubleBookings(): Promise<DoubleBookingConflict[]> {
  const db = await getDb();
  if (!db) return [];

  // Fetch all active (non-finished) bookings
  const active = await db
    .select({
      id: bookings.id,
      property: bookings.property,
      channel: bookings.channel,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guestName: bookings.guestName,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        ne(bookings.status, "finished"),
        ne(bookings.status, "cancelled")
      )
    );

  const conflicts: DoubleBookingConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      // Must be same property
      if (a.property !== b.property) continue;

      // Check date overlap: a.checkIn < b.checkOut AND b.checkIn < a.checkOut
      const aIn = new Date(a.checkIn).getTime();
      const aOut = new Date(a.checkOut).getTime();
      const bIn = new Date(b.checkIn).getTime();
      const bOut = new Date(b.checkOut).getTime();

      if (aIn < bOut && bIn < aOut) {
        const key = [Math.min(a.id, b.id), Math.max(a.id, b.id)].join("-");
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            property: a.property,
            booking1: a,
            booking2: b,
          });
        }
      }
    }
  }

  return conflicts;
}

// ─── Email alert ──────────────────────────────────────────────────────────────

/**
 * Sends a double-booking alert email via Gmail SMTP.
 */
export async function sendDoubleBookingAlert(
  conflicts: DoubleBookingConflict[]
): Promise<void> {
  if (conflicts.length === 0) return;

  const gmailUser = process.env.GMAIL_USER || "furtka.rentals@gmail.com";
  const gmailPass = process.env.GMAIL_APP_PASSWORD || "";
  const alertRecipient = process.env.DOUBLE_BOOKING_ALERT_RECIPIENT || "szymonfurtak@hotmail.com";

  if (!gmailPass) {
    console.warn("[DoubleBooking] Gmail credentials not configured, skipping email alert");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const conflictLines = conflicts
    .map((c, i) => {
      const fmt = (d: Date | string) =>
        new Date(d).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
      return `
Conflict ${i + 1}: ${c.property}
  Booking #${c.booking1.id}: ${c.booking1.channel.toUpperCase()} | ${c.booking1.guestName ?? "Unknown"} | ${fmt(c.booking1.checkIn)} → ${fmt(c.booking1.checkOut)} | Status: ${c.booking1.status}
  Booking #${c.booking2.id}: ${c.booking2.channel.toUpperCase()} | ${c.booking2.guestName ?? "Unknown"} | ${fmt(c.booking2.checkIn)} → ${fmt(c.booking2.checkOut)} | Status: ${c.booking2.status}
      `.trim();
    })
    .join("\n\n");

  const htmlLines = conflicts
    .map((c, i) => {
      const fmt = (d: Date | string) =>
        new Date(d).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
      return `
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;color:#9f1239">${i + 1}</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${c.property}</td>
          <td style="padding:8px;border:1px solid #e2e8f0">#${c.booking1.id} · ${c.booking1.channel} · ${c.booking1.guestName ?? "?"} · ${fmt(c.booking1.checkIn)}–${fmt(c.booking1.checkOut)}</td>
          <td style="padding:8px;border:1px solid #e2e8f0">#${c.booking2.id} · ${c.booking2.channel} · ${c.booking2.guestName ?? "?"} · ${fmt(c.booking2.checkIn)}–${fmt(c.booking2.checkOut)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#9f1239;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">⚠️ Double-Booking Alert — Rental Manager</h2>
      </div>
      <div style="background:#fff7f7;border:1px solid #fca5a5;padding:16px 24px">
        <p style="margin:0 0 12px">
          <strong>${conflicts.length} overlapping booking${conflicts.length > 1 ? "s" : ""} detected.</strong>
          Please review and cancel the incorrect booking immediately.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#fee2e2">
              <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">#</th>
              <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Property</th>
              <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Booking A</th>
              <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Booking B</th>
            </tr>
          </thead>
          <tbody>${htmlLines}</tbody>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#6b7280">
          Sent automatically by Rental Manager · furtka.rentals@gmail.com
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${gmailUser}>`,
      to: alertRecipient,
      subject: `⚠️ DOUBLE BOOKING DETECTED — ${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} on ${conflicts[0].property}`,
      text: `Double-booking alert!\n\n${conflictLines}`,
      html,
    });
    console.log(`[DoubleBooking] Alert email sent for ${conflicts.length} conflict(s) to ${alertRecipient}`);
  } catch (err) {
    console.error("[DoubleBooking] Failed to send alert email:", err);
  }
}

// ─── State tracking (avoid re-alerting the same conflict) ─────────────────────

/** Set of conflict keys already alerted in this process lifetime */
const alertedConflicts = new Set<string>();

function conflictKey(c: DoubleBookingConflict): string {
  return [Math.min(c.booking1.id, c.booking2.id), Math.max(c.booking1.id, c.booking2.id)].join("-");
}

/**
 * Run detection and send alerts only for new conflicts not yet alerted.
 * Returns the full list of current conflicts (for UI display).
 */
export async function checkAndAlertDoubleBookings(): Promise<DoubleBookingConflict[]> {
  const conflicts = await detectDoubleBookings();

  const newConflicts = conflicts.filter((c) => !alertedConflicts.has(conflictKey(c)));

  if (newConflicts.length > 0) {
    console.warn(`[DoubleBooking] ${newConflicts.length} new conflict(s) detected!`);
    await sendDoubleBookingAlert(newConflicts);
    newConflicts.forEach((c) => alertedConflicts.add(conflictKey(c)));
  }

  return conflicts;
}
