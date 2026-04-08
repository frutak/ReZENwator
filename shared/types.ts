import { bookings } from "../drizzle/schema";

/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";

/**
 * Strict Booking type inferred from schema.
 */
export type Booking = typeof bookings.$inferSelect;
