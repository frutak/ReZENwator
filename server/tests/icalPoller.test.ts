import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollICalFeed } from "../workers/icalPoller";
import { BookingRepository } from "../repositories/BookingRepository";
import { sendAlertEmail } from "../_core/email";
import axios from "axios";
import ical from "node-ical";

vi.mock("axios");
vi.mock("node-ical", () => ({
  default: {
    async: {
      parseICS: vi.fn(),
    },
  },
}));

vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    getBookingByIcalUid: vi.fn(),
    updateIcalBooking: vi.fn(),
    findOverlapCandidates: vi.fn().mockResolvedValue([]),
    insertBooking: vi.fn(),
    findMissingBookings: vi.fn().mockResolvedValue([]),
    updateBookingStatus: vi.fn(),
    countActiveBookings: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../_core/logger", () => ({
  Logger: {
    system: vi.fn(),
    bookingAction: vi.fn(),
  },
}));

vi.mock("../_core/email", () => ({
  sendAlertEmail: vi.fn(),
}));

describe("iCalPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() clears call history but NOT mockResolvedValue overrides,
    // so explicitly restore these to their safe defaults each test to prevent a
    // test that mocks a mass-cancellation scenario from leaking into later tests.
    (BookingRepository.findMissingBookings as any).mockResolvedValue([]);
    (BookingRepository.countActiveBookings as any).mockResolvedValue(0);
  });

  it("does not redundantly update booking if dates and summary are same", async () => {
    const mockFeed: any = {
      label: "Test Feed",
      url: "http://example.com/ical",
      property: "Sadoles",
      channel: "airbnb"
    };

    (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
    (ical.async.parseICS as any).mockResolvedValue({
      "uid1": {
        type: "VEVENT",
        start: new Date("2026-06-01T16:00:00Z"),
        end: new Date("2026-06-05T10:00:00Z"),
        summary: "Airbnb (Not available)",
        description: ""
      }
    });

    const existingBooking = {
      id: 1,
      icalUid: "uid1",
      checkIn: new Date("2026-06-01T16:00:00Z"),
      checkOut: new Date("2026-06-05T10:00:00Z"),
      icalSummary: "Airbnb (Not available)"
    };
    (BookingRepository.getBookingByIcalUid as any).mockResolvedValue(existingBooking);

    const result = await pollICalFeed(mockFeed);
    
    expect(result.updatedBookings).toBe(0);
    expect(BookingRepository.updateIcalBooking).not.toHaveBeenCalled();
  });

  it("updates booking when summary changes", async () => {
    const mockFeed: any = {
      label: "Test Feed",
      url: "http://example.com/ical",
      property: "Sadoles",
      channel: "airbnb"
    };

    (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
    (ical.async.parseICS as any).mockResolvedValue({
      "uid1": {
        type: "VEVENT",
        start: new Date("2026-06-01T16:00:00Z"),
        end: new Date("2026-06-05T10:00:00Z"),
        summary: "NEW SUMMARY",
        description: ""
      }
    });

    const existingBooking = {
      id: 1,
      icalUid: "uid1",
      checkIn: new Date("2026-06-01T16:00:00Z"),
      checkOut: new Date("2026-06-05T10:00:00Z"),
      icalSummary: "OLD SUMMARY"
    };
    (BookingRepository.getBookingByIcalUid as any).mockResolvedValue(existingBooking);

    const result = await pollICalFeed(mockFeed);
    
    expect(result.updatedBookings).toBe(1);
    expect(BookingRepository.updateIcalBooking).toHaveBeenCalled();
  });

  it("auto-recovers a cancelled booking when it reappears in the feed", async () => {
    const mockFeed: any = { label: "Test Feed", url: "http://example.com/ical", property: "Sadoles", channel: "booking" };
    (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
    (ical.async.parseICS as any).mockResolvedValue({
      "uid1": { type: "VEVENT", start: new Date("2026-07-01T16:00:00Z"), end: new Date("2026-07-05T10:00:00Z"), summary: "Booking" }
    });

    const existingCancelledBooking = {
      id: 1,
      icalUid: "uid1",
      status: "cancelled",
      checkIn: new Date("2026-07-01T16:00:00Z"),
      checkOut: new Date("2026-07-05T10:00:00Z"),
      icalSummary: "Booking"
    };
    (BookingRepository.getBookingByIcalUid as any).mockResolvedValue(existingCancelledBooking);

    await pollICalFeed(mockFeed);
    
    expect(BookingRepository.updateBookingStatus).toHaveBeenCalledWith(1, "confirmed");
  });

  it("blocks mass cancellation if more than 1 and >30% of bookings are missing", async () => {
    const mockFeed: any = { label: "Test Feed", url: "http://example.com/ical", property: "Sadoles", channel: "booking" };
    (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
    // iCal feed only returns 1 of the 3 active bookings
    (ical.async.parseICS as any).mockResolvedValue({
      "uid1": { type: "VEVENT", start: new Date("2026-07-01T16:00:00Z"), end: new Date("2026-07-05T10:00:00Z"), summary: "Booking 1" }
    });
    
    (BookingRepository.getBookingByIcalUid as any).mockResolvedValue(null); // Return null for the one booking in the feed
    (BookingRepository.countActiveBookings as any).mockResolvedValue(3); // 3 bookings exist in DB
    (BookingRepository.findMissingBookings as any).mockResolvedValue([ // 2 are missing
      { id: 2, icalUid: "uid2", checkIn: new Date("2026-08-01") },
      { id: 3, icalUid: "uid3", checkIn: new Date("2026-09-01") },
    ]);

    await pollICalFeed(mockFeed);
    
    // 2/3 is > 30%, so cancellation should be blocked
    expect(BookingRepository.updateBookingStatus).not.toHaveBeenCalled();
  });

  it("correctly identifies channel as 'slowhop' even with 'booking' in summary", async () => {
    const mockFeed: any = { label: "Slowhop Feed", url: "http://example.com/ical", property: "Sadoles", channel: "slowhop" };
    (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
    (ical.async.parseICS as any).mockResolvedValue({
      "slowhop-uid1": { type: "VEVENT", start: new Date("2026-08-01"), end: new Date("2026-08-05"), summary: "booking - 12345 finalized" }
    });

    (BookingRepository.getBookingByIcalUid as any).mockResolvedValue(null);
    (BookingRepository.insertBooking as any).mockResolvedValue([ { insertId: 99 } ]);

    await pollICalFeed(mockFeed);

    expect(BookingRepository.insertBooking).toHaveBeenCalledWith(expect.objectContaining({
      channel: "slowhop"
    }));
  });

  // A portal cancelling a stay does not touch `amountPaid`, so a booking that
  // had already been paid for goes quiet with the guest's money still sitting on
  // the account. The alert named the guest, the property and the dates — but not
  // the amount, which is the only part that needs a decision.
  describe("cancellation alert", () => {
    const futureFeed: any = {
      label: "Hacjenda / Airbnb",
      url: "http://example.com/ical",
      property: "Hacjenda",
      channel: "airbnb",
    };

    const cancelledBooking = (over: Record<string, any> = {}) => ({
      id: 91,
      guestName: "Anna Nowak",
      property: "Hacjenda",
      channel: "airbnb",
      // Far enough ahead that disappearing from the feed counts as a cancellation.
      checkIn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      checkOut: new Date(Date.now() + 33 * 24 * 60 * 60 * 1000),
      amountPaid: "0.00",
      depositAmount: "500.00",
      depositStatus: "not_applicable",
      ...over,
    });

    const runWithMissing = async (booking: any) => {
      (axios.get as any).mockResolvedValue({ data: "dummy-ics" });
      (ical.async.parseICS as any).mockResolvedValue({});
      (BookingRepository.findMissingBookings as any).mockResolvedValue([booking]);
      (BookingRepository.countActiveBookings as any).mockResolvedValue(10);
      await pollICalFeed(futureFeed);
      return (sendAlertEmail as any).mock.calls.at(-1);
    };

    it("states the amount still held when the stay was paid for", async () => {
      const [subject, text] = await runWithMissing(
        cancelledBooking({ amountPaid: "1352.00" })
      );

      expect(subject).toContain("1352.00");
      expect(text).toContain("DO ZWROTU");
      expect(text).toContain("1352.00");
    });

    it("calls out a kaucja held on top of the stay", async () => {
      const [, text] = await runWithMissing(
        cancelledBooking({ amountPaid: "1852.00", depositStatus: "paid" })
      );

      expect(text).toContain("1852.00");
      expect(text).toContain("kaucja 500.00");
    });

    it("says plainly when there is nothing to refund", async () => {
      const [subject, text] = await runWithMissing(cancelledBooking());

      expect(subject).not.toContain("zł");
      expect(text).toContain("nic nie wpłynęło");
      expect(text).not.toContain("DO ZWROTU");
    });
  });

});
