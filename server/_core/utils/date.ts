
/**
 * Date parsing utilities for booking feeds and emails.
 */

/**
 * Parse Polish/European date format: "28-03-2026" → Date
 */
export function parseDMY(dateStr: string): Date | undefined {
  const match = dateStr.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (!match) return undefined;
  const [, d, m, y] = match;
  const date = new Date(parseInt(y!), parseInt(m!) - 1, parseInt(d!));
  return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parse Polish date format: "02.03.2026" → Date
 */
export function parseDotDate(dateStr: string): Date | undefined {
  const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return undefined;
  const [, d, m, y] = match;
  const date = new Date(parseInt(y!), parseInt(m!) - 1, parseInt(d!));
  return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parse Airbnb date format: "Sat 27 Jun" or "Mon 29 Jun" (assumes current/next year)
 */
export function parseAirbnbDate(dateStr: string): Date | undefined {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const match = dateStr.trim().match(/(?:\w{3}\s+)?(\d{1,2})\s+(\w{3})/i);
  if (!match) return undefined;
  const day = parseInt(match[1]!);
  const monthKey = match[2]!.toLowerCase().substring(0, 3);
  const month = months[monthKey];
  if (month === undefined) return undefined;

  const now = new Date();
  let year = now.getFullYear();
  // Assume current year. Only move to next year if month is early (Jan/Feb) and we are late in the year (Nov/Dec)
  // or if the date is more than 6 months in the past.
  const candidate = new Date(year, month, day);
  if (now.getTime() - candidate.getTime() > 180 * 24 * 60 * 60 * 1000) {
    year++;
  }

  return new Date(year, month, day);
}

/**
 * Parse Airbnb full date: "Mon, 29 Jun 2026" or "29 Jun 2026"
 */
export function parseAirbnbFullDate(dateStr: string): Date | undefined {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const match = dateStr.trim().match(/(?:\w{3},\s+)?(\d{1,2})\s+(\w{3})\s+(\d{4})/i);
  if (!match) return undefined;
  const day = parseInt(match[1]!);
  const monthKey = match[2]!.toLowerCase().substring(0, 3);
  const year = parseInt(match[3]!);
  const month = months[monthKey];
  if (month === undefined) return undefined;

  return new Date(year, month, day);
}

/**
 * Parse Booking.com date format: "Fri, Mar 27, 2026" or "27 mar 2026" or "27.03.2026"
 */
export function parseBookingComDate(dateStr: string): Date | undefined {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    sty: 0, lut: 1, kwi: 3, maj: 4, cze: 5,
    lip: 6, sie: 7, wrz: 8, paź: 9, paz: 9, lis: 10, gru: 11,
  };

  const cleaned = dateStr.trim().toLowerCase().replace(/^od\s+/, "");

  // 1. Try dot format: 27.03.2026
  if (cleaned.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
    return parseDotDate(cleaned);
  }

  // 2. Try English/Full: "Fri, Mar 27, 2026" or "Mar 27, 2026"
  const enMatch = cleaned.match(/(?:\w{2,4}\.?,?\s+)?(\w{3,10})\.?\s+(\d{1,2}),\s+(\d{4})/i);
  if (enMatch) {
    const monthKey = enMatch[1]!.substring(0, 3).toLowerCase();
    const day = parseInt(enMatch[2]!);
    const year = parseInt(enMatch[3]!);
    const month = months[monthKey];
    if (month !== undefined) return new Date(year, month, day);
  }

  // 3. Try Polish/Alternative: "27 mar 2026" or "śr., 27 mar 2026" or "27 marzec 2026"
  const plMatch = cleaned.match(/(?:\w{2,4}\.?,?\s+)?(\d{1,2})\s+(\w{3,10})\.?\s+(\d{4})/i);
  if (plMatch) {
    const day = parseInt(plMatch[1]!);
    const monthKey = plMatch[2]!.substring(0, 3).toLowerCase();
    const year = parseInt(plMatch[3]!);
    const month = months[monthKey];
    if (month !== undefined) return new Date(year, month, day);
  }

  return undefined;
}
