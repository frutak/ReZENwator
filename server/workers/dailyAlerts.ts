/**
 * Daily Alerts and Status Maintenance Worker
 *
 * Runs once a day to:
 * 1. Identify bookings that need attention (stale pending, upcoming unpaid, deposits to return).
 * 2. Transition portal bookings (Airbnb/Booking) to 'paid_to_intermediary' when within 30 days of check-in.
 * 3. Send a consolidated summary email to the owner.
 */

import nodemailer from "nodemailer";
import { and, eq, lte, gte, lt, or, ne, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { format } from "date-fns";

const ALERT_RECIPIENT = "szymonfurtak@hotmail.com";

export async function runDailyMaintenance() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // ─── 1. Automatic status transitions ─────────────────────────────────────────
  // Airbnb/Booking: confirmed -> paid_to_intermediary if checkIn <= 30 days
  const portalBookings = await db
    .select()
    .from(bookings)
    .where(
      and(
        or(eq(bookings.channel, "airbnb"), eq(bookings.channel, "booking")),
        eq(bookings.status, "confirmed"),
        lte(bookings.checkIn, thirtyDaysFromNow)
      )
    );

  for (const b of portalBookings) {
    await db
      .update(bookings)
      .set({ status: "paid_to_intermediary" })
      .where(eq(bookings.id, b.id));
    console.log(`[DailyAlerts] Booking #${b.id} (${b.channel}) transitioned to paid_to_intermediary`);
  }

  // ─── 2. Identify alerts ──────────────────────────────────────────────────────
  
  // Alert 1: Pending > 3 days old
  const stalePending = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "pending"), lt(bookings.createdAt, threeDaysAgo)));

  // Alert 2: Confirmed starting within a week (meaning not yet 'paid' or 'paid_to_intermediary')
  // Note: portal bookings that just transitioned to paid_to_intermediary won't show up here
  const upcomingUnpaid = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        lte(bookings.checkIn, oneWeekFromNow),
        gte(bookings.checkIn, now)
      )
    );

  // Alert 3: Finished with paid deposit
  const depositsToReturn = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "finished"), eq(bookings.depositStatus, "paid")));

  // ─── 3. Send consolidated email ──────────────────────────────────────────────
  
  if (stalePending.length === 0 && upcomingUnpaid.length === 0 && depositsToReturn.length === 0) {
    console.log("[DailyAlerts] No alerts to send today.");
    return;
  }

  await sendConsolidatedAlertEmail({
    stalePending,
    upcomingUnpaid,
    depositsToReturn,
  });
}

async function sendConsolidatedAlertEmail(data: {
  stalePending: any[];
  upcomingUnpaid: any[];
  depositsToReturn: any[];
}) {
  const gmailUser = process.env.GMAIL_USER || "furtka.rentals@gmail.com";
  const gmailPass = process.env.GMAIL_APP_PASSWORD || "";

  if (!gmailPass) {
    console.warn("[DailyAlerts] Gmail credentials not configured, skipping email");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const fmt = (d: Date | string) => format(new Date(d), "dd.MM.yyyy");

  let html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e40af;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">📅 Daily Operational Summary — Rental Manager</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:16px 24px">
  `;

  if (data.stalePending.length > 0) {
    html += `
      <h3 style="color:#9f1239;margin-top:0">⚠️ Stale Pending Bookings (> 3 days)</h3>
      <ul style="font-size:14px">
        ${data.stalePending.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)}) - Created: ${fmt(b.createdAt)}</li>`).join("")}
      </ul>
    `;
  }

  if (data.upcomingUnpaid.length > 0) {
    html += `
      <h3 style="color:#b45309">⏳ Upcoming Unpaid Bookings (starts within 7 days)</h3>
      <ul style="font-size:14px">
        ${data.upcomingUnpaid.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)}) - Channel: ${b.channel}</li>`).join("")}
      </ul>
    `;
  }

  if (data.depositsToReturn.length > 0) {
    html += `
      <h3 style="color:#15803d">💰 Deposits to Process (finished bookings)</h3>
      <ul style="font-size:14px">
        ${data.depositsToReturn.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)})</li>`).join("")}
      </ul>
    `;
  }

  html += `
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />
        <p style="font-size:12px;color:#6b7280">
          Sent automatically by Rental Manager to ${ALERT_RECIPIENT}
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${gmailUser}>`,
      to: ALERT_RECIPIENT,
      subject: `📅 Daily Alerts: ${data.stalePending.length + data.upcomingUnpaid.length + data.depositsToReturn.length} items need attention`,
      html,
    });
    console.log(`[DailyAlerts] Consolidated email sent to ${ALERT_RECIPIENT}`);
  } catch (err) {
    console.error("[DailyAlerts] Failed to send email:", err);
  }
}
