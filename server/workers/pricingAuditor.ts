import { exec } from "child_process";
import { promisify } from "util";
import { BookingRepository } from "../repositories/BookingRepository";
import { PricingAuditRepository } from "../repositories/PricingAuditRepository";
import { Logger } from "../_core/logger";
import { PricingService } from "../services/PricingService";
import { addDays, format, isAfter, isBefore, startOfDay } from "date-fns";

const execAsync = promisify(exec);

const MAX_PROBES_PER_DAY = 10;
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
}

const PORTAL_URLS = {
  Sadoles: {
    booking: (start: string, end: string) => `https://www.booking.com/hotel/pl/sadoles-66.html?checkin=${start}&checkout=${end}&group_adults=11`,
    airbnb: (start: string, end: string) => `https://www.airbnb.com/rooms/39273784?check_in=${start}&check_out=${end}&adults=11`,
    slowhop: (start: string, end: string) => `https://slowhop.com/pl/miejsca/2256-sadoles-66.html?adults=11&start_date=${start}&end_date=${end}`,
    alohacamp: (start: string, end: string) => `https://alohacamp.com/pl/property/sadoles-66-4436?adults_count=11&start=${start}&end=${end}`,
  },
  Hacjenda: {
    booking: (start: string, end: string) => `https://www.booking.com/hotel/pl/hacienda-kiekrz.html?checkin=${start}&checkout=${end}&group_adults=4`,
    airbnb: (start: string, end: string) => `https://www.airbnb.com/rooms/1327633659929514853?check_in=${start}&check_out=${end}&adults=4`,
    slowhop: (start: string, end: string) => `https://slowhop.com/pl/miejsca/4575-hacjenda-kiekrz.html?adults=4&start_date=${start}&end_date=${end}`,
  },
};

export class PricingAuditor {
  private static isRunning = false;

  static async runManualAudit(property: "Sadoles" | "Hacjenda", checkIn: Date, checkOut: Date) {
    if (this.isRunning) {
      console.warn("[PricingAuditor] Audit already in progress, skipping manual trigger.");
      return;
    }
    this.isRunning = true;
    
    console.log(`[PricingAuditor] Starting manual audit for ${property}: ${format(checkIn, "yyyy-MM-dd")} to ${format(checkOut, "yyyy-MM-dd")}...`);
    const start = Date.now();

    try {
      const benchmark = await PricingService.getBenchmarkPrice(property, checkIn, checkOut);
      
      const auditData: any = {
        property,
        checkIn,
        checkOut,
        isMinStayTest: 0,
        dateScraped: new Date(),
      };

      const channels = Object.keys(PORTAL_URLS[property]);
      const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));

