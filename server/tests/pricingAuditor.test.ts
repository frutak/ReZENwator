import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PricingAuditor } from "../workers/pricingAuditor";
import { PricingAuditRepository } from "../repositories/PricingAuditRepository";
import { BookingRepository } from "../repositories/BookingRepository";
import { PricingService } from "../services/PricingService";
import { Logger } from "../_core/logger";
import { isNetworkMaintenanceWindow } from "../_core/maintenanceWindow";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/logger", () => ({ Logger: { system: vi.fn() } }));

// Pinned false by default: the guard reads the real clock, and a suite that happened
// to run at 03:00 Warsaw would otherwise skip every audit and fail at random.
vi.mock("../_core/maintenanceWindow", () => ({ isNetworkMaintenanceWindow: vi.fn(() => false) }));

// scrapeChannels, scrapeBatchOnce and generateCandidateDates are private; reach them
// the way the worker does.
const auditor = PricingAuditor as any;

const OK = { price: 3402, status: "OK" };
const SOLD_OUT = { price: null, status: "SOLD_OUT" };
const NO_PRICE = { price: null, status: "NO_PRICE", error: "no availability marker and no readable price" };
const ERROR = { price: null, status: "ERROR", error: "boom" };

describe("PricingAuditor.scrapeChannels retries", () => {
  let batches: string[][];

  /** Serve a scripted result per attempt; the last entry repeats. */
  const stubBatches = (perAttempt: Record<string, any>[]) => {
    batches = [];
    vi.spyOn(auditor, "scrapeBatchOnce").mockImplementation(async (...args: any[]) => {
      const targets = args[1] as { channel: string }[];
      const scripted = perAttempt[batches.length] ?? perAttempt[perAttempt.length - 1];
      batches.push(targets.map(t => t.channel));
      return Object.fromEntries(targets.map(t => [t.channel, scripted[t.channel]]));
    });
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const run = async (channels = ["booking", "airbnb"]) => {
    const targets = channels.map(channel => ({ channel, url: `http://x/${channel}` }));
    const pending = auditor.scrapeChannels("Sadoles", targets, 3);
    await vi.runAllTimersAsync();
    return pending;
  };

  it("returns a price without probing again", async () => {
    stubBatches([{ booking: OK, airbnb: OK }]);
    const results = await run();
    expect(results.booking).toEqual({ ...OK, attempts: 1 });
    expect(batches).toHaveLength(1);
  });

  it("retries only the channels that did not answer", async () => {
    stubBatches([
      { booking: OK, airbnb: NO_PRICE },
      { airbnb: OK },
    ]);

    const results = await run();

    expect(batches).toEqual([["booking", "airbnb"], ["airbnb"]]);
    expect(results.booking).toEqual({ ...OK, attempts: 1 });
    expect(results.airbnb).toEqual({ ...OK, attempts: 2 });
  });

  it("takes an explicit SOLD_OUT at face value, without re-probing", async () => {
    // The page said the dates are unavailable. That is an answer; a page that merely
    // failed to render says NO_PRICE instead, so there is nothing to second-guess.
    stubBatches([{ booking: SOLD_OUT, airbnb: SOLD_OUT }]);
    const results = await run();
    expect(results.booking).toEqual({ ...SOLD_OUT, attempts: 1 });
    expect(batches).toHaveLength(1);
  });

  it("will not call a stay sold out when an attempt failed to read the page", async () => {
    // The claim "these dates are taken" must not rest on a run that was partly blind.
    stubBatches([
      { booking: NO_PRICE, airbnb: OK },
      { booking: SOLD_OUT },
    ]);

    const results = await run();

    expect(results.booking.status).toBe("ERROR");
    expect(results.booking.error).toMatch(/inconsistent probes/);
  });

  it("propagates a consistent ERROR", async () => {
    stubBatches([{ booking: ERROR, airbnb: ERROR }]);
    const results = await run();
    expect(results.booking.status).toBe("ERROR");
    expect(results.booking.attempts).toBe(3);
  });

  it("keeps NO_PRICE distinct from SOLD_OUT when every attempt agrees", async () => {
    stubBatches([{ booking: NO_PRICE, airbnb: NO_PRICE }]);
    const results = await run();
    expect(results.booking.status).toBe("NO_PRICE");
  });
});

describe("PricingAuditor.runDailyAudit", () => {
  const range = (checkIn: string, checkOut: string) => ({
    checkIn: new Date(`${checkIn}T16:00:00`),
    checkOut: new Date(`${checkOut}T10:00:00`),
    isMinStayTest: false,
    priority: 1,
  });

  let saved: any[];
  let logged: string[];

  const arrange = (opts: {
    candidates?: any[];
    perChannel?: Record<string, any>;
    recentFor?: string[];
  } = {}) => {
    saved = [];
    logged = [];
    const candidates = opts.candidates ?? [range("2026-12-24", "2026-12-27")];
    const perChannel = opts.perChannel ?? {};
    const recentFor = opts.recentFor ?? [];

    vi.spyOn(auditor, "generateCandidateDates").mockResolvedValue(candidates);
    vi.spyOn(auditor, "scrapeBatchOnce").mockImplementation(async (...args: any[]) => {
      const targets = args[1] as { channel: string }[];
      return Object.fromEntries(
        targets.map(t => [t.channel, perChannel[t.channel] ?? { price: 3000, status: "OK" }])
      );
    });
    vi.spyOn(BookingRepository, "getAvailability").mockResolvedValue([] as any);
    vi.spyOn(PricingService, "getBenchmarkPrice").mockResolvedValue(3000);
    vi.spyOn(PricingAuditRepository, "saveAudit").mockImplementation(async (a: any) => {
      saved.push(a);
      return undefined as any;
    });
    vi.spyOn(PricingAuditRepository, "getRecentAudit").mockImplementation(async (_p, cIn) =>
      recentFor.includes(cIn.toISOString()) ? ({ id: 1 } as any) : null
    );
    vi.mocked(Logger.system).mockImplementation(async (...args: any[]) => {
      logged.push(args[1]?.errorMessage);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isNetworkMaintenanceWindow).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (PricingAuditor as any).isRunning = false;
  });

  const run = async () => {
    const pending = PricingAuditor.runDailyAudit();
    await vi.runAllTimersAsync();
    await pending;
    return logged.join("\n");
  };

  describe("probe selection", () => {
    it("probes a range once even when two candidates name the same dates", async () => {
      arrange({
        candidates: [
          range("2026-12-24", "2026-12-27"),
          range("2026-12-24", "2026-12-27"),
          range("2026-12-31", "2027-01-03"),
        ],
      });

      await run();

      const keys = saved.map(a => `${a.property}|${a.checkIn.toISOString()}`);
      expect(keys).toHaveLength(new Set(keys).size);
    });

    it("skips a range already probed in the last fortnight, whatever its result was", async () => {
      const stale = range("2026-12-24", "2026-12-27");
      arrange({
        candidates: [stale, range("2026-12-31", "2027-01-03")],
        recentFor: [stale.checkIn.toISOString()],
      });

      await run();

      expect(saved.every(a => !a.checkIn.toISOString().startsWith("2026-12-24"))).toBe(true);
      expect(saved.some(a => a.checkIn.toISOString().startsWith("2026-12-31"))).toBe(true);
    });

    it("honours the nightly ceiling of thirty probes", async () => {
      arrange({
        candidates: Array.from({ length: 20 }, (_, i) =>
          range(`2026-09-${String(i + 1).padStart(2, "0")}`, `2026-09-${String(i + 2).padStart(2, "0")}`)
        ),
      });

      await run();

      // 20 candidates per property, 18 at most per property, 30 in all.
      expect(saved).toHaveLength(30);
      expect(saved.filter(a => a.property === "Sadoles").length).toBeLessThanOrEqual(18);
      expect(saved.filter(a => a.property === "Hacjenda").length).toBeLessThanOrEqual(18);
    });
  });

  describe("maintenance window", () => {
    it("does not start inside the router/mesh window", async () => {
      arrange();
      vi.mocked(isNetworkMaintenanceWindow).mockReturnValue(true);

      const summary = await run();

      expect(saved).toHaveLength(0);
      expect(summary).toMatch(/maintenance window/);
    });
  });

  describe("run health accounting", () => {
    it("counts a clean run as fully resolved", async () => {
      arrange();
      const summary = await run();
      // Sadoles has four channels, Hacjenda three: seven calls over the two properties.
      expect(summary).toContain("7/7 portal calls resolved (100.0%)");
      expect(summary).toContain("0 no price, 0 failed");
      expect(summary).toContain("(1.00/call)");
    });

    it("counts an errored channel as unresolved and reports it per channel", async () => {
      arrange({ perChannel: { airbnb: ERROR } });
      const summary = await run();
      expect(summary).toContain("5/7 portal calls resolved (71.4%)");
      expect(summary).toContain("0 no price, 2 failed");
      expect(summary).toContain("airbnb 0/2");
      expect(summary).toContain("booking 2/2");
    });

    it("counts NO_PRICE as unresolved, separately from an outright failure", async () => {
      arrange({ perChannel: { slowhop: NO_PRICE } });
      const summary = await run();
      expect(summary).toContain("5/7 portal calls resolved (71.4%)");
      expect(summary).toContain("2 no price, 0 failed");
    });

    it("counts SOLD_OUT as an answer, not a failure", async () => {
      arrange({ perChannel: { slowhop: SOLD_OUT } });
      const summary = await run();
      expect(summary).toContain("7/7 portal calls resolved (100.0%)");
      // Retries still show up as page loads, which is how instability stays visible.
      expect(summary).toContain("page loads for 7 calls");
    });
  });

  describe("what gets stored", () => {
    it("keeps the reason a channel gave no price", async () => {
      arrange({ perChannel: { airbnb: ERROR } });

      await run();

      const errors = JSON.parse(saved[0].scrapeErrors);
      expect(errors.airbnb).toBe("boom");
    });

    it("stores nothing when every channel answered", async () => {
      arrange();
      await run();
      expect(saved[0].scrapeErrors).toBeNull();
    });
  });
});
