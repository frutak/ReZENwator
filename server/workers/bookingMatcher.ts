/**
 * Booking Matcher
 *
 * Implements fuzzy matching between bank transfer data (from Nestbank emails)
 * and existing bookings in the database. Uses a scoring algorithm based on:
 *   - Guest name similarity (Levenshtein distance / token overlap)
 *   - Transfer date proximity to check-in date
 *   - Amount plausibility
 *
 * Returns a match score 0–100 and the best matching booking ID.
 */

import Fuse from "fuse.js";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import type { ParsedBankEmail } from "./emailParsers";

export type MatchResult = {
  bookingId: number;
  score: number; // 0–100, higher is better
  guestName: string | null;
  checkIn: Date;
  channel: string;
  property: string;
  reasons: string[];
};

/**
 * Normalise a name for comparison: uppercase, remove accents, trim.
 */
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, "")
    .trim();
}

/**
 * Calculate token-based name similarity score (0–100).
 * Splits both names into tokens and counts matching tokens.
 */
function nameScore(a: string, b: string): number {
  const tokensA = normalizeName(a).split(/\s+/).filter(Boolean);
  const tokensB = normalizeName(b).split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let matches = 0;
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb) {
        matches++;
        break;
      }
      // Partial match: one contains the other
      if (ta.length >= 3 && (ta.includes(tb) || tb.includes(ta))) {
        matches += 0.5;
        break;
      }
    }
  }

  const maxTokens = Math.max(tokensA.length, tokensB.length);
  return Math.round((matches / maxTokens) * 100);
}

/**
 * Score date proximity: how close is the transfer date to the check-in date?
 * Returns 100 if within 7 days, 50 if within 30 days, 0 if more than 60 days.
 */
function dateProximityScore(transferDate: Date, checkIn: Date): number {
  const diffDays = Math.abs(
    (transferDate.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays <= 7) return 100;
  if (diffDays <= 30) return Math.round(100 - ((diffDays - 7) / 23) * 50);
  if (diffDays <= 60) return Math.round(50 - ((diffDays - 30) / 30) * 50);
  return 0;
}

/**
 * Find the best matching booking for a bank transfer.
 * Returns up to 5 candidates sorted by score descending.
 */
export async function findMatchingBookings(
  transfer: ParsedBankEmail
): Promise<MatchResult[]> {
  const db = await getDb();
  if (!db) return [];

  // Fetch bookings that are not yet paid and not finished
  // Look within a ±90 day window around the transfer date
  const windowStart = transfer.transferDate
    ? new Date(transfer.transferDate.getTime() - 90 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const windowEnd = transfer.transferDate
    ? new Date(transfer.transferDate.getTime() + 90 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: bookings.id,
      guestName: bookings.guestName,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      channel: bookings.channel,
      property: bookings.property,
      totalPrice: bookings.totalPrice,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        or(
          eq(bookings.status, "pending"),
          eq(bookings.status, "confirmed")
        ),
        gte(bookings.checkIn, windowStart),
        lte(bookings.checkIn, windowEnd)
      )
    );

  if (candidates.length === 0) return [];

  const results: MatchResult[] = [];

  for (const candidate of candidates) {
    let score = 0;
    const reasons: string[] = [];

    // ── Name matching ──────────────────────────────────────────────────────
    const senderName = transfer.senderName ?? "";
    const transferTitle = transfer.transferTitle ?? "";

    let bestNameScore = 0;
    if (candidate.guestName) {
      const nameFromSender = nameScore(senderName, candidate.guestName);
      const nameFromTitle = nameScore(transferTitle, candidate.guestName);
      bestNameScore = Math.max(nameFromSender, nameFromTitle);

      if (bestNameScore >= 80) {
        reasons.push(`Strong name match (${bestNameScore}%)`);
      } else if (bestNameScore >= 50) {
        reasons.push(`Partial name match (${bestNameScore}%)`);
      }
    } else {
      // No guest name yet — give partial credit for any name in transfer
      bestNameScore = 30;
      reasons.push("No guest name on booking yet");
    }

    // ── Date proximity ─────────────────────────────────────────────────────
    let dateScore = 0;
    if (transfer.transferDate) {
      dateScore = dateProximityScore(transfer.transferDate, candidate.checkIn);
      if (dateScore >= 80) reasons.push("Transfer date close to check-in");
      else if (dateScore >= 50) reasons.push("Transfer date within 30 days of check-in");
    } else {
      dateScore = 40; // No date — neutral
    }

    // ── Amount plausibility ────────────────────────────────────────────────
    let amountScore = 0;
    if (transfer.amount && candidate.totalPrice) {
      const bookingPrice = parseFloat(String(candidate.totalPrice));
      const ratio = transfer.amount / bookingPrice;
      // Accept full payment, partial payment (>= 20%), or small overpay
      if (ratio >= 0.95 && ratio <= 1.05) {
        amountScore = 100;
        reasons.push("Amount matches total price");
      } else if (ratio >= 0.2 && ratio <= 1.1) {
        amountScore = 60;
        reasons.push("Amount is partial payment");
      } else {
        amountScore = 10;
      }
    } else {
      amountScore = 40; // No price data — neutral
    }

    // ── Composite score ────────────────────────────────────────────────────
    // Weights: name 50%, date 30%, amount 20%
    score = Math.round(bestNameScore * 0.5 + dateScore * 0.3 + amountScore * 0.2);

    if (score >= 30) {
      results.push({
        bookingId: candidate.id,
        score,
        guestName: candidate.guestName ?? null,
        checkIn: candidate.checkIn,
        channel: candidate.channel,
        property: candidate.property,
        reasons,
      });
    }
  }

  // Sort by score descending, return top 5
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Apply a bank transfer match to a booking.
 * Records transfer details and updates status based on amount and channel.
 */
export async function applyTransferMatch(
  bookingId: number,
  transfer: ParsedBankEmail,
  score: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Fetch current booking to determine status transition
  const booking = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (booking.length === 0) return;
  const b = booking[0]!;

  const transferAmount = transfer.amount ?? 0;
  const currentPaid = parseFloat(String(b.amountPaid || "0"));
  const newPaid = currentPaid + transferAmount;
  const totalPrice = parseFloat(String(b.totalPrice || "0"));

  let newStatus: "pending" | "confirmed" | "paid" | "finished" = b.status;

  if (b.channel === "direct") {
    // For direct bookings:
    // If we reach full price (approx 95%), mark as paid.
    // Otherwise, if it was pending, mark as confirmed (pre-payment received).
    if (totalPrice > 0 && newPaid >= totalPrice * 0.95) {
      newStatus = "paid";
    } else if (b.status === "pending") {
      newStatus = "confirmed";
    }
  } else {
    // For portals, usually one payment means it's paid
    newStatus = "paid";
  }

  await db
    .update(bookings)
    .set({
      status: newStatus,
      amountPaid: String(newPaid.toFixed(2)),
      transferAmount: transfer.amount ? String(transfer.amount) : undefined,
      transferSender: transfer.senderName,
      transferTitle: transfer.transferTitle,
      transferDate: transfer.transferDate,
      matchScore: score,
    })
    .where(eq(bookings.id, bookingId));

  console.log(`[Matcher] Booking #${bookingId} updated to ${newStatus} (paid so far: ${newPaid})`);
}
