import { describe, it, expect, vi, beforeEach } from "vitest";
import { processGuestEmails } from "../workers/guestEmailWorker";
import { BookingRepository } from "../repositories/BookingRepository";
import { GuestEmailRepository } from "../repositories/GuestEmailRepository";
import * as emailModule from "../_core/email";

vi.mock("../repositories/BookingRepository");
vi.mock("../repositories/GuestEmailRepository");
vi.mock("../_core/email", () => ({
  sendGuestEmail: vi.fn(),
  getRecipientForEmail: vi.fn(),
}));
vi.mock("../_core/logger");

describe("Internal Bookings Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("guestEmailWorker", () => {
    it("skips internal bookings in processGuestEmails", async () => {
      const mockBookings = [
        { id: 125, type: "internal", status: "confirmed", guestName: "Family", guestEmail: null, channel: "direct", checkIn: new Date(), checkOut: new Date() },
        { id: 126, type: "normal", status: "confirmed", guestName: "Real Guest", guestEmail: "guest@example.com", channel: "direct", checkIn: new Date(Date.now() + 86400000 * 30), checkOut: new Date(Date.now() + 86400000 * 35) }
      ];

      (BookingRepository.findActiveBookingsForEmails as any).mockResolvedValue(mockBookings);
      (GuestEmailRepository.findEmailsByBookingId as any).mockResolvedValue([]);
      (emailModule.sendGuestEmail as any).mockResolvedValue({ success: true, recipient: "guest@example.com" });

      const summary = await processGuestEmails();

      // Should skip #125 (internal) and process #126 (normal)
      expect(summary.sentCount).toBe(1);
      expect(summary.details.some(d => d.includes("#125"))).toBe(false);
      expect(summary.details.some(d => d.includes("#126"))).toBe(true);
      
      // Verify sendGuestEmail was NOT called for #125
      expect(emailModule.sendGuestEmail).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 125 }));
      // Verify sendGuestEmail WAS called for #126
      expect(emailModule.sendGuestEmail).toHaveBeenCalledWith("booking_confirmed", expect.objectContaining({ id: 126 }));
    });
  });
});
