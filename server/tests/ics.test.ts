import { describe, it, expect } from "vitest";
import { generateIcalString } from "../_core/ics";
import { Booking } from "../../shared/schema";

describe("generateIcalString", () => {
  it("generates a basic iCal string", () => {
    const bookings: any[] = [
      {
        id: 1,
        checkIn: "2026-05-01T00:00:00.000Z",
        checkOut: "2026-05-05T00:00:00.000Z",
        guestName: "John Doe",
        createdAt: new Date("2026-04-01T12:00:00Z"),
        updatedAt: new Date("2026-04-01T12:00:00Z"),
      },
    ];

    const ics = generateIcalString("Test Property", bookings);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Reserved: John Doe");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260501");
    expect(ics).toContain("DTEND;VALUE=DATE:20260505");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("adds turnover protection for early arrival", () => {
    const bookings: any[] = [
      {
        id: 2,
        checkIn: "2026-05-01T10:00:00.000Z", // Before 1:00 PM
        checkOut: "2026-05-05T10:00:00.000Z",
        guestName: "Early Bird",
        createdAt: new Date(),
      },
    ];

    const ics = generateIcalString("Test Property", bookings);
    expect(ics).toContain("SUMMARY:Turnover Protection (Early Arrival)");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260430");
    expect(ics).toContain("DTEND;VALUE=DATE:20260501");
  });

  it("adds turnover protection for late departure", () => {
    const bookings: any[] = [
      {
        id: 3,
        checkIn: "2026-05-01T14:00:00.000Z",
        checkOut: "2026-05-05T13:00:00.000Z", // After 12:00 PM
        guestName: "Late Leaver",
        createdAt: new Date(),
      },
    ];

    const ics = generateIcalString("Test Property", bookings);
    expect(ics).toContain("SUMMARY:Turnover Protection (Late Departure)");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260505");
    expect(ics).toContain("DTEND;VALUE=DATE:20260506");
  });
});
