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
  guestCountry?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestCount?: number;
  checkIn?: Date;
  checkOut?: Date;
  adultsCount?: number;
  childrenCount?: number;
  animalsCount?: number;
  totalPrice?: number;
  commission?: number;
  hostRevenue?: number;
  amountPaid?: number;
  currency?: string;
  property?: string;
  rawText: string;
  /** New fields for payment confirmations */
  isPaymentConfirmation?: boolean;
  bookingObjectId?: string;
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
 * Parse Booking.com date format: "Fri, Mar 27, 2026" or "27 mar 2026" or "27.03.2026"
 */
function parseBookingComDate(dateStr: string): Date | undefined {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    // Polish: mar is same as English Mar
    sty: 0, lut: 1, kwi: 3, maj: 4, cze: 5,
    lip: 6, sie: 7, wrz: 8, paź: 9, paz: 9, lis: 10, gru: 11,
  };

  const cleaned = dateStr.trim().toLowerCase().replace(/^od\s+/, "");

  // 1. Try dot format: 27.03.2026
  if (cleaned.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
    return parseDotDate(cleaned);
  }

  // 2. Try English/Full: "Fri, Mar 27, 2026" or "Mar 27, 2026"
  const enMatch = cleaned.match(/(?:\w{2,4},\s+)?(\w{3,10})\s+(\d{1,2}),\s+(\d{4})/i);
  if (enMatch) {
    const monthKey = enMatch[1]!.substring(0, 3).toLowerCase();
    const day = parseInt(enMatch[2]!);
    const year = parseInt(enMatch[3]!);
    const month = months[monthKey];
    if (month !== undefined) return new Date(year, month, day);
  }

  // 3. Try Polish/Alternative: "27 mar 2026" or "śr., 27 mar 2026" or "27 marzec 2026"
  const plMatch = cleaned.match(/(?:\w{2,4}\.?,\s+)?(\d{1,2})\s+(\w{3,10})\s+(\d{4})/i);
  if (plMatch) {
    const day = parseInt(plMatch[1]!);
    const monthKey = plMatch[2]!.substring(0, 3).toLowerCase();
    const year = parseInt(plMatch[3]!);
    const month = months[monthKey];
    if (month !== undefined) return new Date(year, month, day);
  }

  return undefined;
}

/**
 * Parse Airbnb full date: "Mon, 29 Jun 2026" or "29 Jun 2026"
 */
function parseAirbnbFullDate(dateStr: string): Date | undefined {
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

  // Extract country: "PL" if phone starts with 48
  const guestCountry = (guestPhone?.startsWith("48") || guestPhone?.startsWith("+48")) ? "PL" : undefined;

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
    guestCount: (adultsCount ?? 0) + (childrenCount ?? 0),
    adultsCount,
    childrenCount,
    animalsCount,
    totalPrice: priceData?.amount,
    amountPaid: paidData?.amount,
    currency: priceData?.currency ?? "PLN",
    property,
    guestCountry,
    rawText: text.substring(0, 2000),
  };
}

/**
 * Parses Slowhop pre-payment transfer notification emails.
 *
 * Example subject: "Przelew przedpłaty za rezerwacje id 1222769 na Slowhop"
 */
