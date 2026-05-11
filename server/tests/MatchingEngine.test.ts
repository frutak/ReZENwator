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
});