      for (const channel of channels) {
        const url = (PORTAL_URLS[property] as any)[channel](format(checkIn, "yyyy-MM-dd"), format(checkOut, "yyyy-MM-dd"));
        const result = await this.scrapeWithPlaywright(property, channel, url, nights, benchmark);
        
        auditData[`${channel}Price`] = result.price ? String(result.price) : null;
        auditData[`${channel}Status`] = result.status;
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      await PricingAuditRepository.saveAudit(auditData);
      
      await Logger.system("ical", {
        source: "Pricing Auditor",
        success: true,
        durationMs: Date.now() - start,
        errorMessage: `Manual probe completed for ${property}`,
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
    this.isRunning = true;

    console.log("[PricingAuditor] Starting daily audit...");
    const start = Date.now();
    let probesCount = 0;

    try {
      const properties: ("Sadoles" | "Hacjenda")[] = ["Sadoles", "Hacjenda"];
      const MAX_PROBES = 10;
      
      // Get all recent audits to find "red" ones to re-probe
      const recentAuditEntries = await PricingAuditRepository.getRecentAuditEntries(14);
      
      // Shuffle properties to avoid bias if we hit total limit
      const shuffledProperties = [...properties].sort(() => Math.random() - 0.5);
      
      for (const property of shuffledProperties) {
        let propertyProbes = 0;
        // We want roughly 5 per property, but can go up to 10 if needed to hit the total
        const MAX_PER_PROPERTY = 7; 
        
        // Generate standard candidates
        const standardCandidates = await this.generateCandidateDates(property);
        
        // Find "red" audits for this property to prioritize
        const redAuditsForProperty = [];
        const processedRanges = new Set<string>();

        for (const audit of recentAuditEntries) {
          if (audit.property !== property) continue;
          const rangeKey = `${format(audit.checkIn, "yyyy-MM-dd")}_${format(audit.checkOut, "yyyy-MM-dd")}`;
          if (processedRanges.has(rangeKey)) continue;
          processedRanges.add(rangeKey);

          try {
            const benchmark = await PricingService.getBenchmarkPrice(property, audit.checkIn, audit.checkOut);
            if (!this.isGreenAudit(audit, benchmark)) {
              redAuditsForProperty.push({
                checkIn: audit.checkIn,
                checkOut: audit.checkOut,
                isMinStayTest: !!audit.isMinStayTest
              });
            }
          } catch (e) {
            // If we can't calculate benchmark for old audit (e.g. price missing now), just skip it
            console.warn(`[PricingAuditor] Could not calculate benchmark for historical audit ${property} ${rangeKey}:`, (e as Error).message);
          }
        }

        // Prioritize up to 3 red audits, then follow with standard candidates
        const prioritisedReds = redAuditsForProperty.slice(0, 3);
        const candidates = [...prioritisedReds, ...standardCandidates];
        
        for (const { checkIn, checkOut, isMinStayTest } of candidates) {
          if (probesCount >= MAX_PROBES) break;
          if (propertyProbes >= MAX_PER_PROPERTY) break;

          const recentAudit = await PricingAuditRepository.getRecentAudit(property, checkIn, checkOut);
          
          let benchmark: number;
          try {
            benchmark = await PricingService.getBenchmarkPrice(property, checkIn, checkOut);
          } catch (e) {
            // Skip candidate if pricing is missing
            continue;
          }

          // If this was a prioritized RED audit, we definitely want to probe it again.
          // Otherwise, we check if the most recent audit is already "green".
          if (recentAudit && this.isGreenAudit(recentAudit, benchmark)) {
            continue;
          }

          console.log(`[PricingAuditor] Probing ${property}: ${format(checkIn, "yyyy-MM-dd")} to ${format(checkOut, "yyyy-MM-dd")} (Benchmark: ${benchmark}, MinStayTest: ${isMinStayTest})`);
          
          const auditData: any = {
            property,
            checkIn,
            checkOut,
            isMinStayTest: isMinStayTest ? 1 : 0,
            dateScraped: new Date(),
          };

          const channels = Object.keys(PORTAL_URLS[property]);
          const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));

          // Run channels sequentially to avoid being blocked or having dynamic content fail to load
          for (const channel of channels) {
            const url = (PORTAL_URLS[property] as any)[channel](format(checkIn, "yyyy-MM-dd"), format(checkOut, "yyyy-MM-dd"));
            const result = await this.scrapeWithPlaywright(property, channel, url, nights, benchmark);
            
            auditData[`${channel}Price`] = result.price ? String(result.price) : null;
            auditData[`${channel}Status`] = result.status;
            
            // Short delay between channels for same date
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          await PricingAuditRepository.saveAudit(auditData);
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
        errorMessage: `Completed ${probesCount} probes`,
      });
      
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

  private static isGreenAudit(audit: any, benchmark: number): boolean {
    const channels = ["booking", "airbnb", "slowhop", "alohacamp"];
    let anyOk = false;

    for (const chan of channels) {
      const priceStr = audit[`${chan}Price` as keyof typeof audit];
      const status = audit[`${chan}Status` as keyof typeof audit];
      if (status === "OK" && priceStr) {
        anyOk = true;
        const price = parseFloat(String(priceStr));
        const deviation = Math.abs((price - benchmark) / benchmark);
        if (deviation > 0.15) return false; // Red status if any channel deviates > 15%
      }
    }

    return anyOk; // Only skip if we have at least one valid probe AND all were within 15%
  }

  private static async scrapeWithPlaywright(property: string, channel: string, url: string, nights: number, benchmark?: number): Promise<ScrapeResult> {
    try {
      // Heuristic: Min price for a house must be at least the cleaning fee + some nightly rate.
      // Sadoles cleaning: 900, Hacjenda: 700.
      const cleaningFee = property === "Sadoles" ? 900 : 700;
      const minNightly = property === "Sadoles" ? 700 : 300;
      const minPrice = cleaningFee + (minNightly * nights);
      
      const benchmarkArg = benchmark ? ` "${benchmark}"` : "";
      const { stdout } = await execAsync(`${PYTHON_VENV_PATH} ${HELPER_SCRIPT_PATH} "${channel}" "${url}" "${minPrice}"${benchmarkArg} "${nights}"`);
      return JSON.parse(stdout);
    } catch (err) {
      console.error(`[PricingAuditor] Scrape failed for ${channel}:`, (err as Error).message);
      return { price: null, status: "ERROR", error: (err as Error).message };
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
    for (let i = 0; i < 20; i++) {
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
