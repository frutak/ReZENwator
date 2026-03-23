/**
 * Email Parsers
 *
 * Parses booking confirmation emails from Slowhop, Airbnb, and Nestbank
 * payment notifications. Each parser returns a structured object that can
 * be used to enrich or match bookings in the database.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParsedBookingEmail = {
  type: "booking";
  channel: "slowhop" | "airbnb" | "booking" | "alohacamp";
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  checkIn?: Date;
  checkOut?: Date;
  adultsCount?: number;
  childrenCount?: number;
  animalsCount?: number;
  totalPrice?: number;
  hostRevenue?: number;
  amountPaid?: number;
  currency?: string;
  property?: string;
  rawText: string;
};

export type ParsedBankEmail = {
  type: "bank";
  bank: "nestbank";
  amount?: number;
  currency?: string;
  senderName?: string;
  transferTitle?: string;
  transferDate?: Date;
  rawText: string;
};

export type ParsedEmail = ParsedBookingEmail | ParsedBankEmail | null;

// ─── Date parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse Polish/European date format: "28-03-2026" → Date
 */
function parseDMY(dateStr: string): Date | undefined {
  const match = dateStr.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (!match) return undefined;
  const [, d, m, y] = match;
  const date = new Date(parseInt(y!), parseInt(m!) - 1, parseInt(d!));
  return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parse Airbnb date format: "Sat 27 Jun" or "Mon 29 Jun" (assumes current/next year)
 */
function parseAirbnbDate(dateStr: string): Date | undefined {
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
  // If the month has already passed this year, assume next year
  const candidate = new Date(year, month, day);
  if (candidate < now && month < now.getMonth()) year++;

  return new Date(year, month, day);
}

/**
 * Parse Polish date format: "02.03.2026" → Date
 */
function parseDotDate(dateStr: string): Date | undefined {
  const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return undefined;
  const [, d, m, y] = match;
  const date = new Date(parseInt(y!), parseInt(m!) - 1, parseInt(d!));
  return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parse Booking.com date format: "Fri, Mar 27, 2026"
 */
function parseBookingComDate(dateStr: string): Date | undefined {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  // Format: "Fri, Mar 27, 2026" or "Mar 27, 2026"
  const match = dateStr.trim().match(/(?:\w{3},\s+)?(\w{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return undefined;
  const monthKey = match[1]!.toLowerCase().substring(0, 3);
  const day = parseInt(match[2]!);
  const year = parseInt(match[3]!);
  const month = months[monthKey];
  if (month === undefined) return undefined;

  return new Date(year, month, day);
}

/**
 * Parse price string: "1 800,00 PLN" or "2862 zł" or "2,451.25 zł" → number
 * Handles both dot and comma as decimal or thousands separators.
 */
function parsePrice(priceStr: string): { amount: number; currency: string } | undefined {
  if (!priceStr) return undefined;
  const currency = priceStr.toLowerCase().includes("pln") || priceStr.includes("zł") || priceStr.includes("zl")
    ? "PLN"
    : "PLN";
    
  // Remove currency symbols and non-numeric/separator chars
  const cleaned = priceStr
    .replace(/[^\d,.\s]/g, "")
    .trim();

  // Remove all spaces
  const noSpaces = cleaned.replace(/\s/g, "");

  let amount: number;
  
  // Logic:
  // 1. Both separators exist: unambiguous
  if (noSpaces.includes(",") && noSpaces.includes(".")) {
    if (noSpaces.indexOf(",") < noSpaces.indexOf(".")) {
      // 1,234.56 (US style)
      amount = parseFloat(noSpaces.replace(/,/g, ""));
    } else {
      // 1.234,56 (EU style)
      amount = parseFloat(noSpaces.replace(/\./g, "").replace(",", "."));
    }
  } 
  // 2. Only comma exists
  else if (noSpaces.includes(",")) {
    const parts = noSpaces.split(",");
    if (parts.length > 2) {
      // Multiple commas: 1,000,000
      amount = parseFloat(noSpaces.replace(/,/g, ""));
    } else {
      // Single comma: 1,600 or 123,45
      const decimals = parts[1]!.length;
      if (decimals === 3) {
        // Assume thousands separator if exactly 3 digits after (e.g. 1,600)
        amount = parseFloat(noSpaces.replace(",", ""));
      } else {
        // Otherwise assume decimal separator (e.g. 123,45 or 1,5)
        amount = parseFloat(noSpaces.replace(",", "."));
      }
    }
  }
  // 3. Only dot exists
  else if (noSpaces.includes(".")) {
    const parts = noSpaces.split(".");
    if (parts.length > 2) {
      // Multiple dots: 1.000.000
      amount = parseFloat(noSpaces.replace(/\./g, ""));
    } else {
      // Single dot: 1.600 or 123.45
      const decimals = parts[1]!.length;
      if (decimals === 3) {
        // Assume thousands separator if exactly 3 digits after (e.g. 1.600)
        amount = parseFloat(noSpaces.replace(".", ""));
      } else {
        // Otherwise assume decimal separator (e.g. 123.45)
        amount = parseFloat(noSpaces);
      }
    }
  }
  else {
    amount = parseFloat(noSpaces);
  }

  return isNaN(amount) ? undefined : { amount, currency };
}

// ─── Slowhop parser ───────────────────────────────────────────────────────────

/**
 * Parses Slowhop booking confirmation emails (Polish language).
 *
 * Example subject: "Rezerwacja nr 1222769 w dniach 28-03-2026 - 01-04-2026 dla Evelina De Lain została potwierdzona i opłacona"
 */
export function parseSlowhoEmail(subject: string, body: string): ParsedBookingEmail | null {
  const text = `${subject}\n${body}`;

  // Extract dates from subject: "w dniach 28-03-2026 - 01-04-2026"
  const datesMatch = subject.match(/w dniach\s+(\d{1,2}-\d{1,2}-\d{4})\s*-\s*(\d{1,2}-\d{1,2}-\d{4})/i);
  const checkIn = datesMatch ? parseDMY(datesMatch[1]!) : undefined;
  const checkOut = datesMatch ? parseDMY(datesMatch[2]!) : undefined;

  // Extract guest name from subject: "dla Evelina De Lain"
  const nameMatch = subject.match(/dla\s+(.+?)\s+zosta[łl]a?\s+potwierdzona/i);
  const guestName = nameMatch ? nameMatch[1]!.trim() : undefined;

  // Extract phone: "Nr telefonu: 447956002507"
  const phoneMatch = body.match(/Nr telefonu:\s*([+\d\s]+)/i);
  const guestPhone = phoneMatch ? phoneMatch[1]!.trim() : undefined;

  // Extract email: "Adres e-mail: evelinajazz@gmail.com"
  const emailMatch = body.match(/Adres e-mail:\s*([^\s\n]+@[^\s\n]+)/i);
  const guestEmail = emailMatch ? emailMatch[1]!.trim() : undefined;

  // Extract guest counts: "2  dorosłych + 0 dzieci + 0 zwierząt"
  const guestMatch = body.match(/(\d+)\s+doros[łl]ych\s*\+\s*(\d+)\s+dzieci\s*\+\s*(\d+)\s+zwierz/i);
  const adultsCount = guestMatch ? parseInt(guestMatch[1]!) : undefined;
  const childrenCount = guestMatch ? parseInt(guestMatch[2]!) : undefined;
  const animalsCount = guestMatch ? parseInt(guestMatch[3]!) : undefined;

  // Extract total price: "Cena całkowita: 1800 pln"
  const priceMatch = body.match(/Cena ca[łl]kowita:\s*([\d\s,]+(?:pln|zł|zl)?)/i);
  const priceData = priceMatch ? parsePrice(priceMatch[1]!) : undefined;

  // Extract pre-payment: "Wysokość opłaconej przedpłaty: 1212 pln"
  const paidMatch = body.match(/Wysoko[śs][ćc]\s+op[łl]aconej\s+przedp[łl]aty:\s*([\d\s,]+(?:pln|zł|zl)?)/i);
  const paidData = paidMatch ? parsePrice(paidMatch[1]!) : undefined;

  // Extract property name: look for "Hacjenda" or "Sadoles"/"Sadoleś"
  let property: string | undefined;
  if (text.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (text.toLowerCase().includes("sadole")) property = "Sadoles";

  return {
    type: "booking",
    channel: "slowhop",
    guestName,
    guestEmail,
    guestPhone,
    checkIn,
    checkOut,
    adultsCount,
    childrenCount,
    animalsCount,
    totalPrice: priceData?.amount,
    amountPaid: paidData?.amount,
    currency: priceData?.currency ?? "PLN",
    property,
    rawText: text.substring(0, 2000),
  };
}

// ─── Airbnb parser ────────────────────────────────────────────────────────────

/**
 * Parses Airbnb booking confirmation emails.
 *
 * Example subject: "Reservation confirmed - Vlad Svidrickiy arrives 27 Jun"
 */
export function parseAirbnbEmail(subject: string, body: string): ParsedBookingEmail | null {
  const text = `${subject}\n${body}`;

  // Extract guest name from subject: "Vlad Svidrickiy arrives"
  const nameMatch = subject.match(/(?:confirmed\s*[-–]\s*)(.+?)\s+arrives/i);
  const guestName = nameMatch ? nameMatch[1]!.trim() : undefined;

  // Extract check-in from subject: "arrives 27 Jun"
  const arrivalMatch = subject.match(/arrives\s+(.+)/i);
  const checkIn = arrivalMatch ? parseAirbnbDate(arrivalMatch[1]!) : undefined;

  // Extract check-out from body: "Checkout\nMon 29 Jun"
  const checkoutMatch = body.match(/Checkout\s*\n\s*(\w{3}\s+\d{1,2}\s+\w{3})/i);
  const checkOut = checkoutMatch ? parseAirbnbDate(checkoutMatch[1]!) : undefined;

  // Extract check-in from body as fallback: "Check-in\nSat 27 Jun"
  const checkinBodyMatch = body.match(/Check-in\s*\n\s*(\w{3}\s+\d{1,2}\s+\w{3})/i);
  const checkInFallback = checkinBodyMatch ? parseAirbnbDate(checkinBodyMatch[1]!) : undefined;

  // Extract guest counts: "11 adults, 1 child" or "2 guests"
  const guestsMatch = body.match(/(\d+)\s+adults?,\s*(\d+)\s+child/i);
  const adultsCount = guestsMatch ? parseInt(guestsMatch[1]!) : undefined;
  const childrenCount = guestsMatch ? parseInt(guestsMatch[2]!) : undefined;

  // Extract total price: "Total (PLN)\n2,862.00 zl"
  const totalMatch = body.match(/Total\s*\(PLN\)\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);
  const totalData = totalMatch ? parsePrice(totalMatch[1]!) : undefined;

  // Extract host revenue: "You earn\n2,451.25 zł"
  const revenueMatch = body.match(/You earn\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);
  const revenueData = revenueMatch ? parsePrice(revenueMatch[1]!) : undefined;

  // Extract property: look for property names
  let property: string | undefined;
  if (text.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (text.toLowerCase().includes("sadoles") || text.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    type: "booking",
    channel: "airbnb",
    guestName,
    checkIn: checkIn ?? checkInFallback,
    checkOut,
    adultsCount,
    childrenCount,
    totalPrice: totalData?.amount,
    hostRevenue: revenueData?.amount,
    currency: "PLN",
    property,
    rawText: text.substring(0, 2000),
  };
}

// ─── Booking.com parser ──────────────────────────────────────────────────────

/**
 * Parses custom Booking.com template emails.
 *
 * Example subject: "Nowa rezerwacja: Yaroslava Senenko (6365579963)"
 */
export function parseBookingComEmail(subject: string, body: string): ParsedBookingEmail | null {
  const text = `${subject}\n${body}`;

  // Extract guest name from subject
  const nameMatch = subject.match(/Nowa rezerwacja:\s*(.+?)\s*\((\d+)\)/i);
  const guestName = nameMatch ? nameMatch[1]!.trim() : undefined;

  // Extract property: "Obiekt: Sadoleś 66"
  const propertyMatch = body.match(/Obiekt:\s*(.+?)(?:\s+Go[śs][ćc]|$)/i);
  const rawProperty = propertyMatch ? propertyMatch[1]!.trim() : "";
  let property: string | undefined;
  if (rawProperty.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (rawProperty.toLowerCase().includes("sadole")) property = "Sadoles";

  // Extract dates: "Termin: Fri, Mar 27, 2026 do Sun, Mar 29, 2026"
  const datesMatch = body.match(/Termin:\s*(.+?)\s+do\s+(.+?)(?:\s+Cena|$)/i);
  const checkIn = datesMatch ? parseBookingComDate(datesMatch[1]!) : undefined;
  const checkOut = datesMatch ? parseBookingComDate(datesMatch[2]!) : undefined;

  // Extract total price: "Cena dla gościa: PLN 2,666.67"
  const priceMatch = body.match(/Cena dla go[śs]cia:\s*([\w\s,.]+)/i);
  const priceData = priceMatch ? parsePrice(priceMatch[1]!) : undefined;

  // Extract commission to calculate host revenue: "Prowizja Booking: PLN 337.33"
  const commMatch = body.match(/Prowizja Booking:\s*([\w\s,.]+)/i);
  const commData = commMatch ? parsePrice(commMatch[1]!) : undefined;

  const hostRevenue = priceData && commData ? priceData.amount - commData.amount : undefined;

  // Extract email: "Email gościa: ysenen.962336@guest.booking.com"
  const emailMatch = body.match(/Email go[śs]cia:\s*([^\s\n]+@[^\s\n]+)/i);
  const guestEmail = emailMatch ? emailMatch[1]!.trim() : undefined;

  return {
    type: "booking",
    channel: "booking",
    guestName,
    guestEmail,
    checkIn,
    checkOut,
    totalPrice: priceData?.amount,
    hostRevenue,
    currency: priceData?.currency ?? "PLN",
    property,
    rawText: text.substring(0, 2000),
  };
}

// ─── Nestbank parser ──────────────────────────────────────────────────────────

/**
 * Parses Nestbank payment confirmation emails (Polish language).
 *
 * Example subject: "Wpływ na konto BIZnest Konto 11...0001"
 * Example body: "dnia 02.03.2026 nastąpił wpływ 1500,00 PLN na konto ..., od RENNER LAURA ANNA, tytułem Laura Renner 7.03 wpłata."
 */
export function parseNestbankEmail(subject: string, body: string): ParsedBankEmail | null {
  const text = `${subject}\n${body}`;

  // Check this is a Nestbank incoming transfer
  if (!text.toLowerCase().includes("wpływ") && !text.toLowerCase().includes("nest")) {
    return null;
  }

  // Extract date: "dnia 02.03.2026"
  const dateMatch = body.match(/dnia\s+(\d{1,2}\.\d{1,2}\.\d{4})/i);
  const transferDate = dateMatch ? parseDotDate(dateMatch[1]!) : undefined;

  // Extract amount: "wpływ 1500,00 PLN" or "wpływ 1 500,00 PLN"
  const amountMatch = body.match(/wp[łl]yw\s+([\d\s,]+(?:PLN|zł|zl)?)/i);
  const amountData = amountMatch ? parsePrice(amountMatch[1]!) : undefined;

  // Extract sender: "od RENNER LAURA ANNA"
  const senderMatch = body.match(/od\s+([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ\s]+?)(?:,\s*tytu[łl]em|\.|\n)/i);
  const senderName = senderMatch ? senderMatch[1]!.trim() : undefined;

  // Extract transfer title: "tytułem Laura Renner 7.03 wpłata"
  const titleMatch = body.match(/tytu[łl]em\s+(.+?)(?:\.|$)/im);
  const transferTitle = titleMatch ? titleMatch[1]!.trim() : undefined;

  return {
    type: "bank",
    bank: "nestbank",
    amount: amountData?.amount,
    currency: amountData?.currency ?? "PLN",
    senderName,
    transferTitle,
    transferDate,
    rawText: text.substring(0, 1000),
  };
}

// ─── Email type detector ──────────────────────────────────────────────────────

export type EmailSource =
  | "slowhop"
  | "airbnb"
  | "nestbank"
  | "booking"
  | "unknown";

/**
 * Detects the source/type of an email based on sender and subject.
 */
export function detectEmailSource(
  from: string,
  subject: string,
  body: string
): EmailSource {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase().substring(0, 500);

  if (fromLower.includes("booking.com") || subjectLower.includes("booking.com") || bodyLower.includes("booking.com")) {
    return "booking";
  }
  if (fromLower.includes("slowhop") || bodyLower.includes("slowhop") || (subjectLower.includes("rezerwacja") && subjectLower.includes("slowhop"))) {
    return "slowhop";
  }
  if (fromLower.includes("airbnb") || subjectLower.includes("reservation confirmed") || subjectLower.includes("arrives")) {
    return "airbnb";
  }
  if (fromLower.includes("nestbank") || fromLower.includes("nest bank") || subjectLower.includes("wpływ na konto biznest")) {
    return "nestbank";
  }
  if (fromLower.includes("booking.com") || subjectLower.includes("booking.com")) {
    return "booking";
  }
  return "unknown";
}

/**
 * Main dispatcher: parse an email and return structured data.
 */
export function parseEmail(
  from: string,
  subject: string,
  body: string
): ParsedEmail {
  const source = detectEmailSource(from, subject, body);

  switch (source) {
    case "slowhop":
      return parseSlowhoEmail(subject, body);
    case "airbnb":
      return parseAirbnbEmail(subject, body);
    case "nestbank":
      return parseNestbankEmail(subject, body);
    case "booking":
      return parseBookingComEmail(subject, body);
    default:
      return null;
  }
}
