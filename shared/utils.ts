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
