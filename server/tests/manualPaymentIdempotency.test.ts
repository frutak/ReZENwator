import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import { BankTransferRepository, transferContentKey } from "../repositories/BankTransferRepository";
import { applyTransferMatch, revertTransferMatch } from "../workers/bookingMatcher";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";

/**
 * The two ways money is applied by hand, and why neither can be applied twice.
 *
 * `manualMatch` used to read the transfer, revert any earlier match and apply
 * the new one, with nothing between the read and the write. Two of those at once
 * — a double-click, a client retry — both saw the transfer as unmatched, so
 * neither reverted anything and both added the amount. `claimMatch` is the
 * interlock: one conditional UPDATE, serialised by MySQL on the row.
 *
 * `applyTransferMatch` (the "record a payment" form) wrote straight to the
 * booking and left no transfer row at all, so there was nothing to key on and a
 * second click simply added the money again — and the payment never reached the
 * cashflow view, which reads `bank_transfers`. It now records the payment first
 * and applies it only if that row is new.
 */

/**
 * A transaction that behaves like the real one for what these tests care about:
 * the callback runs, and an error inside it propagates after a rollback — which
 * is how "nothing landed" is asserted below.
 */
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

vi.mock("../repositories/BankTransferRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/BankTransferRepository")>();
  return {
    ...actual,
    BankTransferRepository: {
      getTransferById: vi.fn(),
      getTransferByIdForUpdate: vi.fn(),
      claimMatch: vi.fn(),
      insertTransfer: vi.fn(),
      findByContentKey: vi.fn().mockResolvedValue([]),
      updateTransferStatus: vi.fn(),
      getMonthlyCashflow: vi.fn(),
    },
  };
});
vi.mock("../workers/bookingMatcher", () => ({
  applyTransferMatch: vi.fn(),
  revertTransferMatch: vi.fn(),
  findMatchingBookings: vi.fn().mockResolvedValue([]),
}));
vi.mock("../db", () => ({ getDb: vi.fn(), runWithLock: vi.fn() }));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn(), audit: vi.fn() } }));

