import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDMY, parseDotDate, parseAirbnbDate, parseAirbnbFullDate, parseBookingComDate } from "../_core/utils/date";
import { parsePrice } from "../_core/utils/currency";
import { format } from "date-fns";

const formatDate = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : undefined;

describe("Date Utilities", () => {
  // Only the Airbnb cases below pin the clock; the rest are unaffected either
  // way, and leaving fake timers running would leak into the next file.
  afterEach(() => vi.useRealTimers());

  describe("parseDMY", () => {
    it("parses valid DMY dates with different separators", () => {
      expect(formatDate(parseDMY("28-03-2026"))).toBe("2026-03-28");
      expect(formatDate(parseDMY("01.04.2026"))).toBe("2026-04-01");
      expect(formatDate(parseDMY("15/12/2025"))).toBe("2025-12-15");
    });

    it("returns undefined for invalid formats", () => {
      expect(parseDMY("2026-03-28")).toBeUndefined();
      expect(parseDMY("not a date")).toBeUndefined();
    });
  });

  describe("parseDotDate", () => {
    it("parses valid dot-separated dates", () => {
      expect(formatDate(parseDotDate("02.03.2026"))).toBe("2026-03-02");
    });
  });

  describe("parseAirbnbDate", () => {
    it("parses Airbnb format 'Sat 27 Jun'", () => {
      const date = parseAirbnbDate("Sat 27 Jun");
      expect(date).toBeDefined();
      expect(date?.getMonth()).toBe(5); // June
      expect(date?.getDate()).toBe(27);
    });

    /**
     * Airbnb never puts a year on the stay dates — a confirmation says "Fri 3
     * Apr" and nothing else — so the year has to be inferred from when the mail
     * arrived. A date more than six months in the past is read as next year's,
     * on the reasoning that a confirmation is for a stay yet to happen.
     *
     * That makes the answer depend on today, which is worth stating plainly:
     * the same three words are 2026 in February and 2027 in October, and both
     * readings are right. The clock is pinned here for exactly that reason.
     * Fixtures that assert a full date for these mails are asserting the day
     * they were written down, and go off by a year as soon as it passes.
     */
    it("reads a year-less date as this year while the stay is still ahead", () => {
      vi.useFakeTimers().setSystemTime(new Date("2026-02-01T12:00:00"));
      expect(formatDate(parseAirbnbDate("Tue 10 Mar"))).toBe("2026-03-10");
    });

    it("rolls a year-less date forward once it is well past", () => {
      // The cutoff is 180 days after the date itself — for 10 March 2026 that
      // is 6 September. A day before, the stay is still read as this year's.
      vi.useFakeTimers().setSystemTime(new Date("2026-09-05T12:00:00"));
      expect(formatDate(parseAirbnbDate("Tue 10 Mar"))).toBe("2026-03-10");

      // A day after, the same words mean next March. This is the transition
      // that broke the Azra Yildiz fixture.
      vi.useFakeTimers().setSystemTime(new Date("2026-09-07T12:00:00"));
      expect(formatDate(parseAirbnbDate("Tue 10 Mar"))).toBe("2027-03-10");
    });

    it("keeps a stay that crosses New Year in order", () => {
      // The two dates are resolved independently, so this is where a year rule
      // gets caught being wrong: read both as the current year and checkout
      // lands eleven months before check-in.
      vi.useFakeTimers().setSystemTime(new Date("2026-12-20T12:00:00"));
      const checkIn = parseAirbnbDate("Wed 30 Dec")!;
      const checkOut = parseAirbnbDate("Sat 2 Jan")!;

      expect(formatDate(checkIn)).toBe("2026-12-30");
      expect(formatDate(checkOut)).toBe("2027-01-02");
      expect(checkOut.getTime()).toBeGreaterThan(checkIn.getTime());
    });

    it("parses Airbnb format with year 'Thu, 17 Jun 2027'", () => {
      const date = parseAirbnbDate("Thu, 17 Jun 2027");
      expect(date).toBeDefined();
      expect(date?.getFullYear()).toBe(2027);
      expect(date?.getMonth()).toBe(5); // June
      expect(date?.getDate()).toBe(17);
    });
  });

  describe("parseBookingComDate", () => {
    it("parses English formats", () => {
      expect(formatDate(parseBookingComDate("Fri, Mar 27, 2026"))).toBe("2026-03-27");
      expect(formatDate(parseBookingComDate("Mar 27, 2026"))).toBe("2026-03-27");
    });

    it("parses Polish formats", () => {
      expect(formatDate(parseBookingComDate("27 mar 2026"))).toBe("2026-03-27");
      expect(formatDate(parseBookingComDate("27 marzec 2026"))).toBe("2026-03-27");
      expect(formatDate(parseBookingComDate("śr., 27 mar 2026"))).toBe("2026-03-27");
    });
  });
});

describe("Currency Utilities", () => {
  describe("parsePrice", () => {
    it("parses simple integer prices", () => {
      expect(parsePrice("1800 PLN")).toEqual({ amount: 1800, currency: "PLN" });
      expect(parsePrice("2862 zł")).toEqual({ amount: 2862, currency: "PLN" });
    });

    it("handles EU style separators (dot as thousand, comma as decimal)", () => {
      expect(parsePrice("1.234,56")).toEqual({ amount: 1234.56, currency: "PLN" });
    });

    it("handles US style separators (comma as thousand, dot as decimal)", () => {
      expect(parsePrice("1,234.56")).toEqual({ amount: 1234.56, currency: "PLN" });
    });

    it("handles spaces as thousand separators", () => {
      expect(parsePrice("1 800,00 PLN")).toEqual({ amount: 1800, currency: "PLN" });
    });

    it("infers thousands vs decimals for ambiguous single separator", () => {
      // 1,600 (exactly 3 digits after) -> thousand
      expect(parsePrice("1,600")).toEqual({ amount: 1600, currency: "PLN" });
      // 123,45 (not 3 digits) -> decimal
      expect(parsePrice("123,45")).toEqual({ amount: 123.45, currency: "PLN" });
      // 1.600 -> thousand
      expect(parsePrice("1.600")).toEqual({ amount: 1600, currency: "PLN" });
      // 123.45 -> decimal
      expect(parsePrice("123.45")).toEqual({ amount: 123.45, currency: "PLN" });
    });

    it("returns undefined for invalid inputs", () => {
      expect(parsePrice("abc")).toBeUndefined();
      expect(parsePrice("")).toBeUndefined();
    });
  });
});
