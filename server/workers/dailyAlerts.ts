import { and, eq, lte, gte, lt, ne, sql, or, isNull, inArray, desc } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, syncLogs, guestEmails as guestEmailsTable, portalAnalytics } from "../../drizzle/schema";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { getTransporter, GMAIL_USER, sendAlertEmail, sendGuestEmail, getRecipientForEmail } from "../_core/email";
import { processGuestEmails, GuestEmailSummary } from "./guestEmailWorker";
import { Logger } from "../_core/logger";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

/**
 * Perform a database backup and cleanup old ones.
 */
async function performDatabaseBackup() {
  const backupDir = path.join(process.cwd(), "backups");
  
  try {
    // 1. Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // 2. Determine DB credentials from DATABASE_URL
    // Example: mysql://user:password@host:port/database
    const dbUrl = process.env.DATABASE_URL || "";
    const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    
    if (!match) {
      console.warn("[DailyAlerts] Could not parse DATABASE_URL for backup, skipping.");
      return false;
    }

    const [_, user, password, host, port, database] = match;
    const timestamp = format(new Date(), "yyyy-MM-dd_HH-mm");
    const fileName = `backup_${database}_${timestamp}.sql`;
    const filePath = path.join(backupDir, fileName);

    // 3. Run mysqldump
    // We use -u, -p (no space), -h, -P and redirect to file
    const command = `mysqldump -u${user} -p'${password}' -h${host} -P${port} ${database} > ${filePath}`;
    await execAsync(command);
    console.log(`[DailyAlerts] Database backup created: ${fileName}`);

    // 4. Cleanup: keep only 10 most recent files
    const files = await fs.readdir(backupDir);
    const backupFiles = files
      .filter(f => f.startsWith("backup_") && f.endsWith(".sql"))
      .map(f => ({ name: f, time: 0 }));
    
    for (const f of backupFiles) {
      const stats = await fs.stat(path.join(backupDir, f.name));
      f.time = stats.mtimeMs;
    }

    backupFiles.sort((a, b) => b.time - a.time); // Newest first

    if (backupFiles.length > 10) {
      const toDelete = backupFiles.slice(10);
      for (const f of toDelete) {
        await fs.unlink(path.join(backupDir, f.name));
        console.log(`[DailyAlerts] Deleted old backup: ${f.name}`);
      }
    }

    return true;
  } catch (err) {
    console.error("[DailyAlerts] Database backup failed:", err);
    return false;
  }
}

/**
 * Transition a booking to a new status and log the activity.
 */
async function transitionBookingStatus(
  bookingId: number, 
  status: "pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled",
  reason: string,
  details: string
) {
  try {
    const db = await getDb();
    if (!db) return;

    await db
      .update(bookings)
      .set({ status })
      .where(eq(bookings.id, bookingId));
    
    await Logger.bookingAction(bookingId, "status_change", reason, details);
  } catch (err) {
    console.error(`[DailyAlerts] Failed to transition booking #${bookingId}:`, err);
  }
}

