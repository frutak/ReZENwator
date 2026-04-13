import { describe, it, expect, vi, beforeEach } from "vitest";
import { findMatchingBookings } from "../workers/bookingMatcher";
import * as dbModule from "../db";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../_core/logger", () => ({
  Logger: {
    bookingAction: vi.fn(),
  },
}));

vi.mock("../_core/email", () => ({
  sendAlertEmail: vi.fn(),
}));

describe("BookingMatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTransfer = {
    amount: 1500,
    currency: "PLN",
    senderName: "RENNER LAURA ANNA",
    transferTitle: "Laura Renner 7.03 wpłata.",
    transferDate: new Date("2026-03-02"),
    accountNumber: "123",
  };

  const setupMockDb = (candidates: any[]) => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(candidates)
        })
      })
    };
    (dbModule.getDb as any).mockResolvedValue(mockDb);
    return mockDb;
  };

  it("finds exact match by name and title", async () => {
    const candidates = [
      {
        id: 1,
        guestName: "Laura Renner",
        checkIn: new Date("2026-03-07"),
        totalPrice: "1500",
        channel: "direct",
        property: "Sadoles",
        status: "pending"
      }
    ];
    setupMockDb(candidates);

    const results = await findMatchingBookings(mockTransfer, true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bookingId).toBe(1);
    expect(results[0].score).toBeGreaterThan(90);
  });

  it("handles Airbnb payout matching by hostRevenue", async () => {
    const airbnbTransfer = {
      amount: 2451.25,
      currency: "PLN",
      senderName: "AIRBNB PAYMENTS",
      transferTitle: "Payout HM8NCRQQ5H",
      transferDate: new Date("2026-06-30"),
      accountNumber: "123",
    };

    const candidates = [
      {
        id: 2,
        guestName: "Vlad Svidrickiy",
        checkIn: new Date("2026-06-27"),
        hostRevenue: "2451.25",
        channel: "airbnb",
        property: "Sadoles",
        status: "portal_paid"
      }
    ];
    setupMockDb(candidates);

    const results = await findMatchingBookings(airbnbTransfer, true);
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(100);
    expect(results[0].reasons[0]).toContain("Portal payout");
  });

  it("returns empty array when no candidates found", async () => {
    setupMockDb([]);
    const results = await findMatchingBookings(mockTransfer, true);
    expect(results).toEqual([]);
  });
});
