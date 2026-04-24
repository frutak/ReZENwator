import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollICalFeed } from "../workers/icalPoller";
import { BookingRepository } from "../repositories/BookingRepository";
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
  },
}));

vi.mock("../_core/logger", () => ({
  Logger: {
    system: vi.fn(),
    bookingAction: vi.fn(),
  },
}));

describe("iCalPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
