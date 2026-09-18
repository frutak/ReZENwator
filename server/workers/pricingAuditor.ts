import { exec } from "child_process";
import { promisify } from "util";
import { BookingRepository } from "../repositories/BookingRepository";
import { PricingAuditRepository } from "../repositories/PricingAuditRepository";
import { Logger } from "../_core/logger";
import { PricingService } from "../services/PricingService";
import { addDays, format, isAfter, isBefore, startOfDay } from "date-fns";
import { AUDIT_OCCUPANCY } from "@shared/config";
import { isNetworkMaintenanceWindow } from "../_core/maintenanceWindow";

const execAsync = promisify(exec);

/**
 * Probes per nightly run, and the most one property may take. Raised from 10/7 on
 * 18 Sep 2026, when every channel was repriced at once: at ten a night the audit
 * needed weeks to re-read the calendar, and each probe costs well under a minute.
 */
const MAX_PROBES_PER_DAY = 30;
const MAX_PROBES_PER_PROPERTY = 18;
/** Random stays drawn per run; enough to keep the larger budget busy after the 14-day skip. */
const WILDCARD_CANDIDATES = 40;
const SCRAPE_ATTEMPTS = 3;
const SCRAPE_RETRY_DELAY_MS = 5000;
const PYTHON_VENV_PATH = "/home/frutak/price-checker/venv/bin/python3";
const HELPER_SCRIPT_PATH = "scripts/scrape_auditor_pw.py";

const HOLIDAYS = [
  "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-02", "2026-05-03", 
  "2026-06-04", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"
];

interface ScrapeResult {
  price: number | null;
  status: string;
  error?: string;
  /** Page loads spent reaching this result, 1..SCRAPE_ATTEMPTS. */
  attempts?: number;
}

/**
 * Health of one run's calls to the portals, as opposed to what those calls found.
 *
 * A call that comes back OK or SOLD_OUT answered the question; one that comes back
 * ERROR did not, and is a fault on our side of the wire — a timeout, a navigation
 * failure, a bot wall. Tracking the split makes the scraper's reliability a number
 * that moves rather than something noticed when the table looks wrong.
 */
interface RunStats {
  calls: number;
  resolved: number;
  noPrice: number;
  failed: number;
  attempts: number;
  byChannel: Record<string, { calls: number; resolved: number; attempts: number }>;
}

/** A call answered the question only if the portal said yes or said no. */
const RESOLVED = new Set(["OK", "SOLD_OUT"]);

const emptyRunStats = (): RunStats => ({ calls: 0, resolved: 0, noPrice: 0, failed: 0, attempts: 0, byChannel: {} });

function recordCall(stats: RunStats, channel: string, result: ScrapeResult): void {
  const attempts = result.attempts ?? 1;
  const resolved = RESOLVED.has(result.status);

  stats.calls++;
  stats.attempts += attempts;
  if (resolved) stats.resolved++;
  else if (result.status === "NO_PRICE") stats.noPrice++;
  else stats.failed++;

  const per = (stats.byChannel[channel] ??= { calls: 0, resolved: 0, attempts: 0 });
  per.calls++;
  per.attempts += attempts;
  if (resolved) per.resolved++;
}

/** One line summarising a run's call health, for the sync log and the console. */
function summariseRun(stats: RunStats): string {
  if (stats.calls === 0) return "no portal calls made";

  const rate = ((stats.resolved / stats.calls) * 100).toFixed(1);
  const loadsPerCall = (stats.attempts / stats.calls).toFixed(2);
  const perChannel = Object.entries(stats.byChannel)
    .map(([channel, s]) => `${channel} ${s.resolved}/${s.calls}`)
    .join(", ");

  return (
    `${stats.resolved}/${stats.calls} portal calls resolved (${rate}%), ` +
    `${stats.noPrice} no price, ${stats.failed} failed; ` +
    `${stats.attempts} page loads for ${stats.calls} calls (${loadsPerCall}/call); ${perChannel}`
  );
}

