import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBankTransfer } from "../workers/emailPoller";
import { transferContentKey, BankTransferRepository } from "../repositories/BankTransferRepository";
import { applyTransferMatch } from "../workers/bookingMatcher";
import { findMatchingBookings } from "../workers/bookingMatcher";
import { sendAlertEmail } from "../_core/email";
import type { ParsedBankData } from "../workers/emailParsers";

/**
 * Not paying the same money twice.
 *
 * Three gates stand between a bank notification and a booking's balance:
 * `processed_emails` (this message was handled), `bank_transfers.externalId`
 * (this message became a transfer) and `bank_transfers.contentKey` (this
 * *payment* became a transfer, whichever message carried it). The first two key
 * on the email, so they cannot see the same notification arriving as a second
 * message — which is what these cover.
 *
 * The April 2026 incident is the reason any of this exists: bank notifications
 * were re-processed over three days and `amountPaid` was incremented again each
 * time, leaving a phantom 500 zł kaucja on booking #62 among others.
 */

vi.mock("../repositories/BankTransferRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/BankTransferRepository")>();
  return {
    ...actual,
    BankTransferRepository: {
      insertTransfer: vi.fn(),
      findByContentKey: vi.fn().mockResolvedValue([]),
      claimMatch: vi.fn(),
      updateTransferStatus: vi.fn(),
      updateTransferStatusByExternalId: vi.fn(),
    },
  };
});
vi.mock("../workers/bookingMatcher", () => ({
  findMatchingBookings: vi.fn().mockResolvedValue([]),
  applyTransferMatch: vi.fn(),
  revertTransferMatch: vi.fn(),
}));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../_core/email", () => ({
  sendAlertEmail: vi.fn(),
  forwardUnmatchedEmail: vi.fn(),
  GMAIL_USER: "furtka.rentals@gmail.com",
}));

/** The Slowhop forward for booking #172, as it really landed. */
const transfer: ParsedBankData = {
  amount: 161.7,
  currency: "PLN",
  senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  transferTitle: "Slowhop przedpłaty id: 1345090 (Mar ia Satsiuk ).",
  transferDate: new Date("2026-07-21T00:00:00Z"),
  accountNumber: "11187010452078106769980001",
};

const email = (messageId: string) => ({ messageId, subject: "Wpływ na konto BIZnest Konto 11", from: "bank", body: "" });

describe("payment fingerprint", () => {
  it("is the same for the same payment reported by two different emails", () => {
    // Identical money, and nothing about the message enters the key.
    expect(transferContentKey(transfer)).toBe(transferContentKey({ ...transfer }));
  });

  it("ignores the time of day, which a re-delivery can change", () => {
    expect(transferContentKey({ ...transfer, transferDate: new Date("2026-07-21T18:42:00Z") })).toBe(
      transferContentKey(transfer)
    );
  });

  it("separates payments that differ in amount, sender, title or day", () => {
    const base = transferContentKey(transfer);
    expect(transferContentKey({ ...transfer, amount: 161.71 })).not.toBe(base);
    expect(transferContentKey({ ...transfer, senderName: "SLOWHOP SP. Z O.O." })).not.toBe(base);
    expect(transferContentKey({ ...transfer, transferTitle: "Slowhop przedpłaty id: 1345091" })).not.toBe(base);
    expect(transferContentKey({ ...transfer, transferDate: new Date("2026-07-22T00:00:00Z") })).not.toBe(base);
  });

  it("does not separate payments over casing or padding in the text", () => {
    // The bank pads names into fixed-width fields, and a forward can re-case
    // them; neither changes the money.
    expect(
      transferContentKey({ ...transfer, senderName: "  slowhop spółka z ograniczoną odpowiedzialnością  " })
    ).toBe(transferContentKey(transfer));
  });
});

describe("bank notification arriving twice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (findMatchingBookings as any).mockResolvedValue([]);
  });

  it("applies the payment the first time", async () => {
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({ inserted: true });
    (findMatchingBookings as any).mockResolvedValue([{ bookingId: 172, score: 110, booking: {}, reasons: [] }]);

    await handleBankTransfer(transfer, email("<first@bank>"), false);

    expect(applyTransferMatch).toHaveBeenCalledTimes(1);
    // The fingerprint travels with the row, not with the message.
    expect((BankTransferRepository.insertTransfer as any).mock.calls[0][0].contentKey).toBe(
      transferContentKey(transfer)
    );
  });

  it("stays silent when the very same message is processed again", async () => {
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({ inserted: false });

    await handleBankTransfer(transfer, email("<first@bank>"), false);

    expect(applyTransferMatch).not.toHaveBeenCalled();
    // Nothing happened worth telling the owner about — the email was simply
    // seen before.
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("refuses the money and raises it with the owner when a second message carries it", async () => {
    // This is the gap the content key closes: a different Message-ID clears
    // both `processed_emails` and `externalId`, and the payment would land on
    // the booking a second time.
    (BankTransferRepository.insertTransfer as any).mockResolvedValue({
      inserted: false,
      duplicateOf: { id: 57, externalId: "<first@bank>", transferDate: transfer.transferDate },
    });
    (findMatchingBookings as any).mockResolvedValue([{ bookingId: 172, score: 110, booking: {}, reasons: [] }]);

    await handleBankTransfer(transfer, email("<second@bank>"), false);

    expect(applyTransferMatch).not.toHaveBeenCalled();
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    const [subject, text] = (sendAlertEmail as any).mock.calls[0];
    expect(subject).toContain("duplikat");
    // The owner needs both to judge it: which transfer it collided with, and
    // that a genuine second payment has to be entered by hand.
    expect(text).toContain("#57");
    expect(text).toContain("ręcznie");
  });
});
