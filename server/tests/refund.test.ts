import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingService } from "../services/BookingService";
import { BookingRepository } from "../repositories/BookingRepository";
import { BankTransferRepository } from "../repositories/BankTransferRepository";
import { getDb } from "../db";

/**
 * Refunding part of a booking, and why it cannot be an edit of the price.
 *
 * Booking #157 is the shape this exists for. The price was cut by 500 by hand
 * and the money sent back to the guest inside the same bank transfer as the
 * kaucja — so `amountPaid` dropped by 500 while the transfers matched to the
 * booking still added up to the original sum, and the daily alert reported a
 * 500 zł mismatch that nothing in the app could resolve.
 *
 * The rule these pin: a refund moves `amountPaid` and the transfer total by the
 * same amount, so `amountPaid − (Σ transfers − returned kaucja)` is unchanged.
 */

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../_core/email", () => ({ sendGuestEmail: vi.fn(), sendAlertEmail: vi.fn() }));
vi.mock("../services/PricingService", () => ({ PricingService: { calculatePrice: vi.fn() } }));

vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    getBookingById: vi.fn(),
    updateBookingDetails: vi.fn(),
  },
}));

vi.mock("../repositories/BankTransferRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/BankTransferRepository")>();
  return {
    ...actual,
    BankTransferRepository: { insertTransfer: vi.fn() },
  };
});

/** A transaction that runs its callback and reports whether it rolled back. */
function fakeDb() {
  const rolledBack: boolean[] = [];
  return {
    db: {
      transaction: async (cb: (tx: any) => Promise<void>) => {
        try {
          await cb({ __tx: true });
        } catch (err) {
          rolledBack.push(true);
          throw err;
        }
      },
    },
    rolledBack,
  };
}

/** Booking #157 as it stood before the price was cut. */
const olga = {
  id: 157,
  guestName: "Olga Korzeniowska",
  property: "Sadoles",
  channel: "direct",
  status: "finished",
  currency: "PLN",
  totalPrice: "5260.00",
  commission: "0.00",
  hostRevenue: "5260.00",
  amountPaid: "5760.00",
  depositAmount: "500.00",
  depositStatus: "paid",
};

/** The reconciliation query's arithmetic, as SQL runs it. */
const discrepancy = (amountPaid: number, transfersTotal: number, depositReturned = 0) =>
  +(amountPaid - (transfersTotal - depositReturned)).toFixed(2);

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as any).mockResolvedValue(fakeDb().db);
  (BankTransferRepository.insertTransfer as any).mockResolvedValue({ inserted: true });
});

describe("BookingService.refundToGuest", () => {
  it("cuts the price and records the money leaving, in one step", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue(olga);

    const res = await BookingService.refundToGuest({
      bookingId: 157,
      amount: 500,
      refundDate: new Date("2026-08-31T12:00:00Z"),
      reason: "obniżka ceny",
    });

    expect(res).toMatchObject({
      success: true,
      totalPrice: "4760.00",
      hostRevenue: "4760.00",
      amountPaid: "5260.00",
    });

    expect(BookingRepository.updateBookingDetails).toHaveBeenCalledWith(
      157,
      { totalPrice: "4760.00", hostRevenue: "4760.00", amountPaid: "5260.00" },
      { __tx: true }
    );

    const [row] = (BankTransferRepository.insertTransfer as any).mock.calls[0];
    // Negative, so everything that sums transfers subtracts it with no special case.
    expect(row.amount).toBe("-500.00");
    expect(row.matchedBookingId).toBe(157);
    expect(row.status).toBe("matched");
    expect(row.source).toBe("manual");
    expect(row.transferTitle).toContain("obniżka ceny");
  });

  it("leaves a reconciled booking reconciled", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue(olga);

    // Before: 1600 + 4160 received, kaucja still held, nothing out of balance.
    expect(discrepancy(5760, 5760)).toBe(0);

    const res = await BookingService.refundToGuest({ bookingId: 157, amount: 500 });

    // After: both sides moved by 500. This is the whole point — cutting the
    // price alone leaves the −500 the daily alert has been reporting.
    expect(discrepancy(Number(res.amountPaid), 5760 - 500)).toBe(0);
    expect(discrepancy(Number(res.amountPaid), 5760)).toBe(-500);
  });

  it("does not touch the kaucja, which comes back through depositStatus", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue(olga);

    await BookingService.refundToGuest({ bookingId: 157, amount: 500 });

    const [, details] = (BookingRepository.updateBookingDetails as any).mock.calls[0];
    expect(details).not.toHaveProperty("depositAmount");
    expect(details).not.toHaveProperty("depositStatus");

    // And the pair still balances once the kaucja is returned as well: 500 of
    // the 5260 held is the guest's, and the query subtracts it.
    expect(discrepancy(5260 - 500, 5760 - 500, 500)).toBe(0);
  });

  it("keeps the portal's commission out of the refund", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue({
      ...olga,
      channel: "slowhop",
      totalPrice: "3000.00",
      commission: "300.00",
      hostRevenue: "2700.00",
      amountPaid: "3000.00",
    });

    const res = await BookingService.refundToGuest({ bookingId: 157, amount: 200 });

    // The guest's price and the owner's revenue both drop by 200; the portal's
    // cut is not ours to hand back.
    expect(res.totalPrice).toBe("2800.00");
    expect(res.hostRevenue).toBe("2500.00");
  });

  it("refuses the same refund twice, and cuts the price only once", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue(olga);
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({
      inserted: false,
      duplicateOf: { id: 102 },
    });

    const res = await BookingService.refundToGuest({ bookingId: 157, amount: 500 });

    expect(res).toMatchObject({ success: false, duplicate: true, duplicateOfTransferId: 102 });
    expect(BookingRepository.updateBookingDetails).not.toHaveBeenCalled();
  });

  it("refuses to refund more than ever arrived", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue({ ...olga, amountPaid: "300.00" });

    await expect(BookingService.refundToGuest({ bookingId: 157, amount: 500 })).rejects.toThrow(
      /exceeds the 300.00 received/
    );
    expect(BankTransferRepository.insertTransfer).not.toHaveBeenCalled();
  });

  it("refuses a refund that is not a positive amount", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue(olga);

    await expect(BookingService.refundToGuest({ bookingId: 157, amount: 0 })).rejects.toThrow(
      /greater than zero/
    );
    expect(BankTransferRepository.insertTransfer).not.toHaveBeenCalled();
  });
});
