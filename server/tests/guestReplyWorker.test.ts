import { describe, it, expect, vi, beforeEach } from "vitest";
import { processGuestReplyDrafts } from "../workers/guestReplyWorker";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";
import { BookingRepository } from "../repositories/BookingRepository";
import { generateReplyDraft } from "../services/ReplyDraftService";
import { sendDraftForApproval } from "../_core/email";

vi.mock("../repositories/GuestReplyRepository", () => ({
  GuestReplyRepository: { findPendingDrafting: vi.fn(), update: vi.fn() },
}));
vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: { getBookingById: vi.fn(), findBlockingBookingsForEarlyArrival: vi.fn() },
}));
vi.mock("../services/ReplyDraftService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ReplyDraftService")>()),
  generateReplyDraft: vi.fn(),
}));
vi.mock("../_core/email", () => ({ sendDraftForApproval: vi.fn().mockResolvedValue(true) }));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));

const row = (over: Record<string, unknown> = {}) => ({
  id: 10,
  bookingId: 5,
  inboundFrom: "jan@example.com",
  inboundSubject: "Pytanie",
  inboundBody: "O której możemy przyjechać?",
  ...over,
});

const booking = {
  id: 5,
  property: "Sadoles",
  channel: "direct",
  checkIn: new Date("2099-08-14T16:00:00Z"),
  checkOut: new Date("2099-08-17T10:00:00Z"),
  guestName: "Jan Kowalski",
  purpose: "leisure",
  companyName: null,
} as any;

const draft = {
  draft: {
    shouldReply: true,
    intent: "question_logistics",
    needsHuman: false,
    missingInfo: [],
    language: "PL",
    subject: "Re: Pytanie",
    body: "Od 16.",
    notes: "ok",
    proposedAnimalsCount: null,
  },
  provider: "fake",
  model: "fake-model",
  durationMs: 5,
};

describe("processGuestReplyDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (BookingRepository.getBookingById as any).mockResolvedValue(booking);
    (BookingRepository.findBlockingBookingsForEarlyArrival as any).mockResolvedValue([]);
    (generateReplyDraft as any).mockResolvedValue(draft);
  });

  it("drafts a reply and mails it for approval without sending anything to the guest", async () => {
    (GuestReplyRepository.findPendingDrafting as any).mockResolvedValue([row()]);

    const summary = await processGuestReplyDrafts();

    expect(summary.drafted).toBe(1);
    expect(sendDraftForApproval).toHaveBeenCalledTimes(1);
    // Everything waits for the owner — nothing is queued for delivery.
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: "pending", intent: "question_logistics" })
    );
  });

  it("cancels an autoresponder instead of drafting a reply to a machine", async () => {
    (GuestReplyRepository.findPendingDrafting as any).mockResolvedValue([
      row({ inboundSubject: "Automatyczna odpowiedź", inboundBody: "Jestem na urlopie" }),
    ]);

    const summary = await processGuestReplyDrafts();

    expect(summary.skipped).toBe(1);
    expect(generateReplyDraft).not.toHaveBeenCalled();
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: "cancelled", cancelledBy: "system" })
    );
  });

  it("escalates an unmatched email rather than drafting without a fact sheet", async () => {
    (GuestReplyRepository.findPendingDrafting as any).mockResolvedValue([row({ bookingId: null })]);

    const summary = await processGuestReplyDrafts();

    expect(summary.skipped).toBe(1);
    expect(generateReplyDraft).not.toHaveBeenCalled();
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: "pending", needsHuman: 1 })
    );
  });

  it("marks the row failed when the model returns nothing usable", async () => {
    (GuestReplyRepository.findPendingDrafting as any).mockResolvedValue([row()]);
    (generateReplyDraft as any).mockResolvedValue(null);

    const summary = await processGuestReplyDrafts();

    expect(summary.failed).toBe(1);
    expect(sendDraftForApproval).not.toHaveBeenCalled();
    expect(GuestReplyRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: "failed" })
    );
  });

  it("keeps going after one row fails", async () => {
    (GuestReplyRepository.findPendingDrafting as any).mockResolvedValue([row({ id: 1 }), row({ id: 2 })]);
    (generateReplyDraft as any).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(draft);

    const summary = await processGuestReplyDrafts();

    expect(summary.failed).toBe(1);
    expect(summary.drafted).toBe(1);
  });
});
