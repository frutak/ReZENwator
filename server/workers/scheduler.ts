/**
 * Background Scheduler
 *
 * Registers cron jobs for iCal and email polling.
 * This module is imported by the main server entry point.
 *
 * Schedule: every 30 minutes (at :00 and :30 of each hour)
 */

import cron from "node-cron";
import { pollAllICalFeeds } from "./icalPoller";
import { pollEmails } from "./emailPoller";
import { runDailyMaintenance } from "./dailyAlerts";
import { updateAllPropertyRatings } from "./ratingScraper";

let schedulerStarted = false;

export function startScheduler(): void {
  if (schedulerStarted) {
    console.log("[Scheduler] Already running, skipping re-init");
    return;
  }
  schedulerStarted = true;

  // ── iCal polling: every 30 minutes ────────────────────────────────────────
  cron.schedule("0 */30 * * * *", async () => {
    console.log("[Scheduler] Running iCal poll...");
    try {
      await pollAllICalFeeds();
    } catch (err) {
      console.error("[Scheduler] iCal poll failed:", err);
    }
  });

  // ── Email polling: every 30 minutes (offset by 5 minutes) ─────────────────
  cron.schedule("0 5,35 * * * *", async () => {
    console.log("[Scheduler] Running email poll...");
    try {
      await pollEmails();
    } catch (err) {
      console.error("[Scheduler] Email poll failed:", err);
    }
  });

  // ── Daily Maintenance: once a day at 08:00 AM ─────────────────────────────
  cron.schedule("0 0 8 * * *", async () => {
    console.log("[Scheduler] Running daily maintenance (includes status transitions + guest emails)...");
    try {
      await runDailyMaintenance();
    } catch (err) {
      console.error("[Scheduler] Daily maintenance failed:", err);
    }
  });

  // ── Weekly Ratings Update: Sunday at 02:00 AM ─────────────────────────────
  cron.schedule("0 0 2 * * 0", async () => {
    console.log("[Scheduler] Running weekly ratings update...");
    try {
      await updateAllPropertyRatings();
    } catch (err) {
      console.error("[Scheduler] Weekly ratings update failed:", err);
    }
  });

  console.log("[Scheduler] Background jobs registered (iCal + Email + Daily Maintenance + Weekly Ratings)");

  // Run an initial poll shortly after startup (60 seconds delay)
  setTimeout(async () => {
    console.log("[Scheduler] Running initial iCal poll and ratings update on startup...");
    try {
      await Promise.all([
        pollAllICalFeeds(),
        updateAllPropertyRatings(),
      ]);
    } catch (err) {
      console.error("[Scheduler] Initial startup jobs failed:", err);
    }
  }, 60_000);
}
