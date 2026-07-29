import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";
import { BookingRepository } from "../repositories/BookingRepository";
import { sendApprovedReply } from "../_core/email";
import type { TrpcContext } from "../_core/context";

vi.mock("../repositories/GuestReplyRepository", () => ({
  GuestReplyRepository: {
    getById: vi.fn(),
    update: vi.fn(),
    claimForSending: vi.fn(),
    listForReview: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: { getBookingById: vi.fn(), updateBookingDetails: vi.fn() },
}));
vi.mock("../_core/email", () => ({
  sendApprovedReply: vi.fn(),
  sendGuestEmail: vi.fn(),
  sendAlertEmail: vi.fn(),
}));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn(), system: vi.fn() } }));

const ctx = {
  user: { id: 1, role: "user", openId: "u", email: "o@example.com", name: "O" },
  req: { protocol: "https", headers: {} },
  res: {},
} as unknown as TrpcContext;

const caller = () => appRouter.createCaller(ctx);

const draft = {
  id: 7,
  bookingId: 5,
  status: "pending",
  draftSubject: "Re: Pytanie",
  draftBody: "Treść od modelu.",
  editedBody: null,
  inboundSubject: "Pytanie",
  inboundMessageId: "<abc@mail.example.com>",
  proposedAnimalsCount: null,
};

const booking = {
  id: 5,
  property: "Sadoles",
  guestEmail: "jan@example.com",
  animalsCount: 0,
};

describe("guestReplies.approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (GuestReplyRepository.getById as any).mockResolvedValue(draft);
    (BookingRepository.getBookingById as any).mockResolvedValue(booking);
    (GuestReplyRepository.claimForSending as any).mockResolvedValue(true);
    (sendApprovedReply as any).mockResolvedValue({ messageId: "<sent@x>" });
  });

  it("sends the draft threaded onto the guest's own message", async () => {
    await caller().guestReplies.approve({ id: 7 });

    expect(sendApprovedReply).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jan@example.com",
        inReplyTo: "<abc@mail.example.com>",
        body: "Treść od modelu.",
      })
    );
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: "sent", sentMessageId: "<sent@x>" })
    );
  });

  it("prefers the body the owner has on screen over the model's", async () => {
    await caller().guestReplies.approve({ id: 7, body: "Moja wersja." });

    expect(sendApprovedReply).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Moja wersja." })
    );
  });

  // The claim is the only thing standing between a double click and two
  // identical emails landing in a guest's inbox.
  it("refuses to send when the row was already claimed", async () => {
    (GuestReplyRepository.claimForSending as any).mockResolvedValue(false);

    await expect(caller().guestReplies.approve({ id: 7 })).rejects.toThrow(/już wysłany|trakcie/i);
    expect(sendApprovedReply).not.toHaveBeenCalled();
  });

  it("returns the draft to pending when delivery fails, instead of losing it", async () => {
    (sendApprovedReply as any).mockResolvedValue(null);

    await expect(caller().guestReplies.approve({ id: 7 })).rejects.toThrow();
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: "pending" })
    );
  });

  it("applies the proposed animal count only on approval", async () => {
    (GuestReplyRepository.getById as any).mockResolvedValue({ ...draft, proposedAnimalsCount: 1 });

    const result = await caller().guestReplies.approve({ id: 7 });

    expect(BookingRepository.updateBookingDetails).toHaveBeenCalledWith(5, { animalsCount: 1 });
    expect(result.animalsApplied).toBe(true);
  });

  it("leaves the booking alone when the model proposed nothing", async () => {
    const result = await caller().guestReplies.approve({ id: 7 });

    expect(BookingRepository.updateBookingDetails).not.toHaveBeenCalled();
    expect(result.animalsApplied).toBe(false);
  });

  it("refuses a draft with no booking rather than guessing a recipient", async () => {
    (GuestReplyRepository.getById as any).mockResolvedValue({ ...draft, bookingId: null });

    await expect(caller().guestReplies.approve({ id: 7 })).rejects.toThrow(/rezerwacji/i);
    expect(sendApprovedReply).not.toHaveBeenCalled();
  });
});
