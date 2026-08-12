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
import { processGuestReplyDrafts } from "./guestReplyWorker";
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

// ── Nightly network maintenance window ──────────────────────────────────────
//
// At ~03:00 the router renews its WAN lease and the mesh tears down and
// rebuilds. Polls that fire into that gap fail on a dead route, not on anything
// wrong with the remote end: the iCal feeds accounted for a dozen failures in
// the 03:00 hour, and the pricing audit — scheduled at exactly 03:00 — spent
// ten minutes looping through retries against every portal.
//
// Skipping is safe for the recurring polls specifically because they are
// recurring and idempotent. iCal re-reads each feed in full, and the email
// poller searches a 7-day window and dedupes on `processed_emails`, so the
// 03:30 tick picks up whatever 03:00 would have seen. A once-daily job has no
// such next tick, so it must be moved out of the window rather than skipped —
// see the pricing audit at 04:00.
//
// The watchdog deliberately keeps running: it only ever fetches localhost, so
// the mesh being down does not affect it, and pausing it would blind the health
// check for no gain.
const MAINTENANCE_TZ = "Europe/Warsaw"; // Must match the cron `timezone` below.
const MAINTENANCE_START_MIN = 2 * 60 + 50; // 02:50
const MAINTENANCE_END_MIN = 3 * 60 + 20; // 03:20

/**
 * Minutes since midnight in `tz`, independent of the host's own timezone.
 *
 * The cron jobs are pinned to Europe/Warsaw, so this guard has to be too —
 * reading `getHours()` off the host would silently drift the window if the
 * server timezone ever changed.
 */
function minutesOfDayIn(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

export function isNetworkMaintenanceWindow(now: Date = new Date()): boolean {
  const mins = minutesOfDayIn(MAINTENANCE_TZ, now);
  return mins >= MAINTENANCE_START_MIN && mins < MAINTENANCE_END_MIN;
}

/** Log and report whether `label` should stand down for the window. */
function skipForMaintenance(label: string): boolean {
  if (!isNetworkMaintenanceWindow()) return false;
  console.log(`[Scheduler] ${label} skipped (router/mesh maintenance window 02:50–03:20).`);
  return true;
}

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
    if (skipForMaintenance("iCal poll")) return;
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
    // Guest reply drafting below is skipped along with the poll: it calls out
    // to the model API, which is just as unreachable while the mesh is down.
    if (skipForMaintenance("Email poll")) return;
    console.log("[Scheduler] Running email poll...");
    try {
      const outcome = await runWithLock(EMAIL_LOCK, () => pollEmails());
      if (!outcome.ran) console.log("[Scheduler] Email poll skipped (another run in progress).");
    } catch (err) {
      console.error("[Scheduler] Email poll failed:", err);
    }

    // Drafting runs after the poll but outside its lock and its try block: a
    // model outage must not be reported as a mail-polling failure, and a poll
    // that failed halfway may still have recorded emails worth drafting.
    try {
      await processGuestReplyDrafts();
    } catch (err) {
      console.error("[Scheduler] Guest reply drafting failed:", err);
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

  // ── Daily Pricing Audit: every day at 04:00 AM ────────────────────────────
  //
  // Moved off 03:00, which sat squarely inside the router/mesh window: every
  // portal lookup failed and the auditor burned ~10 minutes retrying against a
  // dead route. As a once-daily job it cannot simply be skipped like the
  // recurring polls — there would be no later tick to cover for it.
  tasks.push(cron.schedule("0 0 4 * * *", async () => {
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
