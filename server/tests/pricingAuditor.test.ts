import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PricingAuditor } from "../workers/pricingAuditor";

vi.mock("../db", () => ({ getDb: vi.fn() }));

// isGreenAudit and scrapeWithPlaywright are private; reach them the way the worker does.
const auditor = PricingAuditor as any;

const audit = (over: Record<string, unknown> = {}) => ({
  isMinStayTest: 0,
  bookingPrice: null, bookingStatus: null,
  airbnbPrice: null, airbnbStatus: null,
  slowhopPrice: null, slowhopStatus: null,
  alohacampPrice: null, alohacampStatus: null,
  ...over,
});

describe("PricingAuditor.isGreenAudit", () => {
  const BENCHMARK = 3000;

  it("is green when every channel agrees within 15% of the benchmark", () => {
    const a = audit({
      bookingPrice: "3000", bookingStatus: "OK",
      airbnbPrice: "3100", airbnbStatus: "OK",
      slowhopPrice: "2900", slowhopStatus: "OK",
    });
    expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(true);
  });

  it("is red when a channel deviates more than 15%", () => {
    const a = audit({
      bookingPrice: "3000", bookingStatus: "OK",
      airbnbPrice: "4000", airbnbStatus: "OK",
    });
    expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(false);
  });

  it("is red when one channel is SOLD_OUT while another sells the same dates", () => {
    const a = audit({
      bookingPrice: "3000", bookingStatus: "OK",
      airbnbStatus: "SOLD_OUT",
      slowhopPrice: "2950", slowhopStatus: "OK",
    });
    expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(false);
  });

  it("ignores untracked channels (null status) when spotting anomalies", () => {
    // Hacjenda has no AlohaCamp listing, so alohacampStatus is always null.
    const a = audit({
      bookingPrice: "3000", bookingStatus: "OK",
      airbnbPrice: "3050", airbnbStatus: "OK",
      slowhopPrice: "2950", slowhopStatus: "OK",
      alohacampStatus: null,
    });
    expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(true);
  });

  describe("min-stay tests", () => {
    it("is GREEN when every channel refuses the 1-night stay (the test passed)", () => {
      const a = audit({
        isMinStayTest: 1,
        bookingStatus: "SOLD_OUT",
        airbnbStatus: "SOLD_OUT",
        slowhopStatus: "SOLD_OUT",
        alohacampStatus: "SOLD_OUT",
      });
      expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(true);
    });

    it("is green with untracked channels excluded", () => {
      const a = audit({
        isMinStayTest: 1,
        bookingStatus: "SOLD_OUT",
        airbnbStatus: "SOLD_OUT",
        slowhopStatus: "SOLD_OUT",
        alohacampStatus: null,
      });
      expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(true);
    });

    it("stays RED when a channel errored rather than refusing", () => {
      const a = audit({
        isMinStayTest: 1,
        bookingStatus: "SOLD_OUT",
        airbnbStatus: "ERROR",
        slowhopStatus: "SOLD_OUT",
      });
      expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(false);
    });

    it("stays RED when a channel actually sells the 1-night stay (minimum not enforced)", () => {
      const a = audit({
        isMinStayTest: 1,
        bookingPrice: "3000", bookingStatus: "OK",
        airbnbStatus: "SOLD_OUT",
        slowhopStatus: "SOLD_OUT",
      });
      expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(false);
    });

    it("does not green-light a non-min-stay probe that is sold out everywhere", () => {
      const a = audit({
        isMinStayTest: 0,
        bookingStatus: "SOLD_OUT",
        airbnbStatus: "SOLD_OUT",
        slowhopStatus: "SOLD_OUT",
      });
      expect(auditor.isGreenAudit(a, BENCHMARK)).toBe(false);
    });
  });
});

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
