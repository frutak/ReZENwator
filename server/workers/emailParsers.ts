import { Booking } from "../../drizzle/schema";
import { parsePrice, parseDMY, parseDotDate, parseAirbnbDate, parseAirbnbFullDate, parseBookingComDate } from "../_core/utils/index";
import { setHours, setMinutes } from "date-fns";
import { type Property } from "@shared/config";
import { ENV } from "../_core/env";

// ─── Template Types ───────────────────────────────────────────────────────────

export type EmailTemplateType = 
  | "BANK_TRANSFER"       // Template 1
  | "BOOKING_CONFIRMATION" // Template 2
  | "OTHER";              // Template 3

export type BookingSubTemplate = 
  | "S1" // Slowhop confirmation
  | "S2" // Slowhop prepayment/commission
  | "A1" // Airbnb confirmation
  | "B1" // Booking.com confirmation
  | "UNKNOWN";

export interface QualifiedEmail {
  template: EmailTemplateType;
  subTemplate: BookingSubTemplate;
  data: any; // Raw parsed data
}

// ─── Data Types ───────────────────────────────────────────────────────────────

export interface ParsedBankData {
  amount: number;
  currency: string;
  senderName: string;
  transferTitle: string;
  transferDate: Date;
  accountNumber: string; // The "to" account
}

export interface ParsedBookingData {
  channel: "slowhop" | "airbnb" | "booking";
  bookingId?: string; // System ID from the channel
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestCountry?: string;
  checkIn?: Date;
  checkOut?: Date;
  guestCount?: number;
  adultsCount?: number;
  childrenCount?: number;
  animalsCount?: number;
  totalPrice?: number;
  amountPaid?: number; // Prepayment / Reservation fee
  commission?: number;
  hostRevenue?: number;
  currency?: string;
  property?: Property;
}

// ─── Qualification Logic ──────────────────────────────────────────────────────

/**
 * Qualifies the email into a template and sub-template.
 */
