
import { type Booking } from "../../drizzle/schema";

/**
 * Utility to get a display name for a guest/booking.
 * Handles different purposes (leisure, company, production) by picking appropriate fields.
 */
export function getGuestName(booking: Pick<Booking, 'guestName' | 'companyName' | 'purpose'> | null | undefined): string {
  if (!booking) return "Unknown guest";

  const { guestName, companyName, purpose } = booking;

  // For company or production trips, prioritize company name if available
  if (purpose === "company" || purpose === "production") {
    if (companyName && companyName.trim()) {
      return companyName.trim();
    }
  }

  // Fallback to guest name
  if (guestName && guestName.trim()) {
    return guestName.trim();
  }

  // Last fallback if both are missing
  return "Unknown guest";
}
