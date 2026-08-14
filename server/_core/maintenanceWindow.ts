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
export const MAINTENANCE_TZ = "Europe/Warsaw"; // Must match the cron `timezone` below.
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
