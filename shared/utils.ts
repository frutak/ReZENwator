import { setHours, setMinutes } from "date-fns";

/**
 * Standardizes check-in and check-out times if they are set exactly at midnight.
 * Check-in defaults to 16:00.
 * Check-out defaults to 10:00.
 */
export function normalizeBookingDates(checkIn: Date, checkOut: Date) {
  let normalizedCheckIn = checkIn;
  let normalizedCheckOut = checkOut;

  if (checkIn.getHours() === 0 && checkIn.getMinutes() === 0) {
    normalizedCheckIn = setMinutes(setHours(checkIn, 16), 0);
  }
  if (checkOut.getHours() === 0 && checkOut.getMinutes() === 0) {
    normalizedCheckOut = setMinutes(setHours(checkOut, 10), 0);
  }

  return { checkIn: normalizedCheckIn, checkOut: normalizedCheckOut };
}

/**
 * Calculates the total guest count by combining adults and children if available,
 * otherwise falling back to the raw guest count.
 */
export function calculateTotalGuests(
  guestCount?: number,
  adultsCount?: number,
  childrenCount?: number
): number {
  const adults = adultsCount ?? 0;
  const children = childrenCount ?? 0;
  const calculatedTotal = adults + children;
  
  if (calculatedTotal > 0) {
    return calculatedTotal;
  }
  
  return guestCount ?? 1;
}

/**
 * Normalizes decimal fields in booking details, converting empty strings to null.
 */
export function normalizeDecimalFields<T extends Record<string, any>>(details: T): T {
  const normalized = { ...details };
  const decimalFields = ['totalPrice', 'commission', 'hostRevenue', 'amountPaid', 'depositAmount'];
  
  for (const field of decimalFields) {
    if (normalized[field] === "") {
      (normalized as any)[field] = null;
    }
  }
  
  return normalized;
}

/**
 * Calculates the balance due for a booking.
 * Logic:
 * - For Airbnb/Booking.com: hostRevenue - amountPaid
 * - For others: totalPrice - amountPaid
 * - Optional: include deposit if not returned
 */
export function calculateBalanceDue(booking: {
  channel: string;
  totalPrice: string | number | null;
  hostRevenue: string | number | null;
  amountPaid: string | number | null;
  depositAmount?: string | number | null;
  depositStatus?: string | null;
}, includeDeposit = false): number {
  const channel = booking.channel;
  const totalPrice = parseFloat(String(booking.totalPrice || "0"));
  const hostRevenue = parseFloat(String(booking.hostRevenue || "0"));
  const amountPaid = parseFloat(String(booking.amountPaid || "0"));
  const depositAmount = parseFloat(String(booking.depositAmount || "500.00"));

  // The "base amount" we expect to receive is the hostRevenue if defined,
  // otherwise it's the totalPrice. This handles all channels:
  // - Direct: hostRevenue usually equals totalPrice (or is null, falling back to totalPrice)
  // - Airbnb/Booking: hostRevenue is price minus commission
  const baseAmount = (hostRevenue > 0) ? hostRevenue : totalPrice;

  let balance = baseAmount - amountPaid;

  if (includeDeposit) {
    if (booking.depositStatus === "pending" || booking.depositStatus === "paid") {
      balance += depositAmount;
    }
  }

  return Math.max(0, balance);
}