/** Writes one probe's channel results onto the row being saved, and counts them. */
function applyResults(auditData: any, results: Record<string, ScrapeResult>, stats: RunStats): void {
  const errors: Record<string, string> = {};

  for (const [channel, result] of Object.entries(results)) {
    recordCall(stats, channel, result);
    auditData[`${channel}Price`] = result.price ? String(result.price) : null;
    auditData[`${channel}Status`] = result.status;
    if (result.error) errors[channel] = result.error;
  }

  // Why a channel produced no price, stored beside the row that lacks one. Until now
  // the reason existed only as a console line, so diagnosing a bad night meant reading
  // journalctl and hoping it had not rotated away.
  auditData.scrapeErrors = Object.keys(errors).length > 0 ? JSON.stringify(errors) : null;
}

// The guest count is a parameter rather than a literal so that every portal URL and
// the internal benchmark quote the same party size — see AUDIT_OCCUPANCY. The scraper
// reads it back off the URL to pick the matching occupancy tier on Booking.
const PORTAL_URLS = {
  Sadoles: {
    booking: (start: string, end: string, guests: number) => `https://www.booking.com/hotel/pl/sadoles-66.html?checkin=${start}&checkout=${end}&group_adults=${guests}`,
    airbnb: (start: string, end: string, guests: number) => `https://www.airbnb.com/rooms/39273784?check_in=${start}&check_out=${end}&adults=${guests}`,
    slowhop: (start: string, end: string, guests: number) => `https://slowhop.com/pl/miejsca/2256-sadoles-66.html?adults=${guests}&start_date=${start}&end_date=${end}`,
    alohacamp: (start: string, end: string, guests: number) => `https://alohacamp.com/pl/property/sadoles-66-4436?adults_count=${guests}&start=${start}&end=${end}`,
  },
  Hacjenda: {
    booking: (start: string, end: string, guests: number) => `https://www.booking.com/hotel/pl/hacienda-kiekrz.html?checkin=${start}&checkout=${end}&group_adults=${guests}`,
    airbnb: (start: string, end: string, guests: number) => `https://www.airbnb.com/rooms/1327633659929514853?check_in=${start}&check_out=${end}&adults=${guests}`,
    slowhop: (start: string, end: string, guests: number) => `https://slowhop.com/pl/miejsca/4575-hacjenda-kiekrz.html?adults=${guests}&start_date=${start}&end_date=${end}`,
  },
};

export class PricingAuditor {
  private static isRunning = false;

  static getIsRunning() {
    return this.isRunning;
  }

  static async checkPreconditions(property: "Sadoles" | "Hacjenda", checkIn: Date, checkOut: Date) {
    if (this.isRunning) {
      throw new Error("Audit already in progress");
    }

    // Check availability before starting
    const bookings = await BookingRepository.getAvailability(property);
    const isTaken = bookings.some(b => {
      const bIn = startOfDay(new Date(b.checkIn));
      const bOut = startOfDay(new Date(b.checkOut));
      return isBefore(checkIn, bOut) && isAfter(checkOut, bIn);
    });

    if (isTaken) {
      throw new Error("Selected dates are already booked");
    }
  }

