import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTransferMatch } from "../workers/bookingMatcher";
import { BookingRepository } from "../repositories/BookingRepository";
import { sendAlertEmail } from "../_core/email";

// No DB configured → applyTransferMatch takes its non-transactional path and
// calls updateBookingPayment directly, which is what these tests inspect.
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    getBookingById: vi.fn(),
    updateBookingPayment: vi.fn(),
  },
}));
vi.mock("../repositories/BankTransferRepository", () => ({
  BankTransferRepository: { updateTransferStatus: vi.fn(), updateTransferStatusByExternalId: vi.fn() },
}));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../_core/email", () => ({ sendAlertEmail: vi.fn() }));

/**
 * Booking #181 as Alohacamp actually settles it: a 2700 zł stay (2 × 900 base +
 * 900 cleaning), 675 zł zaliczka paid by the guest to the portal, 498.15 zł host
 * commission, 2201.85 zł total payout.
 *
 * The owner is owed 2201.85 + 500 kaucja and has received nothing yet, so
 * `amountPaid` is 0 — it only ever records money that reached their account:
 * 176.85 forwarded by the portal, 2025 from the guest directly, 500 kaucja.
 */
const awaitingEverything = {
  id: 181,
  channel: "alohacamp",
  property: "Sadoles",
  status: "confirmed",
  depositStatus: "pending",
  guestName: "Serhii Kozachenko",
  checkIn: new Date("2026-10-02"),
  checkOut: new Date("2026-10-04"),
  totalPrice: "2700.00",
  amountPaid: "0.00",
  reservationFee: "675.00",
  commission: "498.15",
  hostRevenue: "2201.85",
  depositAmount: "500.00",
  animalsCount: null,
};

/** A forward from the portal itself. */
const portalTransfer = (amount: number) => ({
  amount,
  currency: "PLN",
  senderName: "ALOHACAMP SP. Z O.O.",
  transferTitle: "Wypłata 202608952357",
  transferDate: new Date("2026-08-13"),
  accountNumber: "123",
});

/** The guest paying the owner's account directly, as on Slowhop. */
const guestTransfer = (amount: number) => ({
  amount,
  currency: "PLN",
  senderName: "SERHII KOZACHENKO",
  transferTitle: "Sadoles 2-4.10 dopłata",
  transferDate: new Date("2026-09-20"),
  accountNumber: "123",
});

const lastUpdate = () => (BookingRepository.updateBookingPayment as any).mock.calls.at(-1)[1];

describe("Alohacamp two-step settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (BookingRepository.getBookingById as any).mockResolvedValue(awaitingEverything);
  });

  it("recognises the zaliczka forward (zaliczka − prowizja = 176.85)", async () => {
    await applyTransferMatch(181, portalTransfer(176.85) as any, 95);

    const update = lastUpdate();
    // Before this branch existed the transfer fell through to the generic portal
    // logic, which read 176.85 as the whole payment and flipped the booking to
    // `paid` with a mismatch alert.
    expect(update.status).toBe("confirmed");
    expect(update.depositStatus).toBe("pending");
    // First money to actually reach the owner. 2201.85 − 176.85 = 2025 still to
    // come for the stay, plus the kaucja.
    expect(update.amountPaid).toBe("176.85");
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("marks the stay paid when the guest transfers the balance directly", async () => {
    // The remaining 2025 zł comes from the guest to the owner's account, as on
    // Slowhop — not as a second forward from the portal.
    (BookingRepository.getBookingById as any).mockResolvedValue({
      ...awaitingEverything,
      amountPaid: "176.85",
    });

    await applyTransferMatch(181, guestTransfer(2025) as any, 95);

    const update = lastUpdate();
    expect(update.status).toBe("paid");
    // 176.85 + 2025 = the full 2201.85 payout; only the kaucja is left.
    expect(update.amountPaid).toBe("2201.85");
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("settles balance and kaucja paid together in one transfer", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue({
      ...awaitingEverything,
      amountPaid: "176.85",
    });

    await applyTransferMatch(181, guestTransfer(2525) as any, 95);

    const update = lastUpdate();
    expect(update.status).toBe("paid");
    expect(update.depositStatus).toBe("paid");
    expect(update.amountPaid).toBe("2701.85");
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("records the kaucja without touching the booking status", async () => {
    await applyTransferMatch(181, guestTransfer(500) as any, 95);

    const update = lastUpdate();
    expect(update.depositStatus).toBe("paid");
    expect(update.status).toBe("confirmed");
    expect(update.amountPaid).toBe("500.00");
  });

  it("settles a stay paid to the portal in full from a single payout", async () => {
    // No zaliczka to split, so the generic portal branch applies: the guest has
    // settled with Alohacamp (portal_paid, nothing received yet) and the payout
    // of hostRevenue closes the booking.
    (BookingRepository.getBookingById as any).mockResolvedValue({
      ...awaitingEverything,
      status: "portal_paid",
      totalPrice: "3000.00",
      amountPaid: "0.00",
      reservationFee: null,
      commission: "553.50",
      hostRevenue: "2446.50",
    });

    await applyTransferMatch(181, portalTransfer(2446.5) as any, 95);

    const update = lastUpdate();
    expect(update.status).toBe("paid");
    expect(update.amountPaid).toBe("2446.50");
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("leaves the Slowhop forward accounting untouched", async () => {
    (BookingRepository.getBookingById as any).mockResolvedValue({
      ...awaitingEverything,
      channel: "slowhop",
      totalPrice: "1400.00",
      amountPaid: "0.00",
      reservationFee: "420.00",
      commission: "258.30",
      hostRevenue: "1141.70",
    });

    await applyTransferMatch(181, portalTransfer(161.7) as any, 95);

    const update = lastUpdate();
    expect(update.status).toBe("confirmed");
    expect(update.amountPaid).toBe("161.70");
  });
});
