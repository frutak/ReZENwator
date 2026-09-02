import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingRepository } from "../repositories/BookingRepository";
import { getDb } from "../db";

/**
 * `depositReturnedAt` is what the free-cashflow view reads, and it kept coming
 * up empty.
 *
 * The stamp lived inside `updateDepositStatus`, which the dashboard never calls:
 * the modal saves the whole form through `updateBookingDetails`, and the matcher
 * writes the column through `updateBookingPayment`. Both set `depositStatus`
 * directly, so a kaucja returned from the UI was `returned` with no date against
 * it — nine bookings, 4500 zł that never left the cashflow.
 *
 * These pin the invariant on the column rather than on one method: whichever
 * path writes `depositStatus`, a returned kaucja carries a date and a
 * non-returned one does not.
 */

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../services/CleaningService", () => ({
  CleaningService: { checkCleaningConflicts: vi.fn().mockResolvedValue(undefined) },
}));

/** A db whose only read answers "what is the current depositReturnedAt?". */
function fakeDb(currentStamp: Date | null) {
  const writes: any[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ at: currentStamp }] }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          writes.push(values);
        },
      }),
    }),
  };
  return { db, writes };
}

beforeEach(() => vi.clearAllMocks());

describe("depositReturnedAt follows depositStatus, whichever path writes it", () => {
  it("stamps the cash-out date when the modal's save returns the kaucja", async () => {
    const { db, writes } = fakeDb(null);
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateBookingDetails(157, {
      totalPrice: "4760.00",
      depositStatus: "returned",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].depositReturnedAt).toBeInstanceOf(Date);
  });

  it("does not walk an existing cash-out date forward on a later save", async () => {
    // The modal sends the whole form every time, so an unrelated edit in
    // September must not move an August return into September's cashflow.
    const august = new Date("2026-08-31T12:00:00Z");
    const { db, writes } = fakeDb(august);
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateBookingDetails(157, {
      notes: "unrelated edit",
      depositStatus: "returned",
    });

    expect(writes[0]).not.toHaveProperty("depositReturnedAt");
  });

  it("clears the date when the kaucja leaves the returned state", async () => {
    const { db, writes } = fakeDb(new Date("2026-08-31T12:00:00Z"));
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateBookingDetails(157, { depositStatus: "paid" });

    expect(writes[0].depositReturnedAt).toBeNull();
  });

  it("leaves the date alone when a save does not touch the kaucja", async () => {
    const { db, writes } = fakeDb(new Date("2026-08-31T12:00:00Z"));
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateBookingDetails(157, { notes: "just a note" });

    expect(writes[0]).not.toHaveProperty("depositReturnedAt");
  });

  it("applies the same rule to the matcher's payment write", async () => {
    const { db, writes } = fakeDb(null);
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateBookingPayment(157, {
      status: "finished",
      depositStatus: "returned",
      amountPaid: "4760.00",
    });

    expect(writes[0].depositReturnedAt).toBeInstanceOf(Date);

    // And reverting a match, which can take the kaucja back out of `returned`.
    const reverted = fakeDb(new Date("2026-08-31T12:00:00Z"));
    (getDb as any).mockResolvedValue(reverted.db);

    await BookingRepository.updateBookingPayment(157, {
      status: "confirmed",
      depositStatus: "pending",
      amountPaid: "0.00",
    });

    expect(reverted.writes[0].depositReturnedAt).toBeNull();
  });

  it("still stamps through the dedicated endpoint", async () => {
    const { db, writes } = fakeDb(null);
    (getDb as any).mockResolvedValue(db);

    await BookingRepository.updateDepositStatus(157, "returned");

    expect(writes[0].depositReturnedAt).toBeInstanceOf(Date);
  });
});
