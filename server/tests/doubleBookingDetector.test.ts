import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectDoubleBookings } from "../workers/doubleBookingDetector";
import { BookingRepository } from "../repositories/BookingRepository";

vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    getActiveBookingsForOverlapCheck: vi.fn(),
  },
}));

describe("DoubleBookingDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects real overlap", async () => {
    const mockBookings = [
      {
        id: 1,
        property: "Sadoles",
        checkIn: new Date("2026-05-01T16:00:00Z"),
        checkOut: new Date("2026-05-05T10:00:00Z"),
        channel: "direct",
        guestName: "Guest A",
        status: "confirmed"
      },
      {
        id: 2,
        property: "Sadoles",
        checkIn: new Date("2026-05-04T16:00:00Z"),
        checkOut: new Date("2026-05-07T10:00:00Z"),
        channel: "airbnb",
        guestName: "Guest B",
        status: "confirmed"
      }
    ];
    (BookingRepository.getActiveBookingsForOverlapCheck as any).mockResolvedValue(mockBookings);

    const conflicts = await detectDoubleBookings();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].booking1.id).toBe(1);
    expect(conflicts[0].booking2.id).toBe(2);
  });

  it("does NOT flag same-day turnover with 6h+ gap", async () => {
    const mockBookings = [
      {
        id: 1,
        property: "Sadoles",
        checkIn: new Date("2026-05-01T16:00:00Z"),
        checkOut: new Date("2026-05-05T10:00:00Z"), // Check-out 10 AM
        channel: "direct",
        guestName: "Guest A",
        status: "confirmed"
      },
      {
        id: 2,
        property: "Sadoles",
        checkIn: new Date("2026-05-05T16:00:00Z"), // Check-in 4 PM (6h gap)
        checkOut: new Date("2026-05-07T10:00:00Z"),
        channel: "airbnb",
        guestName: "Guest B",
        status: "confirmed"
      }
    ];
    (BookingRepository.getActiveBookingsForOverlapCheck as any).mockResolvedValue(mockBookings);

    const conflicts = await detectDoubleBookings();
    expect(conflicts.length).toBe(0);
  });

  it("FLAGS same-day turnover with LESS than 6h gap", async () => {
    const mockBookings = [
      {
        id: 1,
        property: "Sadoles",
        checkIn: new Date("2026-05-01T16:00:00Z"),
        checkOut: new Date("2026-05-05T12:00:00Z"), // Check-out 12 PM
        channel: "direct",
        guestName: "Guest A",
        status: "confirmed"
      },
      {
        id: 2,
        property: "Sadoles",
        checkIn: new Date("2026-05-05T11:00:00Z"), // Check-in 11 AM (REAL OVERLAP: starts before 1 ends)
        checkOut: new Date("2026-05-07T10:00:00Z"),
        channel: "airbnb",
        guestName: "Guest B",
        status: "confirmed"
      }
    ];
    (BookingRepository.getActiveBookingsForOverlapCheck as any).mockResolvedValue(mockBookings);

    const conflicts = await detectDoubleBookings();
    expect(conflicts.length).toBe(1);
  });
});