export async function runDailyMaintenance() {
  console.log("[DailyAlerts] Starting daily maintenance...");
  const start = Date.now();
  const db = await getDb();
  if (!db) {
    console.warn("[DailyAlerts] Database not available, skipping.");
    return;
  }

  const transitions: string[] = [];
  let guestEmailSummary: GuestEmailSummary = { sentCount: 0, failedCount: 0, details: [] };
  
  // ─── 0. Database Backup ──────────────────────────────────────────────────
  await performDatabaseBackup();

  let stalePending: any[] = [];
  let upcomingUnpaid: any[] = [];
  let upcomingPendingDeposits: any[] = [];
  let depositsToReturn: any[] = [];
  let stalePortalPaid: any[] = [];
  let bookingsMissingData: any[] = [];
  let failedSyncs: any[] = [];
  let failedGuestEmails: any[] = [];
  let latestSyncs: any[] = [];
  let portalStats: Array<{ page: string, count: number }> = [];

  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterday = subDays(now, 1);
    const yesterdayStart = startOfDay(yesterday);
    const yesterdayEnd = endOfDay(yesterday);

    // ─── 0.1 Portal Analytics ──────────────────────────────────────────────────
    try {
      const stats = await db
        .select({
          page: portalAnalytics.page,
          count: sql`count(distinct ${portalAnalytics.ipHash})`,
        })
        .from(portalAnalytics)
        .where(
          and(
            gte(portalAnalytics.date, yesterdayStart),
            lte(portalAnalytics.date, yesterdayEnd)
          )
        )
        .groupBy(portalAnalytics.page);
      
      portalStats = stats.map(s => ({ page: s.page, count: Number(s.count) }));
    } catch (err) {
      console.error("[DailyAlerts] Portal analytics step failed:", err);
    }

    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 48h
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // ─── 0.2 Find Bookings Missing Essential Data ──────────────────────────────────
    try {
      bookingsMissingData = await db
        .select()
        .from(bookings)
        .where(
          and(
            or(
              isNull(bookings.guestName), 
              eq(bookings.guestName, ""), 
              isNull(bookings.guestEmail), 
              eq(bookings.guestEmail, "")
            ),
            inArray(bookings.status, ["confirmed", "portal_paid", "paid", "pending"]),
            gte(bookings.checkOut, now)
          )
        );
    } catch (err) {
      console.error("[DailyAlerts] Finding bookings missing data failed:", err);
    }

    // ─── 1. Automatic status transitions (Confirmed -> Portal Paid) ────────────────
    try {
      const portalBookings = await db
        .select()
        .from(bookings)
        .where(
          and(
            lte(bookings.checkIn, thirtyDaysFromNow),
            eq(bookings.status, "confirmed")
          )
        );

      const toPortalPaid = portalBookings.filter(b => ["airbnb", "booking"].includes(b.channel));

      for (const b of toPortalPaid) {
        await transitionBookingStatus(
          b.id, 
          "portal_paid", 
          "Automatic transition to portal_paid", 
          "Based on 30-day arrival window for Airbnb/Booking channels"
        );
        transitions.push(`Booking #${b.id} (${b.channel}) transitioned to <b>portal_paid</b>`);
      }
    } catch (err) {
      console.error("[DailyAlerts] Portal transition step failed:", err);
    }

    // ─── 1.1 Cancel stale pending bookings (> 5 days) ──────────────────────────────
    try {
      const expiredPending = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, "pending"),
            lt(bookings.createdAt, fiveDaysAgo)
          )
        );

      for (const b of expiredPending) {
        await transitionBookingStatus(
          b.id,
          "cancelled",
          "Automatic cancellation - No payment received",
          "Pending booking exceeded 5-day payment window"
        );
        
        await sendGuestEmail("booking_cancelled_no_payment", b);
        
        const msg = `Booking #${b.id} (${b.guestName || "Unknown"}) auto-cancelled (no payment received for > 5 days)`;
        transitions.push(msg);
        console.log(`[DailyAlerts] ${msg}`);
      }
    } catch (err) {
      console.error("[DailyAlerts] Expired pending cancellation failed:", err);
    }

    // ─── 2. Automatic status transitions (Paid -> Finished) ────────────────────────
    try {
      const paidEnded = await db
        .select({ id: bookings.id, checkOut: bookings.checkOut, guestName: bookings.guestName })
        .from(bookings)
        .where(eq(bookings.status, "paid"));

      for (const b of paidEnded) {
        if (b.checkOut && new Date(b.checkOut) < now) {
          await transitionBookingStatus(
            b.id,
            "finished",
            "Automatic transition to finished",
            "Checkout date passed and booking was fully paid"
          );
          
          const msg = `Booking #${b.id} (${b.guestName || "Unknown"}) auto-finished (checkout date passed)`;
          transitions.push(msg);
          console.log(`[DailyAlerts] ${msg}`);
        }
      }
    } catch (err) {
      console.error("[DailyAlerts] Paid transition step failed:", err);
    }

    // ─── 3. Guest Email Processing ──────────────────────────────────────────────
    try {
      guestEmailSummary = await processGuestEmails();
    } catch (err) {
      console.error("[DailyAlerts] Guest email processing failed:", err);
    }

    // ─── 4. Identify alerts and errors ──────────────────────────────────────────
    try {
      stalePending = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, "pending"), 
            lt(bookings.createdAt, twoDaysAgo),
            gte(bookings.createdAt, fiveDaysAgo)
          )
        );

      upcomingUnpaid = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, "confirmed"),
            lte(bookings.checkIn, oneWeekFromNow),
            gte(bookings.checkIn, now)
          )
        );

      upcomingPendingDeposits = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.depositStatus, "pending"),
            lte(bookings.checkIn, oneWeekFromNow),
            gte(bookings.checkIn, now),
            ne(bookings.status, "cancelled")
          )
        );

      depositsToReturn = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.status, "finished"), eq(bookings.depositStatus, "paid")));

      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      stalePortalPaid = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, "portal_paid"),
            lte(bookings.checkOut, sevenDaysAgo)
          )
        );

      // Fetch Errors from last 24h
      failedSyncs = await db
        .select()
        .from(syncLogs)
        .where(
          and(
            eq(syncLogs.success, "false"),
            gte(syncLogs.createdAt, twentyFourHoursAgo)
          )
        );

      // Identify current status of each sync source (to see if issue still persists)
      // We get the latest log for each unique source
      const allSources = await db
        .select({ source: syncLogs.source })
        .from(syncLogs)
        .where(gte(syncLogs.createdAt, twentyFourHoursAgo));
      
      const uniqueSources = Array.from(new Set(allSources.map(s => s.source)));
      const latestSyncs: any[] = [];
      
      for (const source of uniqueSources) {
        const [latest] = await db
          .select()
          .from(syncLogs)
          .where(eq(syncLogs.source, source))
          .orderBy(desc(syncLogs.createdAt))
          .limit(1);
        if (latest) {
          latestSyncs.push(latest);
        }
      }

      failedGuestEmails = await db
        .select()
        .from(guestEmailsTable)
        .where(
          and(
            eq(guestEmailsTable.success, "false"),
            gte(guestEmailsTable.sentAt, twentyFourHoursAgo)
          )
        );

    } catch (err) {
      console.error("[DailyAlerts] Alert identification failed:", err);
    }

    // ─── 5. Send consolidated email ──────────────────────────────────────────────
    
    const hasActions = transitions.length > 0 || guestEmailSummary.details.length > 0;
    const hasAlerts = stalePending.length > 0 || upcomingUnpaid.length > 0 || upcomingPendingDeposits.length > 0 || depositsToReturn.length > 0 || stalePortalPaid.length > 0;
    const hasErrors = failedSyncs.length > 0 || failedGuestEmails.length > 0;

    const summaryMsg = `Actions: ${transitions.length + guestEmailSummary.sentCount}, Alerts: ${stalePending.length + upcomingUnpaid.length + upcomingPendingDeposits.length + depositsToReturn.length + stalePortalPaid.length}, Errors: ${failedSyncs.length + failedGuestEmails.length}`;
    console.log(`[DailyAlerts] Maintenance summary: ${summaryMsg}`);

    // We always send the email now if requested to report on "absence of errors"
    // or if there are any actions/alerts/errors.
    
    let emailSent = false;
    try {
      emailSent = await sendConsolidatedAlertEmail({
        stalePending,
        upcomingUnpaid,
        upcomingPendingDeposits,
        depositsToReturn,
        stalePortalPaid,
        bookingsMissingData,
        transitions,
        guestEmailSummary,
        failedSyncs,
        failedGuestEmails,
        latestSyncs,
        portalStats,
      });
    } catch (err) {
      console.error("[DailyAlerts] Failed to send consolidated email:", err);
    }

    // Log the sync run
    await Logger.system("email", {
      source: "Daily Maintenance",
      newBookings: transitions.length,
      updatedBookings: guestEmailSummary.sentCount,
      success: emailSent,
      errorMessage: emailSent ? null : "Failed to send consolidated email",
      durationMs: Date.now() - start,
    });

  } catch (err) {
    console.error("[DailyAlerts] CRITICAL: Daily maintenance crashed:", err);
    
    // Send emergency alert email
    try {
      await sendAlertEmail(
        "🚨 CRITICAL: Daily Maintenance Crashed",
        `The daily maintenance task crashed with the following error:\n\n${String(err)}\n\nStack trace:\n${err instanceof Error ? err.stack : "No stack trace available"}`
      );
    } catch (emailErr) {
      console.error("[DailyAlerts] Failed to send emergency alert email:", emailErr);
    }

    await Logger.system("email", {
      source: "Daily Maintenance",
      success: false,
      errorMessage: `CRITICAL: ${String(err)}`,
      durationMs: Date.now() - start,
    });
  }
}