  static async runManualAudit(property: "Sadoles" | "Hacjenda", checkIn: Date, checkOut: Date) {
    await this.checkPreconditions(property, checkIn, checkOut);

    this.isRunning = true;
    console.log(`[PricingAuditor] Starting manual audit for ${property}: ${format(checkIn, "yyyy-MM-dd")} to ${format(checkOut, "yyyy-MM-dd")}...`);
    const start = Date.now();
    const stats = emptyRunStats();

    try {
      const auditData: any = {
        property,
        checkIn,
        checkOut,
        isMinStayTest: 0,
        dateScraped: new Date(),
      };

      const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
      const targets = this.portalTargets(property, checkIn, checkOut);
      const results = await this.scrapeChannels(property, targets, nights);

      applyResults(auditData, results, stats);

      await PricingAuditRepository.saveAudit(auditData);
      
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: true,
        durationMs: Date.now() - start,
        errorMessage: `Manual probe completed for ${property}; ${summariseRun(stats)}`,
      });
      
    } catch (error) {
      console.error("[PricingAuditor] Manual audit failed:", error);
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: false,
        durationMs: Date.now() - start,
        errorMessage: `Manual: ${(error as Error).message}`,
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  static async runDailyAudit() {
    if (this.isRunning) {
      console.warn("[PricingAuditor] Audit already in progress, skipping daily trigger.");
      return;
    }

    // The one night this auditor recorded nothing but errors — 12 Aug 2026, 37 failed
    // calls — was the last run scheduled at 03:00, inside the window where the router
    // renews its lease and the mesh is down. It has since moved to 04:00, but nothing
    // stopped a future reschedule from putting it back, so refuse rather than spend ten
    // minutes retrying against a dead route.
    if (isNetworkMaintenanceWindow()) {
      console.warn("[PricingAuditor] Skipping: inside the router/mesh maintenance window.");
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: false,
        durationMs: 0,
        errorMessage: "Skipped: started inside the router/mesh maintenance window (02:50–03:20)",
      });
      return;
    }

    this.isRunning = true;

    console.log("[PricingAuditor] Starting daily audit...");
    const start = Date.now();
    let probesCount = 0;
    const stats = emptyRunStats();

    try {
      const properties: ("Sadoles" | "Hacjenda")[] = ["Sadoles", "Hacjenda"];

      // Every range this run has already written, as `property|checkIn|checkOut`.
      // `getRecentAudit` reads what is committed, so it cannot see a probe made
      // moments ago in this same run — two candidate sources landing on one range
      // used to probe it twice and store two identical rows.
      const probedThisRun = new Set<string>();
      const rangeKey = (property: string, checkIn: Date, checkOut: Date) =>
        `${property}|${format(checkIn, "yyyy-MM-dd")}|${format(checkOut, "yyyy-MM-dd")}`;

      // Shuffle properties to avoid bias if we hit total limit
      const shuffledProperties = [...properties].sort(() => Math.random() - 0.5);

      for (const property of shuffledProperties) {
        let propertyProbes = 0;
        
        const availability = await BookingRepository.getAvailability(property);
        const isAvailable = (start: Date, end: Date) => {
          return !availability.some(b => {
            const bIn = startOfDay(new Date(b.checkIn));
            const bOut = startOfDay(new Date(b.checkOut));
            return isBefore(start, bOut) && isAfter(end, bIn);
          });
        };

        // Candidates are generated fresh each run (these already use isAvailable internally).
        //
        // Re-probing whatever last came back "red" used to take priority over them, on the
        // theory that a red result is worth confirming. In practice a range goes red for
        // reasons a re-probe cannot settle — a portal genuinely priced differently, a channel
        // that does not enforce our minimum stay — so the same handful of ranges were re-probed
        // every night and never cleared, crowding new dates out of a ten-probe budget. Coverage
        // is worth more than confirmation here: probe each range once, then move on and let the
        // dashboard show the colour.
        const candidates = await this.generateCandidateDates(property);

        for (const { checkIn, checkOut, isMinStayTest } of candidates) {
          if (probesCount >= MAX_PROBES_PER_DAY) break;
          if (propertyProbes >= MAX_PROBES_PER_PROPERTY) break;

          const key = rangeKey(property, checkIn, checkOut);
          if (probedThisRun.has(key)) continue;

          // Anything probed in the last fortnight is skipped regardless of its result, so the
          // budget keeps rotating onto ranges that have no recent reading at all.
          const recentAudit = await PricingAuditRepository.getRecentAudit(property, checkIn, checkOut);
          if (recentAudit) continue;

          // A min-stay test asks whether the portals refuse a one-night stay. It needs no
          // benchmark — there is no price to compare, and demanding one would drop exactly
          // those dates whose minimum we most want tested, since our own pricing declines
          // to quote them.
          let benchmark: number | undefined;
          if (!isMinStayTest) {
            try {
              benchmark = await PricingService.getBenchmarkPrice(property, checkIn, checkOut);
            } catch (e) {
              // Nothing to compare a portal price against — skip rather than invent one.
              continue;
            }
          }

          console.log(`[PricingAuditor] Probing ${property}: ${format(checkIn, "yyyy-MM-dd")} to ${format(checkOut, "yyyy-MM-dd")} (Benchmark: ${benchmark ?? "n/a"}, MinStayTest: ${isMinStayTest})`);
          
          const auditData: any = {
            property,
            checkIn,
            checkOut,
            isMinStayTest: isMinStayTest ? 1 : 0,
            dateScraped: new Date(),
          };

          const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
          const targets = this.portalTargets(property, checkIn, checkOut);
          const results = await this.scrapeChannels(property, targets, nights);

          applyResults(auditData, results, stats);

          await PricingAuditRepository.saveAudit(auditData);
          probedThisRun.add(key);
          probesCount++;
          propertyProbes++;

          // Longer delay between probes (different dates)
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
      
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: true,
        durationMs: Date.now() - start,
        errorMessage: `Completed ${probesCount} probes; ${summariseRun(stats)}`,
      });
      console.log(`[PricingAuditor] Run health: ${summariseRun(stats)}`);

    } catch (error) {
      console.error("[PricingAuditor] Audit failed:", error);
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: false,
        durationMs: Date.now() - start,
        errorMessage: (error as Error).message,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /** Every portal URL for one stay, at the audited party size. */
  private static portalTargets(property: "Sadoles" | "Hacjenda", checkIn: Date, checkOut: Date) {
    const start = format(checkIn, "yyyy-MM-dd");
    const end = format(checkOut, "yyyy-MM-dd");
    return Object.keys(PORTAL_URLS[property]).map(channel => ({
      channel,
      url: (PORTAL_URLS[property] as any)[channel](start, end, AUDIT_OCCUPANCY[property]),
    }));
  }

  /**
   * Scrape every channel of one probe, retrying the ones that did not answer.
   *
   * A single page load is unreliable: the booking panel may not render in time, or a
   * portal may serve a challenge. Only unanswered channels are re-tried. Both a price
   * and an explicit SOLD_OUT are answers and are taken as they come — a page that failed
   * to render now reports NO_PRICE rather than passing itself off as unavailability, so
   * there is nothing left for a second opinion on SOLD_OUT to protect against, and the
   * min-stay tests stop spending three page loads per channel to confirm a refusal.
   *
   * The whole batch shares one browser per attempt. Launching Chromium once per channel
   * meant forty-odd launches a night, each one both a delay and a chance to fail.
   */
  private static async scrapeChannels(
    property: string,
    targets: { channel: string; url: string }[],
    nights: number
  ): Promise<Record<string, ScrapeResult>> {
    const results: Record<string, ScrapeResult> = {};
    const attemptsUsed: Record<string, number> = {};
    const sawUnresolved: Record<string, boolean> = {};

    let pending = targets;

    for (let attempt = 1; attempt <= SCRAPE_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = await this.scrapeBatchOnce(property, pending, nights);
      const retry: { channel: string; url: string }[] = [];

      for (const target of pending) {
        const result = batch[target.channel] ?? {
          price: null,
          status: "ERROR",
          error: "channel missing from batch response",
        };

        attemptsUsed[target.channel] = attempt;
        results[target.channel] = result;

        if (result.status === "OK" && result.price) continue;
        if (result.status === "SOLD_OUT") continue;

        sawUnresolved[target.channel] = true;
        retry.push(target);
      }

      pending = retry;

      if (pending.length > 0 && attempt < SCRAPE_ATTEMPTS) {
        console.warn(
          `[PricingAuditor] retrying ${pending.map(t => `${t.channel}=${results[t.channel].status}`).join(", ")} ` +
          `(attempt ${attempt}/${SCRAPE_ATTEMPTS})`
        );
        await new Promise(resolve => setTimeout(resolve, SCRAPE_RETRY_DELAY_MS));
      }
    }

    for (const target of targets) {
      const channel = target.channel;
      const result = results[channel];

      // Only report SOLD_OUT when every attempt agreed. A run that saw an error or an
      // unreadable page in between was unhealthy, and saying "these dates are taken" on
      // that basis is the claim that made a broken parser look like a full calendar.
      if (result.status === "SOLD_OUT" && sawUnresolved[channel]) {
        results[channel] = {
          price: null,
          status: "ERROR",
          error: "inconsistent probes (SOLD_OUT mixed with an unresolved attempt)",
        };
      }

      results[channel] = { ...results[channel], attempts: attemptsUsed[channel] ?? 0 };
    }

    return results;
  }

  /** One browser, every pending channel. Never throws — failures come back per channel. */
  private static async scrapeBatchOnce(
    property: string,
    targets: { channel: string; url: string }[],
    nights: number
  ): Promise<Record<string, ScrapeResult>> {
    // Heuristic: Min price for a house must be at least the cleaning fee + some nightly rate.
    // Sadoles cleaning: 900, Hacjenda: 700.
    const cleaningFee = property === "Sadoles" ? 900 : 700;
    const minNightly = property === "Sadoles" ? 500 : 300;
    const minPrice = cleaningFee + (minNightly * nights);

    const job = Buffer.from(JSON.stringify({ minPrice, nights, targets })).toString("base64");

    try {
      const { stdout } = await execAsync(
        `${PYTHON_VENV_PATH} ${HELPER_SCRIPT_PATH} --batch ${job}`,
        { maxBuffer: 8 * 1024 * 1024 }
      );
      return JSON.parse(stdout);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[PricingAuditor] Batch scrape failed for ${property}:`, message);
      return Object.fromEntries(
        targets.map(t => [t.channel, { price: null, status: "ERROR", error: message.slice(0, 200) }])
      );
    }
  }

  private static async generateCandidateDates(property: "Sadoles" | "Hacjenda") {
    const candidates: { checkIn: Date; checkOut: Date; isMinStayTest: boolean; priority: number }[] = [];
    const today = startOfDay(new Date());
    const bookings = await BookingRepository.getAvailability(property);
    
    // Helper to check if a range is unbooked
    const isAvailable = (start: Date, end: Date) => {
      return !bookings.some(b => {
        const bIn = startOfDay(new Date(b.checkIn));
        const bOut = startOfDay(new Date(b.checkOut));
        return isBefore(start, bOut) && isAfter(end, bIn);
      });
    };

    // Helper to set standard hours (16:00 check-in, 10:00 check-out)
    const withStandardHours = (checkIn: Date, checkOut: Date) => {
      const cin = new Date(checkIn);
      cin.setHours(16, 0, 0, 0);
      const cout = new Date(checkOut);
      cout.setHours(10, 0, 0, 0);
      return { checkIn: cin, checkOut: cout };
    };

    // 1. Holidays (Priority 1)
    for (const hStr of HOLIDAYS) {
      const hDate = startOfDay(new Date(hStr));
      if (isAfter(hDate, today)) {
        const checkOut = addDays(hDate, 3);
        if (isAvailable(hDate, checkOut)) {
          const dates = withStandardHours(hDate, checkOut);
          candidates.push({ ...dates, isMinStayTest: false, priority: 1 });
        }
      }
    }

    // 2. Weekends (Friday to Sunday) (Priority 2)
    for (let i = 1; i <= 60; i++) {
      const d = addDays(today, i);
      if (format(d, "i") === "5") { // Friday
        const checkOut = addDays(d, 2); // Sunday
        if (isAvailable(d, checkOut)) {
          const dates = withStandardHours(d, checkOut);
          candidates.push({ ...dates, isMinStayTest: false, priority: 2 });
        }
      }
    }

    // 3. Min Stay Tests (Priority 3)
    for (let i = 7; i <= 90; i += 7) {
      const d = addDays(today, i);
      const checkOut = addDays(d, 1);
      if (isAvailable(d, checkOut)) {
        const dates = withStandardHours(d, checkOut);
        candidates.push({ ...dates, isMinStayTest: true, priority: 3 });
      }
    }

    // 4. Random Wildcards (Priority 4)
    for (let i = 0; i < WILDCARD_CANDIDATES; i++) {
      const d = addDays(today, Math.floor(Math.random() * 180) + 7);
      const duration = Math.floor(Math.random() * 3) + 2;
      const checkOut = addDays(d, duration);
      if (isAvailable(d, checkOut)) {
        const dates = withStandardHours(d, checkOut);
        candidates.push({ ...dates, isMinStayTest: false, priority: 4 });
      }
    }

    // Sort by priority, then randomize within same priority
    return candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return Math.random() - 0.5;
    });
  }
}
