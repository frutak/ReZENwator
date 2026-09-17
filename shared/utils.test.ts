import { describe, it, expect } from "vitest";
import { normalizeBookingDates, calculateTotalGuests, normalizeDecimalFields, calculateBalanceDue, calculateAmountsDue, bookingEarnings } from "./utils";

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

  describe("calculateBalanceDue", () => {
    // Booking #181: 2 nights × 900 + 900 cleaning = 2700 stay price, 675 zł
    // zaliczka the guest paid to Alohacamp, host commission 498.15, payout
    // 2201.85. The guest also pays an 84 zł service fee to the portal, which
    // never reaches the owner and is part of none of these amounts.
    //
    // The owner is still owed all of it, from three sources: 176.85 forwarded by
    // the portal (zaliczka − commission), 2025 from the guest directly, and the
    // 500 kaucja. `amountPaid` stays 0 until money actually lands.
    const alohacamp = {
      channel: "alohacamp",
      totalPrice: "2700.00",
      hostRevenue: "2201.85",
      amountPaid: "0.00",
      depositAmount: "500.00",
      depositStatus: "pending",
    };

    it("owes the owner the whole payout before anything lands", () => {
      expect(calculateBalanceDue(alohacamp)).toBeCloseTo(2201.85, 2);
      expect(calculateBalanceDue(alohacamp, true)).toBeCloseTo(2701.85, 2);
    });

    it("drops by the portal's forward of the zaliczka", () => {
      const afterForward = { ...alohacamp, amountPaid: "176.85" };
      expect(calculateBalanceDue(afterForward, true)).toBeCloseTo(2525, 2);
    });

    it("leaves only the kaucja once the guest has paid the balance", () => {
      // 176.85 forwarded + 2025 from the guest = the full 2201.85 payout.
      const afterBalance = { ...alohacamp, amountPaid: "2201.85" };
      expect(calculateBalanceDue(afterBalance)).toBeCloseTo(0, 2);
      expect(calculateBalanceDue(afterBalance, true)).toBeCloseTo(500, 2);
    });

    it("reaches zero when the kaucja is in too", () => {
      const settled = { ...alohacamp, amountPaid: "2701.85", depositStatus: "paid" };
      expect(calculateBalanceDue(settled, true)).toBe(0);
    });

    it("measures Airbnb against the host payout the same way", () => {
      expect(calculateBalanceDue({
        channel: "airbnb",
        totalPrice: "3000.00",
        hostRevenue: "2600.00",
        amountPaid: "600.00",
        depositStatus: "not_applicable",
      })).toBeCloseTo(2000, 2);
    });

    it("never reports a negative balance", () => {
      expect(calculateBalanceDue({ ...alohacamp, amountPaid: "9999.00" })).toBe(0);
    });
  });

  describe("a stay the portal collected in full", () => {
    // Alohacamp sends two shapes of confirmation, and only one leaves a zaliczka
    // behind. "opłacona w całości" means the portal holds the entire stay and
    // owes the owner a single payout — booking #113 (Suchocki) settled exactly
    // so: no reservationFee, one transfer of 2446.50.
    const prepaidInFull = {
      channel: "alohacamp",
      status: "portal_paid",
      totalPrice: "3000.00",
      hostRevenue: "2446.50",
      reservationFee: null,
      amountPaid: "0.00",
      depositAmount: "500.00",
      depositStatus: "pending",
    };

    it("asks that guest for the kaucja only, never for the payout in flight", () => {
      const due = calculateAmountsDue(prepaidInFull);
      expect(due.guestStayDue).toBe(0);
      expect(due.guestDue).toBeCloseTo(500, 2);
      // Still owed — by Alohacamp, not by the guest.
      expect(due.portalDue).toBeCloseTo(2446.5, 2);
      expect(due.accountDue).toBeCloseTo(2946.5, 2);
    });

    it("keeps asking a two-step Alohacamp guest for their own balance", () => {
      // #181: 675 zaliczka went to the portal, so the remaining 2025 is the
      // guest's to pay and must not be swept up by the fix above.
      const twoStep = {
        ...prepaidInFull,
        status: "confirmed",
        totalPrice: "2700.00",
        hostRevenue: "2201.85",
        reservationFee: "675.00",
      };
      expect(calculateAmountsDue(twoStep).guestStayDue).toBeCloseTo(2025, 2);
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

  describe("bookingEarnings", () => {
    it("takes commission from the payout, not the column, when the column was left at 0", () => {
      // Portal cut baked into hostRevenue, commission never written.
      expect(bookingEarnings({ totalPrice: "2000.00", commission: "0.00", hostRevenue: "1690.00" }))
        .toEqual({ totalPrice: 2000, commission: 310, hostRevenue: 1690 });
    });

    it("agrees with a consistent row", () => {
      expect(bookingEarnings({ totalPrice: "1000.00", commission: "155.00", hostRevenue: "845.00" }))
        .toEqual({ totalPrice: 1000, commission: 155, hostRevenue: 845 });
    });

    it("falls back to the commission column when no payout is recorded", () => {
      expect(bookingEarnings({ totalPrice: "1000.00", commission: "155.00", hostRevenue: null }))
        .toEqual({ totalPrice: 1000, commission: 155, hostRevenue: 845 });
    });

    it("treats an unpriced row as zero", () => {
      expect(bookingEarnings({ totalPrice: null, commission: "0.00", hostRevenue: null }))
        .toEqual({ totalPrice: 0, commission: 0, hostRevenue: 0 });
    });
  });
});