function adminCaller() {
  const ctx = {
    user: {
      id: 1,
      openId: "owner",
      email: "owner@example.com",
      name: "Owner",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

const pendingTransfer = {
  id: 57,
  externalId: "<bank@nest>",
  amount: "980.00",
  currency: "PLN",
  senderName: "Oleksandr Kotov",
  transferTitle: "/ref/281475545653695/Hacjenda Kiekrz 23.08.",
  transferDate: new Date("2026-08-11"),
  accountNumber: "111",
  status: "pending" as const,
  matchedBookingId: null,
};

describe("transfers.manualMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockResolvedValue(fakeDb().db);
    (BankTransferRepository.getTransferById as any).mockResolvedValue(pendingTransfer);
    (BankTransferRepository.getTransferByIdForUpdate as any).mockResolvedValue(pendingTransfer);
    (BankTransferRepository.claimMatch as any).mockResolvedValue(true);
    (applyTransferMatch as any).mockResolvedValue(undefined);
    (revertTransferMatch as any).mockResolvedValue(undefined);
  });

  it("applies the payment when it wins the claim", async () => {
    const result = await adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 });

    expect(BankTransferRepository.claimMatch).toHaveBeenCalledWith(57, 172, expect.anything());
    expect(applyTransferMatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("does nothing at all when the claim is already taken", async () => {
    // The second of two concurrent clicks: MySQL gave the row to the first.
    (BankTransferRepository.claimMatch as any).mockResolvedValue(false);

    const result = await adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 });

    expect(applyTransferMatch).not.toHaveBeenCalled();
    expect(revertTransferMatch).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, alreadyApplied: true });
  });

  it("gives the money back to the previous booking when re-matched elsewhere", async () => {
    (BankTransferRepository.getTransferByIdForUpdate as any).mockResolvedValue({
      ...pendingTransfer,
      status: "matched",
      matchedBookingId: 99,
    });

    await adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 });

    expect(revertTransferMatch).toHaveBeenCalledWith(99, 980, expect.anything());
    expect(applyTransferMatch).toHaveBeenCalledTimes(1);
  });

  it("does not revert a booking it is about to re-apply to", async () => {
    // Re-matching to the same booking is a no-op, not a subtract-then-add.
    (BankTransferRepository.getTransferByIdForUpdate as any).mockResolvedValue({
      ...pendingTransfer,
      status: "matched",
      matchedBookingId: 172,
    });
    (BankTransferRepository.claimMatch as any).mockResolvedValue(false);

    await adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 });

    expect(revertTransferMatch).not.toHaveBeenCalled();
    expect(applyTransferMatch).not.toHaveBeenCalled();
  });

  it("leaves both bookings untouched when crediting the new one fails", async () => {
    // The window this whole design exists for: the money has been taken off the
    // old booking and the transfer already claims to belong to the new one, when
    // the process dies. Run as three separate writes, that 980 zł is simply
    // gone — off booking 99, never on 172, and a retry refuses to act because
    // the claim is taken. Inside one transaction it rolls back instead.
    const { db, rolledBack } = fakeDb();
    (getDb as any).mockResolvedValue(db);
    (BankTransferRepository.getTransferByIdForUpdate as any).mockResolvedValue({
      ...pendingTransfer,
      status: "matched",
      matchedBookingId: 99,
    });
    const revertEffect = vi.fn();
    (revertTransferMatch as any).mockResolvedValue(revertEffect);
    (applyTransferMatch as any).mockRejectedValue(new Error("connection lost"));

    await expect(
      adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 })
    ).rejects.toThrow("connection lost");

    expect(rolledBack).toHaveLength(1);
    // The revert ran, but inside the transaction — the rollback undoes it. What
    // must not happen is its activity-log entry surviving to describe a write
    // that no longer exists.
    expect(revertEffect).not.toHaveBeenCalled();
  });

  it("logs nothing until the transaction has committed", async () => {
    const applyEffect = vi.fn();
    (applyTransferMatch as any).mockImplementation(async () => {
      // Still inside the transaction here.
      expect(applyEffect).not.toHaveBeenCalled();
      return applyEffect;
    });

    await adminCaller().transfers.manualMatch({ transferId: 57, bookingId: 172 });

    expect(applyEffect).toHaveBeenCalledTimes(1);
  });
});

describe("bookings.applyTransferMatch (payment recorded by hand)", () => {
  const payment = {
    bookingId: 172,
    transferAmount: 500,
    transferSender: "MARIA SATSIUK",
    transferTitle: "Kaucja Hacjenda 23.08",
    transferDate: new Date("2026-08-20"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({ inserted: true });
    (BankTransferRepository.findByContentKey as any).mockResolvedValue([{ id: 90 }]);
  });

  it("records the payment as a transfer, so the cashflow view can see it", async () => {
    const result = await adminCaller().bookings.applyTransferMatch(payment);

    expect(result).toEqual({ success: true });
    const row = (BankTransferRepository.insertTransfer as any).mock.calls[0][0];
    expect(row.amount).toBe("500");
    expect(row.senderName).toBe("MARIA SATSIUK");
    expect(row.contentKey).toBe(
      transferContentKey({
        amount: 500,
        currency: "PLN",
        senderName: "MARIA SATSIUK",
        transferTitle: "Kaucja Hacjenda 23.08",
        transferDate: payment.transferDate,
        accountNumber: "",
      })
    );
    // Applied against the row just written, so the two stay in step.
    expect(applyTransferMatch).toHaveBeenCalledWith(172, expect.anything(), 100, { transferId: 90 });
  });

  it("refuses a second click instead of adding the money twice", async () => {
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({
      inserted: false,
      duplicateOf: { id: 90 },
    });

    const result = await adminCaller().bookings.applyTransferMatch(payment);

    expect(applyTransferMatch).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, duplicate: true, duplicateOfTransferId: 90 });
  });
});