export function qualifyEmail(from: string, subject: string, body: string): QualifiedEmail {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  // Helper to check if an email is from a specific sender or was forwarded by the owner/admin
  // and contains that sender's signature in the body.
  const isFromOrForwarded = (senderEmail: string) => {
    const isDirect = fromLower.includes(senderEmail.toLowerCase());
    const isForwarded = (fromLower.includes("szymonfurtak") || fromLower.includes("frutak") || fromLower.includes(ENV.gmailUser.toLowerCase())) && 
                        (bodyLower.includes(senderEmail.toLowerCase()));
    return isDirect || isForwarded;
  };

  // 1. Incoming Bank Transfer (Template 1)
  // Subject can be "Wpływ na konto..." or "FW: Wpływ na konto..."
  if (
    (subjectLower.includes("wpływ na konto biznest konto 11") || subjectLower.includes("wplyw na konto biznest konto 11")) && 
    isFromOrForwarded("nestinfo@powiadomienia.nestbank.pl")
  ) {
    return {
      template: "BANK_TRANSFER",
      subTemplate: "UNKNOWN",
      data: parseNestBankBody(body),
    };
  }

  // 2. Booking Information Email (Template 2)
  
  // Slowhop S1: Confirmation
  if (
    subjectLower.includes("rezerwacja nr") && 
    subjectLower.includes("została potwierdzona i opłacona") &&
    isFromOrForwarded("rezerwacje@slowhop.com")
  ) {
    return {
      template: "BOOKING_CONFIRMATION",
      subTemplate: "S1",
      data: parseSlowhopS1(subject, body),
    };
  }

  // Slowhop S2: Prepayment/Commission
  if (
    subjectLower.includes("przelew przedpłaty za rezerwacje id") && 
    isFromOrForwarded("hop@slowhop.com")
  ) {
    return {
      template: "BOOKING_CONFIRMATION",
      subTemplate: "S2",
      data: parseSlowhopS2(subject, body),
    };
  }

  // Airbnb A1: Confirmation
  if (
    subjectLower.includes("reservation confirmed") && 
    subjectLower.includes("arrives") &&
    (isFromOrForwarded("automated@airbnb.com") || 
     fromLower.includes("katarzynafurtak") || 
     bodyLower.includes("from: airbnb <automated@airbnb.com>"))
  ) {
    return {
      template: "BOOKING_CONFIRMATION",
      subTemplate: "A1",
      data: parseAirbnbA1(subject, body),
    };
  }

  // Booking.com B1: Confirmation
  if (
    subjectLower.includes("nowa rezerwacja:") && 
    (fromLower.includes("frutak@gmail.com") || fromLower.includes("szymonfurtak") || fromLower.includes(ENV.gmailUser.toLowerCase())) &&
    bodyLower.includes("booking.com")
  ) {
    return {
      template: "BOOKING_CONFIRMATION",
      subTemplate: "B1",
      data: parseBookingB1(subject, body),
    };
  }

  return {
    template: "OTHER",
    subTemplate: "UNKNOWN",
    data: null,
  };
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseNestBankBody(body: string): ParsedBankData | null {
  // Example: "dnia 09.04.2026 nastąpił wpływ 1003,20 PLN na konto BIZnest Konto 11187010452078106769980001, od BOOKING.COM B.V, tytułem NO.RWDHLYJFKNMSCLDS/13416371."
  const dateMatch = body.match(/dnia\s+(\d{2}\.\d{2}\.\d{4})/i);
  const amountMatch = body.match(/wp[łl]yw\s+([\d\s,]+(?:PLN|zł|zl)?)/i);
  const accountMatch = body.match(/Konto\s+(\d{26})/i);
  // Sender: allow letters, spaces, digits, and dots/dashes. Stop at comma + "tytułem" or end of line.
  const senderMatch = body.match(/od\s+([^,\n]+?)(?:,\s*tytu[łl]em|\n|$)/i);
  // Title: allow everything until the end of line or specific bank footer markers.
  const titleMatch = body.match(/tytu[łl]em\s+(.+?)(?:\r?\n|Pozdrawiamy|$)/i);

  const amountData = amountMatch ? parsePrice(amountMatch[1]!) : null;

  if (!amountData) return null;

  return {
    amount: amountData.amount,
    currency: amountData.currency || "PLN",
    senderName: senderMatch ? senderMatch[1].trim() : "Unknown",
    transferTitle: titleMatch ? titleMatch[1].trim() : "Unknown",
    transferDate: dateMatch ? (parseDotDate(dateMatch[1]!) || new Date()) : new Date(),
    accountNumber: accountMatch ? accountMatch[1] : "",
  };
}

function parseSlowhopS1(subject: string, body: string): ParsedBookingData {
  // Extract booking ID from subject
  const idMatch = subject.match(/Rezerwacja nr (\d+)/i);
  const datesMatch = subject.match(/w dniach\s+(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})/i);
  const nameMatch = subject.match(/dla\s+(.+?)\s+zosta[łl]a/i);

  const phoneMatch = body.match(/Nr telefonu:\s*([+\d\s]+)/i);
  const emailMatch = body.match(/Adres e-mail:\s*([^\s\n]+@[^\s\n]+)/i);
  const guestMatch = body.match(/(\d+)\s+doros[łl]ych\s*\+\s*(\d+)\s+dzieci\s*\+\s*(\d+)\s+zwierz/i);
  const priceMatch = body.match(/Cena ca[łl]kowita:\s*([\d\s,]+(?:pln|zł|zl)?)/i);
  const paidMatch = body.match(/Wysoko[śs][ćc]\s+op[łl]aconej\s+przedp[łl]aty:\s*([\d\s,]+(?:pln|zł|zl)?)/i);

  const priceData = priceMatch ? parsePrice(priceMatch[1]!) : null;
  const paidData = paidMatch ? parsePrice(paidMatch[1]!) : null;

  let property: Property | undefined;
  if (body.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (body.toLowerCase().includes("sadoles") || body.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    channel: "slowhop",
    bookingId: idMatch ? idMatch[1] : undefined,
    guestName: nameMatch ? nameMatch[1].trim() : undefined,
    checkIn: datesMatch ? parseDMY(datesMatch[1]!) : undefined,
    checkOut: datesMatch ? parseDMY(datesMatch[2]!) : undefined,
    guestPhone: phoneMatch ? phoneMatch[1].trim() : undefined,
    guestEmail: emailMatch ? emailMatch[1].trim() : undefined,
    adultsCount: guestMatch ? parseInt(guestMatch[1]) : undefined,
    childrenCount: guestMatch ? parseInt(guestMatch[2]) : undefined,
    animalsCount: guestMatch ? parseInt(guestMatch[3]) : undefined,
    totalPrice: priceData?.amount,
    amountPaid: paidData?.amount,
    currency: priceData?.currency ?? "PLN",
    property,
  };
}

function parseSlowhopS2(subject: string, body: string): ParsedBookingData {
  const idMatch = subject.match(/id (\d+)/i);
  const prices = Array.from(body.matchAll(/(\d+[\s,.]*\d*)\s*(?:zł|zl|pln)/gi));
  
  // structured table: Total, Prepayment, Commission, Net to Host
  const totalPrice = prices[0] ? parsePrice(prices[0][0])?.amount : undefined;
  const amountPaid = prices[1] ? parsePrice(prices[1][0])?.amount : undefined;
  
  let commission = prices[2] ? parsePrice(prices[2][0])?.amount : undefined;
  if (commission != null) {
    // Manually add 23% VAT to commission as requested
    commission = Math.round(commission * 1.23 * 100) / 100;
  }

  const hostRevenue = (totalPrice != null && commission != null) ? totalPrice - commission : undefined;

  const detailMatch = body.match(/\(([^,)]+),\s*(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})\)/i);
  
  let property: Property | undefined;
  if (body.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (body.toLowerCase().includes("sadoles") || body.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    channel: "slowhop",
    bookingId: idMatch ? idMatch[1] : undefined,
    guestName: detailMatch ? detailMatch[1].trim() : undefined,
    checkIn: detailMatch ? parseDMY(detailMatch[2]!) : undefined,
    checkOut: detailMatch ? parseDMY(detailMatch[3]!) : undefined,
    totalPrice,
    amountPaid,
    commission,
    hostRevenue,
    currency: "PLN",
    property,
  };
}

