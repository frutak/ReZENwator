import { describe, it, expect } from "vitest";
import { MatchingEngine, type CandidateBooking } from "../services/MatchingEngine";
import type { ParsedBankData } from "../workers/emailParsers";

describe("MatchingEngine", () => {
  const mockCandidates: CandidateBooking[] = [
    {
      id: 1,
      guestName: "Jan Kowalski",
      companyName: null,
      checkIn: new Date("2026-05-10T16:00:00Z"),
      checkOut: new Date("2026-05-12T10:00:00Z"),
      channel: "direct",
      property: "Sadoles",
      totalPrice: "1000.00",
      amountPaid: "0.00",
      hostRevenue: "1000.00",
      commission: "0.00",
      reservationFee: "300.00",
      depositAmount: "500.00",
      icalUid: "uid-1",
      icalSummary: "Summary 1",
      status: "confirmed"
    },
    {
      id: 2,
      guestName: "Anna Nowak",
      companyName: "Nowak Corp",
      checkIn: new Date("2026-05-15T16:00:00Z"),
      checkOut: new Date("2026-05-18T10:00:00Z"),
      channel: "slowhop",
      property: "Hacjenda",
      totalPrice: "2000.00",
      amountPaid: "0.00",
      hostRevenue: "1800.00",
      commission: "200.00",
      reservationFee: "600.00",
      depositAmount: "500.00",
      icalUid: "uid-2",
      icalSummary: "Summary 2",
      status: "confirmed"
    }
  ];

  it("should match by exact name and amount", () => {
    const transfer: ParsedBankData = {
      amount: 1000.00,
      senderName: "Jan Kowalski",
      transferTitle: "Zapłata za pobyt",
      transferDate: new Date("2026-05-08T12:00:00Z"),
      currency: "PLN",
      accountNumber: "11187010452078106769980001",
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].score).toBeGreaterThanOrEqual(100);
  });

  it("should match by company name", () => {
    const transfer: ParsedBankData = {
      amount: 2000.00,
      senderName: "Nowak Corp",
      transferTitle: "Faktura 123",
      transferDate: new Date("2026-05-12T12:00:00Z"),
      currency: "PLN",
      accountNumber: "11187010452078106769980001",
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bookingId).toBe(2);
    expect(results[0].score).toBeGreaterThan(90);
  });

  it("should handle portal payouts via host revenue match", () => {
    const transfer: ParsedBankData = {
      amount: 1800.00,
      senderName: "Slowhop",
      transferTitle: "Payout for Anna Nowak",
      transferDate: new Date("2026-05-16T12:00:00Z"),
      currency: "PLN",
      accountNumber: "11187010452078106769980001",
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, true);
    expect(results.length).toBe(1);
    expect(results[0].bookingId).toBe(2);
    expect(results[0].score).toBe(100);
    expect(results[0].reasons).toContain("Portal payout: Exact or near match to host revenue (within 1%)");
  });

  it("should give high score for matching name and date", () => {
    const transfer: ParsedBankData = {
      amount: 50.00, // different amount
      senderName: "Jan Kowalski",
      transferTitle: "Rezerwacja",
      transferDate: new Date("2026-05-09T12:00:00Z"),
      currency: "PLN",
      accountNumber: "11187010452078106769980001",
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].reasons).toContain("Guest name match (high)");
    expect(results[0].reasons).toContain("Date is very close (<3 days)");
  });

  it("should handle deposit keyword bonus", () => {
    const transfer: ParsedBankData = {
      amount: 500.00,
      senderName: "Jan Kowalski",
      transferTitle: "Kaucja Sadoles",
      transferDate: new Date("2026-05-08T12:00:00Z"),
      currency: "PLN",
      accountNumber: "11187010452078106769980001",
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].reasons).toContain("Matches deposit amount + keyword");
  });

  describe("Alohacamp forwards", () => {
    // Booking #181: 2700 zł stay, 675 zł zaliczka, 498.15 zł commission. The
    // portal forwards 675 − 498.15 = 176.85 and the guest pays the remaining
    // 2025 zł (plus the kaucja) straight to the owner's account.
    const alohacamp: CandidateBooking[] = [{
      id: 181,
      guestName: "Serhii Kozachenko",
      companyName: null,
      checkOut: new Date("2026-10-04T08:00:00Z"),
      checkIn: new Date("2026-10-02T16:00:00Z"),
      channel: "alohacamp",
      property: "Sadoles",
      totalPrice: "2700.00",
      amountPaid: "675.00",
      hostRevenue: "2201.85",
      commission: "498.15",
      reservationFee: "675.00",
      depositAmount: "500.00",
      icalUid: "8896f74f8bae75f74a962fe6c56ebf83@alohacamp.com",
      icalSummary: "Reservation no 202608952357 at alohacamp.com",
      status: "confirmed",
    }];

    it("scores the portal's zaliczka forward on amount alone", () => {
      // The sender is the portal, not the guest, so nothing but the amount
      // identifies this transfer. Without the Alohacamp branch it scored 10.
      const transfer: ParsedBankData = {
        amount: 176.85,
        senderName: "ALOHACAMP SP. Z O.O.",
        transferTitle: "Wyplata",
        transferDate: new Date("2026-08-13T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const results = MatchingEngine.scoreCandidates(transfer, alohacamp, false);
      expect(results[0].reasons).toContain("Matches Alohacamp host pre-payment (ResFee - Gross Commission)");
    });

    it("auto-matches the guest paying the balance directly", () => {
      const transfer: ParsedBankData = {
        amount: 2025,
        senderName: "SERHII KOZACHENKO",
        transferTitle: "Sadoles doplata",
        transferDate: new Date("2026-09-20T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const results = MatchingEngine.scoreCandidates(transfer, alohacamp, false);
      expect(results[0].bookingId).toBe(181);
      expect(results[0].score).toBeGreaterThanOrEqual(80);
    });

    it("auto-matches the guest paying balance and kaucja together", () => {
      const transfer: ParsedBankData = {
        amount: 2525,
        senderName: "SERHII KOZACHENKO",
        transferTitle: "Sadoles doplata + kaucja",
        transferDate: new Date("2026-09-20T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const results = MatchingEngine.scoreCandidates(transfer, alohacamp, false);
      expect(results[0].bookingId).toBe(181);
      expect(results[0].score).toBeGreaterThanOrEqual(80);
    });
  });

  // Each portal pays on its own clock, and the transfer date is evidence in its
  // own right: Slowhop forwards the zaliczka within days of the booking, Airbnb
  // pays on the second day of the stay, Booking.com about 5 business days after
  // checkout. Judging those by their distance from check-in — the generic rule —
  // scores a Slowhop forward sent months ahead at 5 points out of 100.
  describe("payout timing", () => {
    const hacjenda = (over: Partial<CandidateBooking>): CandidateBooking => ({
      id: 900,
      guestName: "Maria Satsiuk",
      companyName: null,
      checkIn: new Date("2026-08-23T14:00:00Z"),
      checkOut: new Date("2026-08-24T08:00:00Z"),
      createdAt: new Date("2026-07-20T19:30:00Z"),
      channel: "slowhop",
      property: "Hacjenda",
      totalPrice: "1400.00",
      amountPaid: "0.00",
      hostRevenue: "1141.70",
      commission: "258.30",
      reservationFee: "420.00",
      depositAmount: "500.00",
      icalUid: "uid-172",
      icalSummary: "Maria - 1345090",
      status: "confirmed",
      ...over,
    });

    it("credits a Slowhop forward that lands days after the booking", () => {
      // Booking made 20.07, forward on the account 21.07 — a month before the
      // stay, so proximity to check-in says almost nothing.
      const transfer = {
        amount: 161.7,
        senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        transferTitle: "Slowhop przedplaty id: 1345090",
        transferDate: new Date("2026-07-21T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const [best] = MatchingEngine.scoreCandidates(transfer, [hacjenda({})], false);
      expect(best.reasons.some((r) => r.includes("when slowhop pays"))).toBe(true);
      expect(best.score).toBeGreaterThanOrEqual(80);
    });

    it("does not credit the timing of a forward that arrives months late", () => {
      const transfer = {
        amount: 161.7,
        senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        transferTitle: "Slowhop przedplaty id: 1345090",
        transferDate: new Date("2026-08-22T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const [best] = MatchingEngine.scoreCandidates(transfer, [hacjenda({})], false);
      expect(best.reasons.some((r) => r.includes("slowhop pays"))).toBe(false);
    });

    it("leaves a guest's own transfer judged by the arrival date", () => {
      // The timing rule is for portal payouts only — a guest paying shortly
      // before check-in must not be scored against the portal's clock.
      const transfer = {
        amount: 980,
        senderName: "MARIA SATSIUK",
        transferTitle: "Hacjenda 23.08",
        transferDate: new Date("2026-08-18T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const [best] = MatchingEngine.scoreCandidates(transfer, [hacjenda({})], false);
      expect(best.reasons.some((r) => r.includes("pays"))).toBe(false);
      expect(best.score).toBeGreaterThanOrEqual(80);
    });

    it("breaks a tie between identically priced Booking.com stays on the payout date", () => {
      // Two stays at the same price: only the payout clock separates them, and
      // Booking.com pays about 5 business days after checkout.
      const base: CandidateBooking = hacjenda({
        channel: "booking",
        status: "portal_paid",
        reservationFee: null,
        hostRevenue: "1003.20",
        totalPrice: "1200.00",
      });
      const earlier = { ...base, id: 801, checkIn: new Date("2026-04-02T14:00:00Z"), checkOut: new Date("2026-04-03T08:00:00Z") };
      const later = { ...base, id: 802, checkIn: new Date("2026-06-10T14:00:00Z"), checkOut: new Date("2026-06-11T08:00:00Z") };

      const transfer = {
        amount: 1003.2,
        senderName: "BOOKING.COM B.V",
        transferTitle: "NO.RWDHLYJFKNMSCLDS/13416371",
        transferDate: new Date("2026-06-17T12:00:00Z"),
        currency: "PLN",
        accountNumber: "123",
      } as ParsedBankData;

      const results = MatchingEngine.scoreCandidates(transfer, [earlier, later], true);
      // The old tie-break took the earliest check-in and would have picked #801.
      expect(results[0].bookingId).toBe(802);
    });
  });

  // The Airbnb payout of 24.05.2026 went to the wrong stay, and the reason was
  // not the scoring but the filter in front of it: booking #77 had been marked
  // paid by hand, which at the time wrote the amount onto the booking and left
  // no transfer row. A booking that already looks paid is skipped so a payout
  // cannot land twice — but "paid" with nothing behind it is a claim, and
  // skipping it left #76 as the only Hacjenda stay at the same price.
  describe("a balance with no transfer behind it", () => {
    const hacjenda = (over: Partial<CandidateBooking>): CandidateBooking => ({
      id: 0,
      guestName: null,
      companyName: null,
      checkIn: new Date("2026-05-22T14:00:00Z"),
      checkOut: new Date("2026-05-23T08:00:00Z"),
      createdAt: new Date("2026-04-21T11:00:00Z"),
      channel: "airbnb",
      property: "Hacjenda",
      totalPrice: "1600.00",
      amountPaid: "0.00",
      hostRevenue: "1352.00",
      commission: "0.00",
      reservationFee: null,
      depositAmount: "500.00",
      icalUid: null,
      icalSummary: null,
      status: "portal_paid",
      ...over,
    });

    const payout = {
      amount: 1352,
      senderName: "Airbnb 888 Brannan St. 94103 San Fr",
      transferTitle: "/ref/281475509872576/Airbnb Payments Luxembourg S.A.",
      transferDate: new Date("2026-05-24T12:00:00Z"),
      currency: "PLN",
      accountNumber: "123",
    } as ParsedBankData;

    /** #77 Maćkowiak, 22–23.05 — paid by hand, no transfer recorded. */
    const claimedPaid = hacjenda({ id: 77, guestName: "Katarzyna Maćkowiak", amountPaid: "1352.00", matchedTransferCount: 0 });
    /** #76 Kuś, 13–14.06 — same price, its own payout still weeks away. */
    const neighbour = hacjenda({
      id: 76,
      guestName: "Natalia Kuś",
      checkIn: new Date("2026-06-13T14:00:00Z"),
      checkOut: new Date("2026-06-14T08:00:00Z"),
      matchedTransferCount: 0,
    });

    it("still considers the booking, and the payout date picks it", () => {
      const results = MatchingEngine.scoreCandidates(payout, [claimedPaid, neighbour], true);
      // Airbnb pays on day 2: 23.05 for #77, 14.06 for #76.
      expect(results[0].bookingId).toBe(77);
    });

    it("keeps skipping one whose balance a real transfer already backs", () => {
      const settled = { ...claimedPaid, matchedTransferCount: 1 };
      const results = MatchingEngine.scoreCandidates(payout, [settled, neighbour], true);
      // Its money is accounted for, so the payout must not be applied again.
      expect(results.every((r) => r.bookingId !== 77)).toBe(true);
    });

    it("treats an unstated count as backed, so other callers keep their behaviour", () => {
      const { matchedTransferCount, ...withoutCount } = claimedPaid;
      const results = MatchingEngine.scoreCandidates(payout, [withoutCount as CandidateBooking, neighbour], true);
      expect(results.every((r) => r.bookingId !== 77)).toBe(true);
    });
  });
});
