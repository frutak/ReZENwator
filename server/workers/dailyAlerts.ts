import { and, eq, lte, gte, lt } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { format } from "date-fns";
import { getTransporter, GMAIL_USER } from "../_core/email";
import { processGuestEmails, GuestEmailSummary } from "./guestEmailWorker";

const ALERT_RECIPIENT = "szymonfurtak@hotmail.com";

export async function runDailyMaintenance() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const transitions: string[] = [];

  // ─── 1. Automatic status transitions ─────────────────────────────────────────
  const portalBookings = await db
    .select()
    .from(bookings)
    .where(
      and(
        lte(bookings.checkIn, thirtyDaysFromNow),
        eq(bookings.status, "confirmed")
      )
    );

  const toTransition = portalBookings.filter(b => ["airbnb", "booking"].includes(b.channel));

  for (const b of toTransition) {
    await db
      .update(bookings)
      .set({ status: "portal_paid" })
      .where(eq(bookings.id, b.id));
    transitions.push(`Booking #${b.id} (${b.channel}) transitioned to <b>portal_paid</b>`);
  }

  // ─── 2. Guest Email Processing ──────────────────────────────────────────────
  const guestEmailSummary = await processGuestEmails();

  // ─── 3. Identify alerts ──────────────────────────────────────────────────────
  const stalePending = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "pending"), lt(bookings.createdAt, threeDaysAgo)));

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

  const depositsToReturn = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "finished"), eq(bookings.depositStatus, "paid")));

  // ─── 4. Send consolidated email ──────────────────────────────────────────────
  
  const hasActions = transitions.length > 0 || guestEmailSummary.details.length > 0;
  const hasAlerts = stalePending.length > 0 || upcomingUnpaid.length > 0 || depositsToReturn.length > 0;

  if (!hasActions && !hasAlerts) {
    console.log("[DailyAlerts] No alerts or actions today.");
    return;
  }

  await sendConsolidatedAlertEmail({
    stalePending,
    upcomingUnpaid,
    depositsToReturn,
    transitions,
    guestEmailSummary,
  });
}

async function sendConsolidatedAlertEmail(data: {
  stalePending: any[];
  upcomingUnpaid: any[];
  depositsToReturn: any[];
  transitions: string[];
  guestEmailSummary: GuestEmailSummary;
}) {
  const transporter = getTransporter();
  if (!transporter) return;

  const fmt = (d: Date | string) => format(new Date(d), "dd.MM.yyyy");

  let html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e40af;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">📅 Daily Operational Summary — Rental Manager</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:16px 24px">
  `;

  // --- ACTIONS TAKEN ---
  if (data.transitions.length > 0 || data.guestEmailSummary.details.length > 0) {
    html += `<h3 style="color:#1e40af;margin-top:0">✅ Actions Taken Automatically</h3><ul style="font-size:14px">`;
    data.transitions.forEach(t => { html += `<li>${t}</li>`; });
    data.guestEmailSummary.details.forEach(d => { html += `<li>${d}</li>`; });
    html += `</ul><hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />`;
  }

  // --- TASKS TO TAKE BY OWNER ---
  html += `<h3 style="color:#b45309">📋 Tasks for You</h3>`;

  if (data.stalePending.length > 0) {
    html += `
      <h4 style="color:#9f1239;margin-bottom:8px">⚠️ Stale Pending Bookings (> 3 days)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.stalePending.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)}) - Created: ${fmt(b.createdAt)}</li>`).join("")}
      </ul>
    `;
  }

  if (data.upcomingUnpaid.length > 0) {
    html += `
      <h4 style="color:#b45309;margin-bottom:8px">⏳ Upcoming Unpaid Bookings (starts within 7 days)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.upcomingUnpaid.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)}) - Channel: ${b.channel}</li>`).join("")}
      </ul>
    `;
  }

  if (data.depositsToReturn.length > 0) {
    html += `
      <h4 style="color:#15803d;margin-bottom:8px">💰 Deposits to Refund (finished bookings)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.depositsToReturn.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmt(b.checkIn)} - ${fmt(b.checkOut)})</li>`).join("")}
      </ul>
    `;
  }

  if (data.stalePending.length === 0 && data.upcomingUnpaid.length === 0 && data.depositsToReturn.length === 0) {
    html += `<p style="font-size:14px">No manual tasks today! 🎉</p>`;
  }

  html += `
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />
        <p style="font-size:12px;color:#6b7280">
          Sent automatically by Rental Manager to ${ALERT_RECIPIENT}
        </p>
      </div>
    </div>
  `;

  const totalItems = data.stalePending.length + data.upcomingUnpaid.length + data.depositsToReturn.length;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${GMAIL_USER}>`,
      to: ALERT_RECIPIENT,
      subject: `📅 Daily Report: ${data.guestEmailSummary.sentCount} emails sent, ${totalItems} tasks pending`,
      html,
    });
    console.log(`[DailyAlerts] Consolidated email sent to ${ALERT_RECIPIENT}`);
  } catch (err) {
    console.error("[DailyAlerts] Failed to send email:", err);
  }
}
