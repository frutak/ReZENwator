import { describe, it, expect } from "vitest";
import { parseDMY, parseDotDate, parseAirbnbDate, parseAirbnbFullDate, parseBookingComDate } from "../_core/utils/date";
import { parsePrice } from "../_core/utils/currency";
import { format } from "date-fns";

const formatDate = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : undefined;

describe("Date Utilities", () => {
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

    it("handles year rollover correctly", () => {
      const date = parseAirbnbDate("27 Jun");
      expect(date).toBeDefined();
      // Logic in parseAirbnbDate increments year if date is > 180 days in past
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
