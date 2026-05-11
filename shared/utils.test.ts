import { describe, it, expect } from "vitest";
import { normalizeBookingDates, calculateTotalGuests, normalizeDecimalFields } from "./utils";

describe("shared/utils", () => {
  describe("normalizeBookingDates", () => {
    it("should set midnight check-in to 16:00 and check-out to 10:00", () => {
      const cin = new Date(2026, 5, 1, 0, 0, 0);
      const cout = new Date(2026, 5, 3, 0, 0, 0);
      const { checkIn, checkOut } = normalizeBookingDates(cin, cout);
      
      expect(checkIn.getHours()).toBe(16);
      expect(checkOut.getHours()).toBe(10);
    });

    it("should not change times if they are not midnight", () => {
      const cin = new Date(2026, 5, 1, 14, 0, 0);
      const cout = new Date(2026, 5, 3, 11, 0, 0);
      const { checkIn, checkOut } = normalizeBookingDates(cin, cout);
      
      expect(checkIn.getHours()).toBe(14);
      expect(checkOut.getHours()).toBe(11);
    });
  });

  describe("calculateTotalGuests", () => {
    it("should sum adults and children", () => {
      expect(calculateTotalGuests(1, 2, 2)).toBe(4);
    });

    it("should fallback to guestCount if adults/children are 0", () => {
      expect(calculateTotalGuests(3, 0, 0)).toBe(3);
    });

    it("should default to 1 if everything is 0 or undefined", () => {
      expect(calculateTotalGuests()).toBe(1);
    });
  });

  describe("normalizeDecimalFields", () => {
    it("should convert empty strings to null for specific fields", () => {
      const input = {
        totalPrice: "",
        commission: "100.00",
        hostRevenue: "",
        other: ""
      };
      const output = normalizeDecimalFields(input);
      
      expect(output.totalPrice).toBeNull();
      expect(output.commission).toBe("100.00");
      expect(output.hostRevenue).toBeNull();
      expect(output.other).toBe("");
    });
  });
});
