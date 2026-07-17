/**
 * Background Scheduler
 *
 * Registers cron jobs for iCal and email polling.
 * This module is imported by the main server entry point.
 *
 * Schedule: every 30 minutes (at :00 and :30 of each hour)
 *
 * Poll bodies run under a MySQL advisory lock (runWithLock) so a run can never
 * overlap itself or a second poller process (a stray crontab, or the startup
 * poll colliding with a cron tick) — whichever run holds the lock proceeds, the
 * other skips.
 */

import cron, { type ScheduledTask } from "node-cron";
import { pollAllICalFeeds } from "./icalPoller";
import { pollEmails } from "./emailPoller";
import { runDailyMaintenance } from "./dailyAlerts";
import { updateAllPropertyRatings } from "./ratingScraper";
import { PricingAuditor } from "./pricingAuditor";
import { checkPortalHealth } from "./portalWatchdog";
import { runWithLock } from "../db";

let schedulerStarted = false;
const tasks: ScheduledTask[] = [];
const startupTimers: NodeJS.Timeout[] = [];

const ICAL_LOCK = "poll_ical";
const EMAIL_LOCK = "poll_email";

export function startScheduler(): void {
  if (schedulerStarted) {
    console.log("[Scheduler] Already running, skipping re-init");
    return;
  }
  schedulerStarted = true;

  // ── Portal watchdog: every hour ───────────────────────────────────────────
  tasks.push(cron.schedule("0 0 * * * *", async () => {
    console.log("[Scheduler] Running portal watchdog check...");
    try {
      await checkPortalHealth();
    } catch (err) {
      console.error("[Scheduler] Portal watchdog failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  // ── iCal polling: every 30 minutes ────────────────────────────────────────
  tasks.push(cron.schedule("0 */30 * * * *", async () => {
    console.log("[Scheduler] Running iCal poll...");
    try {
      const outcome = await runWithLock(ICAL_LOCK, () => pollAllICalFeeds());
      if (!outcome.ran) console.log("[Scheduler] iCal poll skipped (another run in progress).");
    } catch (err) {
      console.error("[Scheduler] iCal poll failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  // ── Email polling: every 30 minutes (offset by 5 minutes) ─────────────────
  tasks.push(cron.schedule("0 5,35 * * * *", async () => {
    console.log("[Scheduler] Running email poll...");
    try {
      const outcome = await runWithLock(EMAIL_LOCK, () => pollEmails());
      if (!outcome.ran) console.log("[Scheduler] Email poll skipped (another run in progress).");
    } catch (err) {
      console.error("[Scheduler] Email poll failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  // ── Daily Maintenance: once a day at 08:00 AM ─────────────────────────────
  tasks.push(cron.schedule("0 0 8 * * *", async () => {
    console.log("[Scheduler] Running daily maintenance (includes status transitions + guest emails)...");
    try {
      await runDailyMaintenance();
    } catch (err) {
      console.error("[Scheduler] Daily maintenance failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  // ── Weekly Ratings Update: Sunday at 02:00 AM ─────────────────────────────
  tasks.push(cron.schedule("0 0 2 * * 0", async () => {
    console.log("[Scheduler] Running weekly ratings update...");
    try {
      await updateAllPropertyRatings();
    } catch (err) {
      console.error("[Scheduler] Weekly ratings update failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  // ── Daily Pricing Audit: every day at 03:00 AM ────────────────────────────
  tasks.push(cron.schedule("0 0 3 * * *", async () => {
    console.log("[Scheduler] Running daily pricing audit...");
    try {
      await PricingAuditor.runDailyAudit();
    } catch (err) {
      console.error("[Scheduler] Pricing audit failed:", err);
    }
  }, {
    timezone: "Europe/Warsaw"
  }));

  console.log("[Scheduler] Background jobs registered (iCal + Email + Daily Maintenance + Weekly Ratings + Pricing Audit)");

  // Run an initial poll shortly after startup (60 seconds delay)
  startupTimers.push(setTimeout(async () => {
    console.log("[Scheduler] Running initial iCal poll on startup...");
    try {
      const outcome = await runWithLock(ICAL_LOCK, () => pollAllICalFeeds());
      if (!outcome.ran) console.log("[Scheduler] Initial iCal poll skipped (another run in progress).");
    } catch (err) {
      console.error("[Scheduler] Initial iCal poll failed:", err);
    }
  }, 60_000));

  startupTimers.push(setTimeout(async () => {
    console.log("[Scheduler] Running initial ratings update on startup...");
    try {
      await updateAllPropertyRatings();
    } catch (err) {
      console.error("[Scheduler] Initial ratings update failed:", err);
    }
  }, 65_000));

  startupTimers.push(setTimeout(async () => {
    console.log("[Scheduler] Running initial portal health check on startup...");
    try {
      await checkPortalHealth();
    } catch (err) {
      console.error("[Scheduler] Initial portal health check failed:", err);
    }
  }, 75_000));
}

/**
 * Stop all scheduled tasks and pending startup timers. Called during graceful
 * shutdown so no new poll fires while the process is tearing down.
 */
export function stopScheduler(): void {
  for (const t of tasks) {
    try { t.stop(); } catch { /* ignore */ }
  }
  tasks.length = 0;
  for (const timer of startupTimers) clearTimeout(timer);
  startupTimers.length = 0;
  schedulerStarted = false;
  console.log("[Scheduler] Stopped all background jobs.");
}
