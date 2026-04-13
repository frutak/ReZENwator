import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingService } from "../services/BookingService";
import { PricingService } from "../services/PricingService";
import * as dbModule from "../db";
import { Logger } from "../_core/logger";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../services/PricingService", () => ({
  PricingService: {
    calculatePrice: vi.fn(),
  },
}));

vi.mock("../_core/logger", () => ({
  Logger: {
    bookingAction: vi.fn(),
  },
}));

vi.mock("../_core/email", () => ({
  sendGuestEmail: vi.fn(),
  sendAlertEmail: vi.fn(),
}));

describe("BookingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a booking successfully when dates are available", async () => {
    const mockPricing = {
      valid: true,
      totalPrice: 500,
      days: 2,
    };
    (PricingService.calculatePrice as any).mockResolvedValue(mockPricing);

    const mockInsertResult = { insertId: 100 };
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([mockInsertResult])
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ 
              id: 100, 
              property: "Sadoles",
              checkIn: new Date(),
              checkOut: new Date(),
              guestName: "John",
              guestEmail: "john@example.com",
              totalPrice: "500"
            }])
          })
        })
      })
    };
    (dbModule.getDb as any).mockResolvedValue(mockDb);

    const params = {
      property: "Sadoles" as const,
      checkIn: new Date("2026-06-01T16:00:00Z"),
      checkOut: new Date("2026-06-03T10:00:00Z"),
      guestName: "John Doe",
      guestEmail: "john@example.com",
      guestPhone: "123456789",
      guestCount: 2,
      animalsCount: 0,
    };

    const result = await BookingService.createBooking(params);

    expect(result.success).toBe(true);
    expect(result.bookingId).toBe(100);
    expect(PricingService.calculatePrice).toHaveBeenCalled();
    expect(Logger.bookingAction).toHaveBeenCalledWith(100, "system", expect.any(String), expect.any(String));
  });

  it("throws error when pricing service returns invalid (already booked)", async () => {
    (PricingService.calculatePrice as any).mockResolvedValue({
      valid: false,
      error: "Selected dates are no longer available"
    });

    const params = {
      property: "Sadoles" as const,
      checkIn: new Date("2026-06-01T16:00:00Z"),
      checkOut: new Date("2026-06-03T10:00:00Z"),
      guestName: "John Doe",
      guestEmail: "john@example.com",
      guestPhone: "123456789",
      guestCount: 2,
      animalsCount: 0,
    };

    await expect(BookingService.createBooking(params)).rejects.toThrow("Selected dates are no longer available");
  });
});
