import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PricingAuditor } from "../workers/pricingAuditor";
import { PricingAuditRepository } from "../repositories/PricingAuditRepository";
import { BookingRepository } from "../repositories/BookingRepository";
import { PricingService } from "../services/PricingService";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/logger", () => ({ Logger: { system: vi.fn() } }));

// scrapeWithPlaywright and generateCandidateDates are private; reach them the way the worker does.
const auditor = PricingAuditor as any;

describe("PricingAuditor.scrapeWithPlaywright retries", () => {
  let attempts: any[];

  const stubProbe = (results: any[]) => {
    attempts = [];
    vi.spyOn(auditor, "scrapeOnce").mockImplementation(async () => {
      const r = results[attempts.length] ?? results[results.length - 1];
      attempts.push(r);
      return r;
    });
  };

  const OK = { price: 3402, status: "OK" };
  const SOLD_OUT = { price: null, status: "SOLD_OUT" };
  const ERROR = { price: null, status: "ERROR", error: "boom" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Drive the retry backoff with fake timers so the test does not wait out the real delay.
  const run = async () => {
    const pending = auditor.scrapeWithPlaywright("Sadoles", "airbnb", "http://x", 3, 3000);
    await vi.runAllTimersAsync();
    return pending;
  };

  it("returns the first OK without further probes", async () => {
    stubProbe([OK, SOLD_OUT, SOLD_OUT]);
    await expect(run()).resolves.toEqual(OK);
    expect(attempts).toHaveLength(1);
  });

  it("recovers a flaky SOLD_OUT when a later attempt finds a price", async () => {
    stubProbe([SOLD_OUT, OK]);
    await expect(run()).resolves.toEqual(OK);
    expect(attempts).toHaveLength(2);
  });

  it("reports SOLD_OUT only when every attempt agrees", async () => {
    stubProbe([SOLD_OUT, SOLD_OUT, SOLD_OUT]);
    await expect(run()).resolves.toEqual(SOLD_OUT);
    expect(attempts).toHaveLength(3);
  });

  it("reports ERROR rather than SOLD_OUT when the probes disagreed", async () => {
    stubProbe([ERROR, SOLD_OUT, SOLD_OUT]);
    const result = await run();
    expect(result.status).toBe("ERROR");
    expect(result.price).toBeNull();
  });

  it("propagates a consistent ERROR", async () => {
    stubProbe([ERROR, ERROR, ERROR]);
    const result = await run();
    expect(result.status).toBe("ERROR");
  });
});

describe("PricingAuditor.runDailyAudit probe selection", () => {
  const range = (checkIn: string, checkOut: string, isMinStayTest = false) => ({
    checkIn: new Date(`${checkIn}T16:00:00`),
    checkOut: new Date(`${checkOut}T10:00:00`),
    isMinStayTest,
    priority: 1,
  });

  let saved: any[];

  const arrange = (candidates: any[], recentFor: string[] = []) => {
    saved = [];
    vi.spyOn(auditor, "generateCandidateDates").mockResolvedValue(candidates);
    vi.spyOn(auditor, "scrapeWithPlaywright").mockResolvedValue({ price: 3000, status: "OK" });
    vi.spyOn(BookingRepository, "getAvailability").mockResolvedValue([] as any);
    vi.spyOn(PricingService, "getBenchmarkPrice").mockResolvedValue(3000);
    vi.spyOn(PricingAuditRepository, "saveAudit").mockImplementation(async (a: any) => {
      saved.push(a);
      return undefined as any;
    });
    vi.spyOn(PricingAuditRepository, "getRecentAudit").mockImplementation(async (_p, cIn) =>
      recentFor.includes(cIn.toISOString()) ? ({ id: 1 } as any) : null
    );
  };

  const probedRanges = () =>
    saved.map(a => `${a.property}|${a.checkIn.toISOString()}|${a.checkOut.toISOString()}`);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (PricingAuditor as any).isRunning = false;
  });

  const run = async () => {
    const pending = PricingAuditor.runDailyAudit();
    await vi.runAllTimersAsync();
    return pending;
  };

  it("probes a range once even when two candidates name the same dates", async () => {
    // The holiday rule and a wildcard can land on the same stay; before the dedupe
    // both were probed and two identical rows were written.
    arrange([
      range("2026-12-24", "2026-12-27"),
      range("2026-12-24", "2026-12-27"),
      range("2026-12-31", "2027-01-03"),
    ]);

    await run();

    expect(probedRanges()).toHaveLength(new Set(probedRanges()).size);
    const christmas = saved.filter(a => a.checkIn.toISOString().startsWith("2026-12-24"));
    expect(christmas).toHaveLength(2); // once per property, never twice for one
    expect(new Set(christmas.map(a => a.property)).size).toBe(2);
  });

  it("skips a range already probed in the last fortnight, whatever its result was", async () => {
    const stale = range("2026-12-24", "2026-12-27");
    arrange([stale, range("2026-12-31", "2027-01-03")], [stale.checkIn.toISOString()]);

    await run();

    expect(saved.every(a => !a.checkIn.toISOString().startsWith("2026-12-24"))).toBe(true);
    expect(saved.some(a => a.checkIn.toISOString().startsWith("2026-12-31"))).toBe(true);
  });

  it("honours the ten-probe ceiling", async () => {
    arrange(Array.from({ length: 20 }, (_, i) =>
      range(`2026-09-${String(i + 1).padStart(2, "0")}`, `2026-09-${String(i + 2).padStart(2, "0")}`)
    ));

    await run();

    expect(saved).toHaveLength(10);
  });
});
