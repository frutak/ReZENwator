/**
 * Booking Matcher
 *
 * Implements fuzzy matching between bank transfer data (from Nestbank emails)
 * and existing bookings in the database. Uses a scoring algorithm based on:
 *   - Guest name similarity (Levenshtein distance)
 *   - Date proximity (transfer date vs check-in date)
 *   - Amount matching (exact match or partial payment)
 */

import { and, eq, gte, lte, or, ne } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import type { ParsedBankEmail } from "./emailParsers";
import type { Booking } from "../../drizzle/schema";
import { sendAlertEmail } from "../_core/email";

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

/**
 * Calculates Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

/**
 * Normalizes a name for matching (lowercase, no special chars, remove honorifics).
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\sąśćęłńóśźż]/g, "")
    .replace(/\b(pan|pani|mgr|dr|inż)\b/g, "")
    .trim();
}

/**
 * Scores how well a bank transfer matches a candidate booking.
 */
export async function findMatchingBookings(
  transfer: ParsedBankEmail
): Promise<Array<{ bookingId: number; score: number; guestName: string | null; checkIn: Date; channel: string; property: string; reasons: string[] }>> {
  const db = await getDb();
  if (!db) return [];

  // 1. Fetch "active" bookings (pending or confirmed)
  // We look for check-ins within a reasonable window around the transfer date
  const windowStart = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowStart.setDate(windowStart.getDate() - 60); // Look 2 months back
  const windowEnd = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowEnd.setDate(windowEnd.getDate() + 30);  // Look 1 month ahead

  const candidates = await db
    .select()
    .from(bookings)
    .where(
      and(
        or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed"), eq(bookings.status, "portal_paid")),
        gte(bookings.checkIn, windowStart),
        lte(bookings.checkIn, windowEnd)
      )
    );

  const results: any[] = [];

  for (const candidate of candidates) {
    let score = 0;
    const reasons: string[] = [];

    // ── Name score (100 points max) ──────────────────────────────────────────
    if (candidate.guestName && transfer.senderName) {
      const cName = normalizeName(candidate.guestName);
      const tName = normalizeName(transfer.senderName);
      const distance = levenshtein(cName, tName);
      const maxLen = Math.max(cName.length, tName.length);
      const similarity = 1 - distance / maxLen;

      if (similarity > 0.8) {
        score += 80;
        reasons.push("Guest name match (high)");
      } else if (similarity > 0.5) {
        score += 40;
        reasons.push("Guest name match (partial)");
      } else if (tName.includes(cName) || cName.includes(tName)) {
        score += 60;
        reasons.push("Name is subset of sender");
      }

      // Special check: Shared surname (e.g. Marta Chlastawa vs Dariusz Chlastawa)
      const cParts = cName.split(" ");
      const tParts = tName.split(" ");
      const cSurname = cParts[cParts.length - 1];
      const tSurname = tParts[tParts.length - 1];
      if (cSurname && tSurname && cSurname === tSurname && cSurname.length > 3) {
        score += 40;
        reasons.push(`Shared surname: ${cSurname}`);
      }
    }

    // Also check transfer title for guest name
    if (candidate.guestName && transfer.transferTitle) {
      const cName = normalizeName(candidate.guestName);
      const tTitle = normalizeName(transfer.transferTitle);
      if (tTitle.includes(cName)) {
        score += 70;
        reasons.push("Guest name found in transfer title");
      }
    }

    const bestNameScore = Math.min(100, score);
    score = 0; // reset for composite calculation

    // ── Date score (100 points max) ──────────────────────────────────────────
    // Transfers usually happen before or slightly after check-in
    const diffDays = Math.abs(
      ((candidate.checkIn.getTime() - (transfer.transferDate?.getTime() ?? Date.now())) /
      (1000 * 60 * 60 * 24))
    );

    let dateScore = 0;
    if (diffDays <= 3) {
      dateScore = 100;
      reasons.push("Date is very close (<3 days)");
    } else if (diffDays <= 14) {
      dateScore = 70;
      reasons.push("Date is close (<14 days)");
    } else if (diffDays <= 45) {
      dateScore = 30;
      reasons.push("Date is within range (<45 days)");
    }

    // ── Amount score (100 points max) ────────────────────────────────────────
    let amountScore = 0;
    if (transfer.amount) {
      const cTotal = parseFloat(String(candidate.totalPrice || "0"));
      const cPaid = parseFloat(String(candidate.amountPaid || "0"));
      const cRemaining = Math.max(0, cTotal - cPaid);
      const cDeposit = parseFloat(String(candidate.depositAmount || "500.00"));

      const isTotalMatch = cTotal > 0 && Math.abs(transfer.amount - cTotal) < 1.0;
      const isRemainingMatch = cRemaining > 0 && Math.abs(transfer.amount - cRemaining) < 1.0;
      const isDepositMatch = Math.abs(transfer.amount - cDeposit) < 1.0;
      const isBothMatch = cRemaining > 0 && Math.abs(transfer.amount - (cRemaining + cDeposit)) < 1.0;

      if (isTotalMatch || isRemainingMatch || isBothMatch) {
        amountScore = 100;
        reasons.push(isTotalMatch ? "Matches total price" : isRemainingMatch ? "Matches remaining balance" : "Matches balance + deposit");
      } else if (isDepositMatch) {
        amountScore = 90;
        reasons.push("Matches deposit amount");
      } else if (cTotal > 0) {
        const ratio = transfer.amount / cTotal;
        if (ratio >= 0.1 && ratio <= 1.1) {
          amountScore = 50;
          reasons.push("Amount is plausible partial payment");
        } else {
          amountScore = 10;
        }
      } else {
        amountScore = 40;
      }
    } else {
      amountScore = 40; // No price data — neutral
    }

    // ── Composite score ────────────────────────────────────────────────────
    // Weights: name 40%, date 20%, amount 40%
    score = Math.round(bestNameScore * 0.4 + dateScore * 0.2 + amountScore * 0.4);

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
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (rows.length === 0) return;
  const b = rows[0]!;

  const transferAmount = transfer.amount ?? 0;
  let newStatus = b.status;
  let newDepositStatus = b.depositStatus;

  const currentPaid = parseFloat(String(b.amountPaid || "0"));
  const totalPrice = parseFloat(String(b.totalPrice || "0"));
  const depositReq = parseFloat(String(b.depositAmount || "500.00"));
  const toBePaid = Math.max(0, totalPrice - currentPaid);

  const isDepositMatch = Math.abs(transferAmount - depositReq) < 1.0;
  const isToBePaidMatch = Math.abs(transferAmount - toBePaid) < 1.0;
  const isBothMatch = Math.abs(transferAmount - (toBePaid + depositReq)) < 1.0;

  if (b.channel === "direct") {
    if (isBothMatch) {
      newStatus = "paid";
      newDepositStatus = "paid";
    } else if (isToBePaidMatch) {
      newStatus = "paid";
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
      if (newStatus === "pending") newStatus = "confirmed";
    } else {
      // Logic for unmatched direct payment
      if (totalPrice > 0 && (currentPaid + transferAmount) >= totalPrice * 0.95) {
        newStatus = "paid";
      } else if (newStatus === "pending") {
        newStatus = "confirmed";
      }
      // Notify about unusual amount
      await sendPaymentMismatchEmail(b, transferAmount, { toBePaid, depositReq });
    }
  } else {
    // Portals (Airbnb/Booking)
    if (isDepositMatch) {
      newDepositStatus = "paid";
    } else {
      newStatus = "paid"; // Usually the portal payment
      if (!isToBePaidMatch && toBePaid > 0) {
        await sendPaymentMismatchEmail(b, transferAmount, { toBePaid, depositReq });
      }
    }
  }

  const newPaid = currentPaid + transferAmount;

  await db
    .update(bookings)
    .set({
      status: newStatus as any,
      depositStatus: newDepositStatus as any,
      amountPaid: String(newPaid.toFixed(2)),
      transferAmount: transfer.amount ? String(transfer.amount) : undefined,
      transferSender: transfer.senderName,
      transferTitle: transfer.transferTitle,
      transferDate: transfer.transferDate,
      matchScore: score,
    })
    .where(eq(bookings.id, bookingId));

  console.log(`[Matcher] Booking #${bookingId} updated: status=${newStatus}, deposit=${newDepositStatus}`);
}

async function sendPaymentMismatchEmail(booking: Booking, amount: number, expected: { toBePaid: number; depositReq: number }) {
  const subject = `⚠️ Payment Amount Mismatch: ${booking.guestName || "Unknown"} (${booking.property})`;
  const text = `
    Unusual payment amount received for booking #${booking.id}.
    
    Guest: ${booking.guestName || "Unknown"}
    Property: ${booking.property}
    Channel: ${booking.channel}
    Dates: ${new Date(booking.checkIn).toLocaleDateString()} - ${new Date(booking.checkOut).toLocaleDateString()}
    
    Amount received: ${amount.toFixed(2)} PLN
    
    Expected amounts:
    - To be paid: ${expected.toBePaid.toFixed(2)} PLN
    - Deposit: ${expected.depositReq.toFixed(2)} PLN
    - Total: ${(expected.toBePaid + expected.depositReq).toFixed(2)} PLN
    
    The booking has been updated with the amount, but status might need manual review.
  `.trim();

  await sendAlertEmail(subject, text);
}