export function parseSlowhopTransferEmail(subject: string, body: string): ParsedBookingEmail | null {
  const text = `${subject}\n${body}`;

  // Extract table values
  // Body has a structure where amounts are followed by zł/zl
  // 1222769 (Evelina De Lain, 28-03-2026 - 01-04-2026) 1800 zł 540 zł 270 zł 207.9 zł
  const prices = Array.from(body.matchAll(/(\d+[\s,.]*\d*)\s*(?:zł|zl|pln)/gi));
  
  const totalPriceData = prices[0] ? parsePrice(prices[0][0]) : undefined;
  const amountPaidData = prices[1] ? parsePrice(prices[1][0]) : undefined;
  const commissionData = prices[2] ? parsePrice(prices[2][0]) : undefined;

  const hostRevenue = totalPriceData && commissionData ? totalPriceData.amount - commissionData.amount : undefined;

  // Extract Guest Name and Dates from parentheses: (Guest Name, DD-MM-YYYY - DD-MM-YYYY)
  const detailMatch = body.match(/\(([^,)]+),\s*(\d{1,2}-\d{1,2}-\d{4})\s*-\s*(\d{1,2}-\d{1,2}-\d{4})\)/i);
  const guestName = detailMatch ? detailMatch[1]!.trim() : undefined;
  const checkIn = detailMatch ? parseDMY(detailMatch[2]!) : undefined;
  const checkOut = detailMatch ? parseDMY(detailMatch[3]!) : undefined;

  return {
    type: "booking",
    channel: "slowhop",
    guestName,
    checkIn,
    checkOut,
    totalPrice: totalPriceData?.amount,
    amountPaid: amountPaidData?.amount,
    hostRevenue,
    currency: "PLN",
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

  // ─── Date Extraction ───
  
  // 1. Full dates (Check-in/Checkout) - common in forwarded/desktop emails
  // Format: "Check-in\nMon, 29 Jun 2026"
  const fullCheckInMatch = body.match(/Check-in\s*\n?\s*([\w,.\s]+\d{4})/i);
  const fullCheckOutMatch = body.match(/Checkout\s*\n?\s*([\w,.\s]+\d{4})/i);
  
  let checkIn = fullCheckInMatch ? parseAirbnbFullDate(fullCheckInMatch[1]!) : undefined;
  let checkOut = fullCheckOutMatch ? parseAirbnbFullDate(fullCheckOutMatch[1]!) : undefined;

  // 2. Short dates fallback
  if (!checkIn) {
    // From subject: "arrives 27 Jun"
    const arrivalMatch = subject.match(/arrives\s+(.+)/i);
    checkIn = arrivalMatch ? parseAirbnbDate(arrivalMatch[1]!) : undefined;
    
    // From body: "Check-in\nSat 27 Jun"
    if (!checkIn) {
      const checkinBodyMatch = body.match(/Check-in\s*\n\s*(\w{3}\s+\d{1,2}\s+\w{3})/i);
      checkIn = checkinBodyMatch ? parseAirbnbDate(checkinBodyMatch[1]!) : undefined;
    }
  }

  if (!checkOut) {
    // From body: "Checkout\nMon 29 Jun"
    const checkoutMatch = body.match(/Checkout\s*\n\s*(\w{3}\s+\d{1,2}\s+\w{3})/i);
    checkOut = checkoutMatch ? parseAirbnbDate(checkoutMatch[1]!) : undefined;
  }

  // ─── Guest Counts ───
  
  // Format: "2 adults, 1 child"
  const guestsMatch = body.match(/(\d+)\s+adults?(?:,\s*(\d+)\s+child)?/i);
  let adultsCount = guestsMatch ? parseInt(guestsMatch[1]!) : undefined;
  let childrenCount = guestsMatch ? (guestsMatch[2] ? parseInt(guestsMatch[2]) : 0) : undefined;
  let guestCount: number | undefined;

  if (adultsCount !== undefined) {
    guestCount = adultsCount + (childrenCount || 0);
  } else {
    // Fallback: "3 guests"
    const singleGuestMatch = body.match(/(\d+)\s+guests?/i);
    if (singleGuestMatch) {
      guestCount = parseInt(singleGuestMatch[1]!);
    }
  }

  // ─── Pricing ───
  
  // Extract total price: "Total (PLN)\n2,862.00 zl"
  const totalMatch = body.match(/Total\s*\(PLN\)\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);
  const totalData = totalMatch ? parsePrice(totalMatch[1]!) : undefined;

  // Extract host revenue: "You earn\n2,451.25 zł"
  const revenueMatch = body.match(/You earn\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);
  const revenueData = revenueMatch ? parsePrice(revenueMatch[1]!) : undefined;

  // ─── Metadata ───
  
  let guestCountry: string | undefined;
  if (body.toLowerCase().includes("poland")) {
    guestCountry = "PL";
  }

  // Extract property: look for property names
  let property: string | undefined;
  if (text.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (text.toLowerCase().includes("sadoles") || text.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    type: "booking",
    channel: "airbnb",
    guestName,
    checkIn,
    checkOut,
    guestCount,
    adultsCount,
    childrenCount,
    totalPrice: totalData?.amount,
    hostRevenue: revenueData?.amount,
    currency: "PLN",
    property,
    guestCountry,
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
  // Normalize whitespace: replace all newlines/tabs with spaces to handle hard-wrapped emails
  const normalizedBody = body.replace(/\s+/g, " ");
  const text = `${subject}\n${normalizedBody}`;

  // Extract guest name from subject (old format) or body (new format)
  // Old: "Nowa rezerwacja: Yaroslava Senenko (6365579963)"
  // New: "Gość: Yaroslava Senenko"
  const nameMatchSubject = subject.match(/Nowa rezerwacja:\s*(.+?)\s*\((\d+)\)/i);
  const nameMatchBody = normalizedBody.match(/Go[śs][ćc]:\s*(.+?)(?:\s+Kraj|\s+Termin|$)/i);
  const guestName = (nameMatchSubject ? nameMatchSubject[1]! : nameMatchBody ? nameMatchBody[1]! : "").trim() || undefined;

  // Extract guest country: "Kraj: Poland"
  const countryMatch = normalizedBody.match(/Kraj:\s*(.+?)(?:\s+Liczba|$)/i);
  const guestCountry = countryMatch ? countryMatch[1]!.trim() : undefined;

  // Extract property: "Obiekt: Sadoleś 66"
  const propertyMatch = normalizedBody.match(/Obiekt:\s*(.+?)(?:\s+Go[śs][ćc]|\s+ID|$)/i);
  const rawProperty = propertyMatch ? propertyMatch[1]!.trim() : "";
  let property: string | undefined;
  if (rawProperty.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (rawProperty.toLowerCase().includes("sadole")) property = "Sadoles";

  // Extract dates: "Termin: Fri, Mar 27, 2026 do Sun, Mar 29, 2026" or "Termin: od 25.03.2026 do 27.03.2026"
  const datesMatch = normalizedBody.match(/Termin:\s*(.+?)\s+(?:do|-|–)\s+(.+?)(?:\s+Cena|$)/i);
  const checkIn = datesMatch ? parseBookingComDate(datesMatch[1]!) : undefined;
  const checkOut = datesMatch ? parseBookingComDate(datesMatch[2]!) : undefined;

  // Extract guest count: "Liczba gości: 2"
  const guestCountMatch = normalizedBody.match(/Liczba go[śs]ci:?\s*(\d+)/i);
  const guestCount = guestCountMatch ? parseInt(guestCountMatch[1]!) : undefined;

  // Extract total price: "Cena dla gościa: PLN 2,666.67"
  const priceMatch = normalizedBody.match(/Cena dla go[śs]cia:\s*([\w\s,.]+?)(?:\s+Prowizja|$)/i);
  const priceData = priceMatch ? parsePrice(priceMatch[1]!) : undefined;

  // Extract commission to calculate host revenue: "Prowizja Booking: PLN 337.33"
  const commMatch = normalizedBody.match(/Prowizja Booking:\s*([\w\s,.]+?)(?:\s+Email|\s+ID|$)/i);
  const commData = commMatch ? parsePrice(commMatch[1]!) : undefined;

  const hostRevenue = priceData && commData ? priceData.amount - commData.amount : undefined;

  // Extract email: "Email gościa: ysenen.962336@guest.booking.com"
  const emailMatch = normalizedBody.match(/Email go[śs]cia:\s*([^\s]+@[^\s]+)/i);
  const guestEmail = emailMatch ? emailMatch[1]!.trim().replace(/\.$/, "") : undefined;

  return {
    type: "booking",
    channel: "booking",
    guestName,
    guestCountry,
    guestEmail,
    guestCount,
    checkIn,
    checkOut,
    totalPrice: priceData?.amount,
    commission: commData?.amount,
    hostRevenue,
    currency: priceData?.currency ?? "PLN",
    property,
    rawText: text.substring(0, 2000),
  };
}

/**
 * Parses Booking.com payment confirmation emails.
 * Subject contains "payment confirmation" and Booking Object ID.
 */
export function parseBookingComPaymentEmail(subject: string, body: string): ParsedBookingEmail | null {
  const text = `${subject}\n${body}`;
  const normalizedText = text.toLowerCase();
  
  // 1. Extract IDs. Try both (123) and 123 from transfer title
  // For the user's specific email: "tytułem NO.KKVGU0PWZEEWZSZN/13324071"
  const objectIdMatch = subject.match(/\((\d{7,10})\)/) || body.match(/(\d{7,10})/);
  const bookingObjectId = objectIdMatch ? objectIdMatch[1] : undefined;

  // Determine property based on the ID provided by user
  let property: string | undefined;
  if (bookingObjectId === "13416371") property = "Hacjenda";
  else if (bookingObjectId === "13324071") property = "Sadoles";
  // Fallback property detection from text
  if (!property) {
    if (normalizedText.includes("hacjenda")) property = "Hacjenda";
    else if (normalizedText.includes("sadole")) property = "Sadoles";
  }

  // 2. Extract guest name (Booking.com usually includes it in the body if it's a specific stay payment)
  const guestMatch = body.match(/Go[śs][ćc]:\s*(.+?)(?:\s+Termin|\s+Kraj|\s+ID|$)/i) || 
                     body.match(/stay\s+by\s+(.+?)(?:\s+at|$)/i) ||
                     body.match(/dla\s+(.+?)(?:\s+zosta[łl]a|$)/i);
  const guestName = guestMatch ? guestMatch[1]!.trim() : undefined;

  // 3. Extract payment amount (handles standard and bank-style "wpływ X PLN")
  const amountMatch = body.match(/(?:wp[łl]yw|kwot[ęe]|wysoko[śs][ćc]|p[łl]atno[śs][ćc])\s+([\d\s,.]+(?:pln|zł|zl)?)/i);
  const amountData = amountMatch ? parsePrice(amountMatch[1]!) : undefined;

  return {
    type: "booking",
    channel: "booking",
    isPaymentConfirmation: true,
    bookingObjectId,
    guestName,
    property,
    amountPaid: amountData?.amount,
    currency: amountData?.currency ?? "PLN",
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
  | "slowhop_transfer"
  | "airbnb"
  | "nestbank"
  | "booking"
  | "booking_payment"
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
  const bodyLower = body.toLowerCase().substring(0, 2000);

  if (subjectLower.includes("przelew przedpłaty") && subjectLower.includes("slowhop")) {
    return "slowhop_transfer";
  }
  
  if (fromLower.includes("booking.com") || 
      subjectLower.includes("booking.com") || 
      bodyLower.includes("booking.com") ||
      bodyLower.includes("13324071") || 
      bodyLower.includes("13416371")) {
    if (subjectLower.includes("payment confirmation") || 
        subjectLower.includes("potwierdzenie płatności") ||
        (subjectLower.includes("wpływ") && (bodyLower.includes("booking.com") || bodyLower.includes("13324071") || bodyLower.includes("13416371")))) {
      return "booking_payment";
    }
    return "booking";
  }

  if (fromLower.includes("slowhop") || bodyLower.includes("slowhop") || (subjectLower.includes("rezerwacja") && subjectLower.includes("slowhop"))) {
    return "slowhop";
  }
  if (fromLower.includes("airbnb") || subjectLower.includes("reservation confirmed") || subjectLower.includes("arrives") || bodyLower.includes("from: airbnb <automated@airbnb.com>")) {
    return "airbnb";
  }
  if (fromLower.includes("nestbank") || fromLower.includes("nest bank") || subjectLower.includes("wpływ na konto biznest")) {
    return "nestbank";
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
    case "slowhop_transfer":
      return parseSlowhopTransferEmail(subject, body);
    case "airbnb":
      return parseAirbnbEmail(subject, body);
    case "nestbank":
      return parseNestbankEmail(subject, body);
    case "booking":
      return parseBookingComEmail(subject, body);
    case "booking_payment":
      return parseBookingComPaymentEmail(subject, body);
    default:
      return null;
  }
}
