/**
 * Centralized business configuration for the ReZENwator.
 * Adding a new property or channel here will update types across the system.
 */

export const PROPERTIES = ["Sadoles", "Hacjenda"] as const;
export type Property = typeof PROPERTIES[number];

export const CHANNELS = ["slowhop", "airbnb", "booking", "alohacamp", "direct"] as const;
export type Channel = typeof CHANNELS[number];

export const STATUSES = ["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"] as const;
export type BookingStatus = typeof STATUSES[number];

export const DEPOSIT_STATUSES = ["pending", "paid", "returned", "not_applicable"] as const;
export type DepositStatus = typeof DEPOSIT_STATUSES[number];

export const CLEANING_STAFF = ["Ala", "Krysia"] as const;
export type CleaningStaff = typeof CLEANING_STAFF[number];

export const BOOKING_TYPES = ["normal", "block", "internal"] as const;
export type BookingType = typeof BOOKING_TYPES[number];

/**
 * Party size the price audit quotes for.
 *
 * A portal price only means something next to the number of guests it covers —
 * Booking prices an entire-place listing in occupancy tiers and lists them all at
 * once, so an audit that asks for one size and reads the price of another compares
 * nothing. This is the size the auditor puts in every portal URL and the size the
 * internal benchmark is calculated for; the two must not drift apart.
 */
export const AUDIT_OCCUPANCY: Record<Property, number> = {
  Sadoles: 11,
  Hacjenda: 4,
};
