import { Booking } from "../../drizzle/schema";
import { format } from "date-fns";

/**
 * Generates an RFC 5545 compliant iCal string for a set of bookings.
 */
export function generateIcalString(property: string, bookings: Booking[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReZENwator//Guest Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${property} Bookings`,
  ];

  for (const b of bookings) {
    const start = format(new Date(b.checkIn), "yyyyMMdd");
    const end = format(new Date(b.checkOut), "yyyyMMdd");
    const uid = b.icalUid || `manual-${b.id}@rezenwator`;
    const summary = b.guestName ? `Reserved: ${b.guestName}` : "Reserved";

    lines.push("BEGIN:VEVENT");
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`UID:${uid}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}
