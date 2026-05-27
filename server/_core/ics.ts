import { Booking } from "../../drizzle/schema";
import { format, addDays, subDays } from "date-fns";

/**
 * Generates an RFC 5545 compliant iCal string for a set of bookings.
 */
export function generateIcalString(property: string, bookings: Booking[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReZENwator//NONSGML iCal Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${property} Bookings (v${format(new Date(), "yyyyMMddHHmm")})`,
  ];

  for (const b of bookings) {
    const checkInDate = new Date(b.checkIn);
    const checkOutDate = new Date(b.checkOut);
    const uid = b.icalUid || `manual-${b.id}@rezenwator`;
    const summary = b.guestName ? `Reserved: ${b.guestName}` : "Reserved";
    const timestamp = new Date(b.updatedAt || b.createdAt || new Date()).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    // 1. Primary Booking Event
    // DTSTART: Arrival Day
    // DTEND: Departure Day (Exclusive)
    const startStr = format(checkInDate, "yyyyMMdd");
    let endStr = format(checkOutDate, "yyyyMMdd");

    // If it's a same-day booking (e.g. 8 AM to 8 PM), start and end would be the same.
    // RFC 5545 requires DTEND > DTSTART for VALUE=DATE.
    if (startStr === endStr) {
      endStr = format(addDays(checkOutDate, 1), "yyyyMMdd");
    }

    lines.push("BEGIN:VEVENT");
    lines.push(`DTSTART;VALUE=DATE:${startStr}`);
    lines.push(`DTEND;VALUE=DATE:${endStr}`);
    lines.push(`DTSTAMP:${timestamp}`);
    lines.push(`LAST-MODIFIED:${timestamp}`);
    lines.push(`SEQUENCE:15`);
    lines.push(`UID:${uid}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");

    // 2. Early Arrival Turnover Protection
    // If check-in is before 1:00 PM, we must explicitly block the PREVIOUS night.
    // We emit a separate event for the night before to force OTAs to respect it.
    if (checkInDate.getHours() < 13) {
      const turnStart = format(subDays(checkInDate, 1), "yyyyMMdd");
      const turnEnd = format(checkInDate, "yyyyMMdd");
      
      lines.push("BEGIN:VEVENT");
      lines.push(`DTSTART;VALUE=DATE:${turnStart}`);
      lines.push(`DTEND;VALUE=DATE:${turnEnd}`);
      lines.push(`DTSTAMP:${timestamp}`);
      lines.push(`UID:${uid}-turn-arr`);
      lines.push(`SUMMARY:Turnover Protection (Early Arrival): ${summary}`);
      lines.push("STATUS:CONFIRMED");
      lines.push("TRANSP:OPAQUE");
      lines.push("END:VEVENT");
    }

    // 3. Late Departure Turnover Protection
    // If check-out is after 12:00 PM, we must explicitly block the CURRENT night.
    if (checkOutDate.getHours() >= 12) {
      const turnStart = format(checkOutDate, "yyyyMMdd");
      const turnEnd = format(addDays(checkOutDate, 1), "yyyyMMdd");
      
      lines.push("BEGIN:VEVENT");
      lines.push(`DTSTART;VALUE=DATE:${turnStart}`);
      lines.push(`DTEND;VALUE=DATE:${turnEnd}`);
      lines.push(`DTSTAMP:${timestamp}`);
      lines.push(`UID:${uid}-turn-dep`);
      lines.push(`SUMMARY:Turnover Protection (Late Departure): ${summary}`);
      lines.push("STATUS:CONFIRMED");
      lines.push("TRANSP:OPAQUE");
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}
