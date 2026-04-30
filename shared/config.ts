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