function parseAirbnbA1(subject: string, body: string): ParsedBookingData {
  const nameMatch = subject.match(/confirmed\s*[-–]\s*(.+?)\s+arrives/i);
  
  let checkIn: Date | undefined;
  let checkOut: Date | undefined;

  // 1. Try capturing the side-by-side format first (common in newer emails)
  // "Check-in    Checkout\n Fri 1 May   Sun 3 May"
  const sideBySideMatch = body.match(/Check-in\s+Checkout[\s\n\r]+([^\n\r]+)/i);
  if (sideBySideMatch) {
    const datesLine = sideBySideMatch[1]!;
    const parts = datesLine.split(/\s{2,}/).filter(p => p.trim().length > 0);
    if (parts.length >= 2) {
      checkIn = parseAirbnbDate(parts[0]!);
      checkOut = parseAirbnbDate(parts[1]!);
    } else {
      // Maybe they are separated by just one space but are date-like
      const dateParts = datesLine.match(/(\w{3},\s+\d{1,2}\s+\w{3}|\d{1,2}\s+\w{3})/gi);
      if (dateParts && dateParts.length >= 2) {
        checkIn = parseAirbnbDate(dateParts[0]!);
        checkOut = parseAirbnbDate(dateParts[1]!);
      }
    }
  }

  // 2. Fallback: Check for vertical layout or distinct labels
  if (!checkIn) {
    // Look for Check-in label, then skip up to 50 chars to find a date
    const ciMatch = body.match(/Check-in.{0,50}?((\w{3},\s+\d{1,2}\s+\w{3})|(\d{1,2}\s+\w{3}))/is);
    if (ciMatch) checkIn = parseAirbnbDate(ciMatch[1]!);
  }
  
  if (!checkOut) {
    const coMatch = body.match(/Checkout[:\s\n\r]+.*?((\w{3},\s+\d{1,2}\s+\w{3})|(\d{1,2}\s+\w{3}))/is);
    if (coMatch) checkOut = parseAirbnbDate(coMatch[1]!);
  }

  // 3. Absolute fallback: look for dates following the labels anywhere
  if (!checkIn) {
    const ciMatch = body.match(/Check-in[:\s]+(\w{3},\s+\d{1,2}\s+\w{3}|\d{1,2}\s+\w{3})/i);
    if (ciMatch) checkIn = parseAirbnbDate(ciMatch[1]!);
  }
  if (!checkOut) {
    // Specifically skip everything after 'Checkout' until we see a date-like pattern
    const coPart = body.split(/Checkout/i)[1];
    if (coPart) {
      const coMatch = coPart.match(/((\w{3},\s+\d{1,2}\s+\w{3})|(\d{1,2}\s+\w{3}))/i);
      if (coMatch) checkOut = parseAirbnbDate(coMatch[1]!);
    }
  }
  
  if (checkIn) {
    checkIn = setMinutes(setHours(checkIn, 15), 0);
  }
  if (checkOut) {
    checkOut = setMinutes(setHours(checkOut, 11), 0);
  }

  const guestCountMatch = body.match(/(\d+)\s+adults?(?:,\s*(\d+)\s+(?:children|child))?/i);
  const totalMatch = body.match(/Total\s*\(PLN\)\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);
  const revenueMatch = body.match(/You earn\s*\n?\s*([\d,.\s]+(?:zł|zl|pln)?)/i);

  const totalData = totalMatch ? parsePrice(totalMatch[1]!) : null;
  const revenueData = revenueMatch ? parsePrice(revenueMatch[1]!) : null;

  let property: Property | undefined;
  if (body.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (body.toLowerCase().includes("sadoles") || body.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    channel: "airbnb",
    guestName: nameMatch ? nameMatch[1].trim() : undefined,
    checkIn,
    checkOut,
    adultsCount: guestCountMatch ? parseInt(guestCountMatch[1]) : undefined,
    childrenCount: guestCountMatch && guestCountMatch[2] ? parseInt(guestCountMatch[2]) : undefined,
    totalPrice: totalData?.amount,
    hostRevenue: revenueData?.amount,
    currency: "PLN",
    property,
  };
}

function parseBookingB1(subject: string, body: string): ParsedBookingData {
  const normalizedBody = body.replace(/\s+/g, " ");
  const nameMatch = normalizedBody.match(/Go[śs][ćc]:\s*(.+?)(?:\s+Kraj|\s+Termin|$)/i);
  const idMatch = normalizedBody.match(/ID Rezerwacji:\s*(\d+)/i);
  const countryMatch = normalizedBody.match(/Kraj:\s*(.+?)(?:\s+Liczba|$)/i);
  
  // Improved guest count parsing
  const guestLineMatch = normalizedBody.match(/Liczba go[śs]ci:?\s*(.+?)(?:\s+Termin|\s+Cena|\s+Email|$)/i);
  let guestCount: number | undefined;
  let adultsCount: number | undefined;
  let childrenCount: number | undefined;

  if (guestLineMatch) {
    const line = guestLineMatch[1].trim();
    const adults = line.match(/(\d+)\s+doros[łl]ych/i);
    const children = line.match(/(\d+)\s+dzieci/i);
    
    if (adults || children) {
      adultsCount = adults ? parseInt(adults[1]) : 0;
      childrenCount = children ? parseInt(children[1]) : 0;
      guestCount = adultsCount + childrenCount;
    } else {
      const simple = line.match(/^(\d+)/);
      if (simple) guestCount = parseInt(simple[1]);
    }
  }

  const emailMatch = normalizedBody.match(/Email go[śs]cia:\s*([^\s]+@[^\s]+)/i);
  
  const datesMatch = normalizedBody.match(/Termin:\s*(.+?)\s+(?:do|-|–)\s+(.+?)(?:\s+Cena|$)/i);
  const priceMatch = normalizedBody.match(/Cena dla go[śs]cia:\s*([\w\s,.]+?)(?:\s+Prowizja|$)/i);
  const commMatch = normalizedBody.match(/Prowizja Booking:\s*([\w\s,.]+?)(?:\s+Email|\s+ID|$)/i);

  const priceData = priceMatch ? parsePrice(priceMatch[1]!) : null;
  const commData = commMatch ? parsePrice(commMatch[1]!) : null;

  let property: Property | undefined;
  if (body.toLowerCase().includes("hacjenda")) property = "Hacjenda";
  else if (body.toLowerCase().includes("sadoles") || body.toLowerCase().includes("sadoleś")) property = "Sadoles";

  return {
    channel: "booking",
    bookingId: idMatch ? idMatch[1] : undefined,
    guestName: nameMatch ? nameMatch[1].trim() : undefined,
    guestEmail: emailMatch ? emailMatch[1].trim().replace(/\.$/, "") : undefined,
    guestCountry: countryMatch ? countryMatch[1].trim() : undefined,
    guestCount,
    adultsCount,
    childrenCount,
    checkIn: datesMatch ? parseBookingComDate(datesMatch[1]!) : undefined,
    checkOut: datesMatch ? parseBookingComDate(datesMatch[2]!) : undefined,
    totalPrice: priceData?.amount,
    commission: commData?.amount,
    hostRevenue: priceData && commData ? Math.round((priceData.amount - commData.amount) * 100) / 100 : undefined,
    currency: priceData?.currency ?? "PLN",
    property,
  };
}

/**
 * Detects the source of an email based on sender and subject.
 */
export function detectEmailSource(from: string, subject: string, body: string): "slowhop" | "airbnb" | "nestbank" | "booking" | "unknown" {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  if (subjectLower.includes("slowhop") || fromLower.includes("slowhop.com")) return "slowhop";
  if (subjectLower.includes("reservation confirmed") || fromLower.includes("airbnb.com") || bodyLower.includes("automated@airbnb.com")) return "airbnb";
  if (subjectLower.includes("nowa rezerwacja") || fromLower.includes("booking.com")) return "booking";
  if (fromLower.includes("nestbank.pl") || subjectLower.includes("wpływ na konto")) return "nestbank";

  return "unknown";
}

/**
 * High-level entry point for parsing any system email.
 */
export function parseEmail(from: string, subject: string, body: string): QualifiedEmail | null {
  const qualified = qualifyEmail(from, subject, body);
  if (qualified.template === "OTHER" && qualified.subTemplate === "UNKNOWN") {
    return null;
  }
  return qualified;
}

// Export individual parsers for testing
export {
  parseNestBankBody as parseNestbankEmail,
  parseSlowhopS1 as parseSlowhoEmail,
  parseAirbnbA1 as parseAirbnbEmail,
  parseBookingB1 as parseBookingComEmail
};