async function sendConsolidatedAlertEmail(data: {
  stalePending: any[];
  upcomingUnpaid: any[];
  upcomingPendingDeposits: any[];
  depositsToReturn: any[];
  stalePortalPaid: any[];
  bookingsMissingData: any[];
  transitions: string[];
  guestEmailSummary: GuestEmailSummary;
  failedSyncs: any[];
  failedGuestEmails: any[];
  latestSyncs: any[];
  portalStats: Array<{ page: string, count: number }>;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  const adminEmail = await getRecipientForEmail("alert");

  const fmt = (d: Date | string) => format(new Date(d), "dd.MM.yyyy HH:mm");
  const fmtDate = (d: Date | string) => format(new Date(d), "dd.MM.yyyy");

  let html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e40af;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">📅 Daily Operational Summary — Rental Manager</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:16px 24px">
  `;

  // --- APP HEALTH / ERRORS ---
  html += `<h3 style="color:#1e40af;margin-top:0">🛠️ App Health (last 24h)</h3>`;

  // Portal Stats Section
  html += `
    <div style="background:#f8fafc;padding:12px;border-radius:6px;margin-bottom:16px;border:1px solid #e2e8f0">
      <h4 style="margin:0 0 8px 0;font-size:13px;color:#475569;text-transform:uppercase;letter-spacing:0.05em">📊 Portal Activity (Yesterday)</h4>
      <div style="display:grid;grid-template-columns: 1fr 1fr 1fr;gap:8px;font-size:12px">
        ${["main", "Sadoles", "Hacjenda"].map(page => {
          const stat = data.portalStats.find(s => s.page === page);
          return `<div><strong>${page}</strong>: ${stat?.count || 0} unique visitors</div>`;
        }).join("")}
      </div>
    </div>
  `;

  // Current Status Section
  if (data.latestSyncs.length > 0) {
    html += `
      <div style="background:#f1f5f9;padding:12px;border-radius:6px;margin-bottom:16px">
        <h4 style="margin:0 0 8px 0;font-size:13px;color:#475569;text-transform:uppercase;letter-spacing:0.05em">Current Sync Status</h4>
        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:8px;font-size:12px">
          ${data.latestSyncs.map(s => {
            const isOk = s.success === "true";
            const color = isOk ? "#15803d" : "#9f1239";
            const icon = isOk ? "✅" : "❌";
            return `<div style="color:${color}"><strong>${icon} ${s.source}</strong>: ${isOk ? "Healthy" : "Failing"}</div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (data.failedSyncs.length === 0 && data.failedGuestEmails.length === 0) {
    html += `<p style="font-size:14px;color:#15803d">✅ System is healthy. No major errors recorded.</p>`;
  } else {
    if (data.failedSyncs.length > 0) {
      const persistedFailures = data.failedSyncs.filter(fs => {
        const latest = data.latestSyncs.find(ls => ls.source === fs.source);
        return latest && latest.success === "false";
      });
      const resolvedFailures = data.failedSyncs.filter(fs => {
        const latest = data.latestSyncs.find(ls => ls.source === fs.source);
        return latest && latest.success === "true";
      });

      if (persistedFailures.length > 0) {
        html += `
          <h4 style="color:#9f1239;margin-bottom:8px">❌ Persistent Sync Failures (Action Required)</h4>
          <ul style="font-size:13px;margin-top:0;color:#9f1239">
            ${persistedFailures.map(s => `<li><strong>${s.source}</strong>: ${s.errorMessage || "Unknown error"} (Latest attempt: ${fmt(s.createdAt)})</li>`).join("")}
          </ul>
        `;
      }

      if (resolvedFailures.length > 0) {
        // Group resolved failures by source to avoid spamming the same source multiple times
        const resolvedBySource: Record<string, any[]> = {};
        resolvedFailures.forEach(f => {
          if (!resolvedBySource[f.source]) resolvedBySource[f.source] = [];
          resolvedBySource[f.source].push(f);
        });

        html += `
          <h4 style="color:#15803d;margin-bottom:8px">ℹ️ Resolved / Transient Sync Issues</h4>
          <p style="font-size:12px;color:#64748b;margin-top:-4px">These sources had problems overnight but are now working correctly.</p>
          <ul style="font-size:13px;margin-top:0;color:#15803d">
            ${Object.entries(resolvedBySource).map(([source, fails]) => `<li><strong>${source}</strong>: Had ${fails.length} failure(s) starting at ${fmt(fails[fails.length-1].createdAt)}. <span style="background:#dcfce7;padding:2px 4px;border-radius:4px">Now Resolved</span></li>`).join("")}
          </ul>
        `;
      }
    }
    if (data.failedGuestEmails.length > 0) {
      html += `
        <h4 style="color:#9f1239;margin-bottom:8px">❌ Failed Guest Emails</h4>
        <ul style="font-size:14px;margin-top:0">
          ${data.failedGuestEmails.map(e => `<li>To <strong>${e.recipient}</strong> (${e.emailType}) at ${fmt(e.sentAt)}: <span style="color:#9f1239">${e.errorMessage || "Unknown error"}</span></li>`).join("")}
        </ul>
      `;
    }
  }
  html += `<hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />`;

  // --- ACTIONS TAKEN ---
  if (data.transitions.length > 0 || data.guestEmailSummary.details.length > 0) {
    html += `<h3 style="color:#1e40af;margin-top:0">✅ Actions Taken Automatically</h3><ul style="font-size:14px">`;
    data.transitions.forEach(t => { html += `<li>${t}</li>`; });
    data.guestEmailSummary.details.forEach(d => { html += `<li>${d}</li>`; });
    html += `</ul><hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />`;
  }

  // --- TASKS TO TAKE BY OWNER ---
  html += `<h3 style="color:#b45309">📋 Tasks for You</h3>`;

  if (data.bookingsMissingData.length > 0) {
    html += `
      <h4 style="color:#9f1239;margin-bottom:8px">🚨 Bookings Missing Essential Data (Action Required)</h4>
      <p style="font-size:12px;color:#6b7280;margin-top:-4px">Guest email or name is missing. Reminder emails will NOT be sent until fixed.</p>
      <ul style="font-size:14px;margin-top:0">
        ${data.bookingsMissingData.map(b => `
          <li>
            <strong>${b.property}</strong>: ${b.guestName || "<i>Name missing</i>"} (${fmtDate(b.checkIn)} - ${fmtDate(b.checkOut)}) 
            — ${!b.guestEmail ? "<span style='color:#9f1239'>Email missing</span>" : ""}
            ${!b.guestName ? "<span style='color:#9f1239'>Name missing</span>" : ""}
          </li>
        `).join("")}
      </ul>
    `;
  }

  if (data.stalePending.length > 0) {
    html += `
      <h4 style="color:#9f1239;margin-bottom:8px">⚠️ Stale Pending Bookings (> 48h)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.stalePending.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmtDate(b.checkIn)} - ${fmtDate(b.checkOut)}) - Created: ${fmtDate(b.createdAt)}</li>`).join("")}
      </ul>
    `;
  }

  if (data.upcomingUnpaid.length > 0) {
    html += `
      <h4 style="color:#b45309;margin-bottom:8px">⏳ Upcoming Unpaid Bookings (starts within 7 days)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.upcomingUnpaid.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmtDate(b.checkIn)} - ${fmtDate(b.checkOut)}) - Channel: ${b.channel}</li>`).join("")}
      </ul>
    `;
  }

  if (data.upcomingPendingDeposits.length > 0) {
    html += `
      <h4 style="color:#b45309;margin-bottom:8px">💰 Missing Security Deposits (starts within 7 days)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.upcomingPendingDeposits.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmtDate(b.checkIn)} - ${fmtDate(b.checkOut)})</li>`).join("")}
      </ul>
    `;
  }

  if (data.stalePortalPaid.length > 0) {
    html += `
      <h4 style="color:#9f1239;margin-bottom:8px">💰 Missing Portal Payouts (> 7 days after checkout)</h4>
      <p style="font-size:12px;color:#6b7280;margin-top:-4px">Please check if money arrived and move to finished manually.</p>
      <ul style="font-size:14px;margin-top:0">
        ${data.stalePortalPaid.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (checkout: ${fmtDate(b.checkOut)}) - Channel: ${b.channel}</li>`).join("")}
      </ul>
    `;
  }

  if (data.depositsToReturn.length > 0) {
    html += `
      <h4 style="color:#15803d;margin-bottom:8px">💰 Deposits to Refund (finished bookings)</h4>
      <ul style="font-size:14px;margin-top:0">
        ${data.depositsToReturn.map(b => `<li><strong>${b.property}</strong>: ${b.guestName || "Unknown"} (${fmtDate(b.checkIn)} - ${fmtDate(b.checkOut)})</li>`).join("")}
      </ul>
    `;
  }

  if (data.stalePending.length === 0 && data.upcomingUnpaid.length === 0 && data.upcomingPendingDeposits.length === 0 && data.depositsToReturn.length === 0 && data.stalePortalPaid.length === 0) {
    html += `<p style="font-size:14px">No manual tasks today! 🎉</p>`;
  }

  html += `
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0" />
        <p style="font-size:12px;color:#6b7280">
          Sent automatically by Rental Manager to ${adminEmail}
        </p>
      </div>
    </div>
  `;

  const totalItems = data.stalePending.length + data.upcomingUnpaid.length + data.upcomingPendingDeposits.length + data.depositsToReturn.length + data.stalePortalPaid.length + data.bookingsMissingData.length;
  const totalErrors = data.failedSyncs.length + data.failedGuestEmails.length;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${GMAIL_USER}>`,
      to: adminEmail,
      subject: `📅 Daily Report: ${totalErrors} errors, ${data.guestEmailSummary.sentCount} emails sent, ${totalItems} tasks`,
      html,
    });
    console.log(`[DailyAlerts] Consolidated email sent to ${adminEmail}`);
    return true;
  } catch (err) {
    console.error("[DailyAlerts] Failed to send email:", err);
    return false;
  }
}
