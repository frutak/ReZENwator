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
      type: "bank",
      bank: "nestbank",
      amount: 1000.00,
      senderName: "Jan Kowalski",
      transferTitle: "Zapłata za pobyt",
      transferDate: new Date("2026-05-08T12:00:00Z"),
      rawText: ""
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].score).toBeGreaterThanOrEqual(100);
  });

  it("should match by company name", () => {
    const transfer: ParsedBankData = {
      type: "bank",
      bank: "nestbank",
      amount: 2000.00,
      senderName: "Nowak Corp",
      transferTitle: "Faktura 123",
      transferDate: new Date("2026-05-12T12:00:00Z"),
      rawText: ""
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bookingId).toBe(2);
    expect(results[0].score).toBeGreaterThan(90);
  });

  it("should handle portal payouts via host revenue match", () => {
    const transfer: ParsedBankData = {
      type: "bank",
      bank: "nestbank",
      amount: 1800.00,
      senderName: "Slowhop",
      transferTitle: "Payout for Anna Nowak",
      transferDate: new Date("2026-05-16T12:00:00Z"),
      rawText: ""
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, true);
    expect(results.length).toBe(1);
    expect(results[0].bookingId).toBe(2);
    expect(results[0].score).toBe(100);
    expect(results[0].reasons).toContain("Portal payout: Exact or near match to host revenue (within 1%)");
  });

  it("should give high score for matching name and date", () => {
    const transfer: ParsedBankData = {
      type: "bank",
      bank: "nestbank",
      amount: 50.00, // different amount
      senderName: "Jan Kowalski",
      transferTitle: "Rezerwacja",
      transferDate: new Date("2026-05-09T12:00:00Z"),
      rawText: ""
    };

    const results = MatchingEngine.scoreCandidates(transfer, mockCandidates, false);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].reasons).toContain("Guest name match (high)");
    expect(results[0].reasons).toContain("Date is very close (<3 days)");
  });

  it("should handle deposit keyword bonus", () => {
    const transfer: ParsedBankData = {
      type: "bank",
      bank: "nestbank",
      amount: 500.00,
      senderName: "Jan Kowalski",
      transferTitle: "Kaucja Sadoles",
      transferDate: new Date("2026-05-08T12:00:00Z"),
      rawText: ""
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
});
