/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

export type Booking = {
  id: number;
  property: string;
  channel: string;
  checkIn: Date | string;
  checkOut: Date | string;
  status: string;
  depositStatus: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestCount: number | null;
  adultsCount: number | null;
  childrenCount: number | null;
  animalsCount: number | null;
  amountPaid: string | null;
  depositAmount: string | null;
  totalPrice: string | null;
  hostRevenue: string | null;
  currency: string | null;
  transferAmount: string | null;
  transferSender: string | null;
  transferTitle: string | null;
  transferDate: Date | string | null;
  matchScore: number | null;
  notes: string | null;
  createdAt: Date | string;
};
