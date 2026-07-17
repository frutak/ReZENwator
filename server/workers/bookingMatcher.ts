/**
 * Booking Matcher
 *
 * Implements fuzzy matching between bank transfer data (from Nestbank emails)
 * and existing bookings in the database. Uses a scoring algorithm based on:
 *   - Guest name similarity (Levenshtein distance)
 *   - Date proximity (transfer date vs check-in date)
 *   - Amount matching (exact match or partial payment)
 */

import { BookingRepository } from "../repositories/BookingRepository";
import { BankTransferRepository } from "../repositories/BankTransferRepository";
import { getDb } from "../db";
import type { ParsedBankData } from "./emailParsers";
import { sendAlertEmail } from "../_core/email";
import { levenshtein, normalizeName } from "../_core/utils/string";
import { Logger } from "../_core/logger";
import { ENV } from "../_core/env";
import { type Channel, type BookingStatus, type DepositStatus } from "@shared/config";
import { MatchingEngine, type MatchResult } from "../services/MatchingEngine";
import { calculateBalanceDue } from "@shared/utils";

/**
 * Scores how well a bank transfer matches a candidate booking.
 */
export async function findMatchingBookings(
  transfer: ParsedBankData,
  testMode = false
): Promise<MatchResult[]> {
  const tTitle = normalizeName(transfer.transferTitle || "").toUpperCase();
  const tSender = normalizeName(transfer.senderName || "").toUpperCase();

  // 1. Determine subsets based on source
  const isAirbnbPayout = tTitle.includes("AIRBNB") || tSender.includes("PAYONEER") || tSender.includes("AIRBNB");
  
  const objectIdMatch = transfer.transferTitle?.match(/(\d{7,10})/);
  const oid = objectIdMatch ? objectIdMatch[1] : null;
  const isBookingPayout = tTitle.includes("BOOKING.COM") || tSender.includes("BOOKING.COM") ||
                          tTitle.includes("BOOKING") || tSender.includes("BOOKING") ||
                          (ENV.hacjendaBookingId && oid === ENV.hacjendaBookingId) || 
                          (ENV.sadolesBookingId && oid === ENV.sadolesBookingId);

  const isPortalPayout = isAirbnbPayout || isBookingPayout;

  const windowStart = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowStart.setFullYear(windowStart.getFullYear() - 5); 
  const windowEnd = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowEnd.setFullYear(windowEnd.getFullYear() + 5); 

  let candidates: any[] = [];

  if (isPortalPayout) {
    const channel = isAirbnbPayout ? "airbnb" : "booking";
    candidates = await BookingRepository.findPortalPayoutCandidates(channel as Channel, windowStart, windowEnd, testMode);

    // Further filter Booking.com by property ID if possible
    if (isBookingPayout && oid) {
      if (ENV.hacjendaBookingId && oid === ENV.hacjendaBookingId) candidates = candidates.filter(c => c.channel !== "booking" || c.property === "Hacjenda");
      else if (ENV.sadolesBookingId && oid === ENV.sadolesBookingId) candidates = candidates.filter(c => c.channel !== "booking" || c.property === "Sadoles");
    }
  } else {
    // Guest direct transfer
    candidates = await BookingRepository.findDirectTransferCandidates(windowStart, windowEnd, testMode);
  }

  const sortedResults = MatchingEngine.scoreCandidates(transfer, candidates as any, !!isPortalPayout);
  
  if (testMode) return sortedResults;
  return sortedResults.slice(0, 5);
}

/**
 * Apply a bank transfer match to a booking.
 * Records transfer details and updates status based on amount and channel.
 *
 * The booking-payment write and the transfer-status write are committed in a
 * single transaction so the process can never end up with a booking marked
 * paid while its transfer is still `pending` (which a later manual re-match
 * would double-count). Pass `link` to include the transfer-status update in the
 * same transaction; omit it to update only the booking.
 *
 * Side effects (activity log, payment-mismatch email) are deferred until after
 * the transaction commits — email must never run inside a DB transaction, and a
 * failed write should not send a "payment received" signal.
 */
export async function applyTransferMatch(
  bookingId: number,
  transfer: ParsedBankData,
  score: number,
  link?: { transferId?: number; externalId?: string }
): Promise<void> {
  // Fetch current booking to determine status transition
  const b = await BookingRepository.getBookingById(bookingId);
  if (!b) return;

  const transferAmount = transfer.amount ?? 0;
  let newStatus = b.status;
  let newDepositStatus = b.depositStatus;

  // Payment-mismatch notification is captured here and sent AFTER the commit.
  let pendingMismatch: { toBePaid: number; depositReq: number; resFee?: number } | null = null;

  const currentPaid = parseFloat(String(b.amountPaid || "0"));
  const totalPrice = parseFloat(String(b.totalPrice || "0"));
  const depositReq = parseFloat(String(b.depositAmount || "500.00"));
  
  // Calculate remaining balance using the standard utility (ignoring portal commissions)
  const toBePaid = calculateBalanceDue(b as any, false);

  const isDepositMatch = Math.abs(transferAmount - depositReq) < 1.0;
  const isToBePaidMatch = Math.abs(transferAmount - toBePaid) < 1.0;
  const isBothMatch = Math.abs(transferAmount - (toBePaid + depositReq)) < 1.0;

  const isPetFeeMatch = b.channel === "booking" && 
                       b.animalsCount != null && 
                       b.animalsCount > 0 && 
                       Math.abs(transferAmount - (b.animalsCount * 200.0)) < 1.0;

  const cResFee = parseFloat(String(b.reservationFee || "0"));
  const isResFeeMatch = cResFee > 0 && Math.abs(transferAmount - cResFee) < 1.0;
  const cComm = parseFloat(String(b.commission || "0"));
  const cRevenue = parseFloat(String(b.hostRevenue || "0"));

  let isPortalForward = false;

  if (b.channel === "slowhop") {
    const hostPrepayment = cResFee - cComm;
    const guestBalance = totalPrice - cResFee;
    const guestBalancePlusDeposit = guestBalance + depositReq;

    if (Math.abs(transferAmount - hostPrepayment) < 1.0) {
      // Slowhop pre-payment forward - status stays 'confirmed' (or current)
      newStatus = b.status === "pending" ? "confirmed" : b.status;
      isPortalForward = true;
    } else if (Math.abs(transferAmount - guestBalancePlusDeposit) < 1.0) {
      newStatus = "paid";
      newDepositStatus = "paid";
    } else if (Math.abs(transferAmount - guestBalance) < 1.0) {
      newStatus = "paid";
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
    } else {
      pendingMismatch = { toBePaid: guestBalance, depositReq, resFee: cResFee };
    }
  } else if (b.status === "portal_paid") {
    // Portals (Airbnb/Booking) that were already marked as portal_paid
    const diff = Math.abs(transferAmount - cRevenue);
    const diffPercent = cRevenue > 0 ? diff / cRevenue : 1.0;

    if (diffPercent < 0.01) {
      newStatus = "paid";
      isPortalForward = true;
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
    } else if (isPetFeeMatch) {
      // Pet fee paid
    } else {
      pendingMismatch = { toBePaid: cRevenue, depositReq };
    }
  } else if (b.channel === "direct") {
    if (isBothMatch) {
      newStatus = "paid";
      newDepositStatus = "paid";
    } else if (isToBePaidMatch) {
      newStatus = "paid";
    } else if (isResFeeMatch) {
      // Pre-payment match for direct booking
      if (newStatus === "pending") newStatus = "confirmed";
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
      if (newStatus === "pending") newStatus = "confirmed";
    } else {
      // Unusual amount for direct booking
      if (newStatus === "confirmed" || newStatus === "pending") {
        // Must be at least 99% correct
        if (totalPrice > 0 && (currentPaid + transferAmount) >= totalPrice * 0.99) {
           newStatus = "paid";
        } else {
           newStatus = "confirmed";
        }
      }
      // Notify about unusual amount
      pendingMismatch = { toBePaid, depositReq, resFee: cResFee };
    }
  } else {
    // Default portal logic (if not portal_paid yet)
    if (isDepositMatch) {
      newDepositStatus = "paid";
    } else if (isPetFeeMatch) {
      // Pet fee paid for Booking.com
      // Logic: we just record it, no status change needed for now
    } else if (isResFeeMatch) {
      // Pre-payment for portal (if applicable)
      if (newStatus === "pending") newStatus = "confirmed";
    } else if (Math.abs(transferAmount - cRevenue) < 1.0) {
      newStatus = "paid";
      isPortalForward = true;
    } else {
      newStatus = "paid"; // Usually the portal payment
      if (!isToBePaidMatch && toBePaid > 0) {
        pendingMismatch = { toBePaid, depositReq, resFee: cResFee };
      }
    }
  }

  let newPaid = currentPaid + transferAmount;

  const paymentUpdate = {
    status: newStatus as BookingStatus,
    depositStatus: newDepositStatus as DepositStatus,
    amountPaid: String(newPaid.toFixed(2)),
    transferAmount: transfer.amount ? String(transfer.amount) : undefined,
    transferSender: transfer.senderName,
    transferTitle: transfer.transferTitle,
    transferDate: transfer.transferDate,
    matchScore: score,
  };

  // Atomic: booking payment + transfer status commit together (or not at all).
  const db = await getDb();
  if (db) {
    await db.transaction(async (tx) => {
      await BookingRepository.updateBookingPayment(bookingId, paymentUpdate, tx);
      if (link?.transferId != null) {
        await BankTransferRepository.updateTransferStatus(link.transferId, "matched", bookingId, tx);
      } else if (link?.externalId != null) {
        await BankTransferRepository.updateTransferStatusByExternalId(link.externalId, "matched", bookingId, tx);
      }
    });
  } else {
    // No DB configured (dev) — best-effort, non-transactional.
    await BookingRepository.updateBookingPayment(bookingId, paymentUpdate);
  }

  // ─── Post-commit side effects (never inside the transaction) ───────────────
  await Logger.bookingAction(bookingId, "status_change", `Auto-matched bank transfer (Score: ${score})`, `Sender: ${transfer.senderName}, Amount: ${transferAmount} PLN, New Status: ${newStatus}`);

  if (pendingMismatch) {
    await sendPaymentMismatchEmail(b as any, transferAmount, pendingMismatch);
  }

  console.log(`[Matcher] Booking #${bookingId} updated: status=${newStatus}, deposit=${newDepositStatus}`);
}

/**
 * Reverts a bank transfer match from a booking.
 * Decreases paid amount and potentially reverts status.
 */
export async function revertTransferMatch(
  bookingId: number,
  transferAmount: number
): Promise<void> {
  const b = await BookingRepository.getBookingById(bookingId);
  if (!b) return;

  const currentPaid = parseFloat(String(b.amountPaid || "0"));
  const newPaid = Math.max(0, currentPaid - transferAmount);
  
  let newStatus = b.status;
  let newDepositStatus = b.depositStatus;

  const totalPrice = parseFloat(String(b.totalPrice || "0"));
  const depositReq = parseFloat(String(b.depositAmount || "500.00"));

  if (b.channel === "airbnb" || b.channel === "booking") {
    // If it was paid but now we removed the transfer, it goes back to portal_paid
    if (b.status === "paid") {
      newStatus = "portal_paid";
    }
  } else if (b.channel === "slowhop") {
    if (newPaid < 10) { // Practically zero
      newStatus = "confirmed";
    }
  } else if (b.channel === "direct") {
    if (newPaid < 10) {
      newStatus = "confirmed";
    }
  }

  // Revert deposit status if the removed amount matches deposit
  if (Math.abs(transferAmount - depositReq) < 1.0) {
    newDepositStatus = "pending";
  }

  await BookingRepository.updateBookingPayment(bookingId, {
    status: newStatus as BookingStatus,
    depositStatus: newDepositStatus as DepositStatus,
    amountPaid: String(newPaid.toFixed(2)),
    // We don't clear transfer fields here as they might be overwritten by a new match soon,
    // but for clarity we can set them to null/undefined if this was the last match.
    // However, updateBookingPayment usually sets them to what's provided.
  });

  await Logger.bookingAction(bookingId, "status_change", `Manual match reversal`, `Removed ${transferAmount} PLN. Status: ${newStatus}`);
}

async function sendPaymentMismatchEmail(booking: any, amount: number, expected: { toBePaid: number; depositReq: number; resFee?: number }) {
  const subject = `⚠️ Payment Amount Mismatch: ${booking.guestName || "Unknown"} (${booking.property})`;
  const expectedPetFee = (booking.channel === "booking" && booking.animalsCount != null && booking.animalsCount > 0)
    ? booking.animalsCount * 200
    : 0;

  const text = `
    Unusual payment amount received for booking #${booking.id}.
    
    Guest: ${booking.guestName || "Unknown"}
    Property: ${booking.property}
    Channel: ${booking.channel}
    Dates: ${new Date(booking.checkIn).toLocaleDateString()} - ${new Date(booking.checkOut).toLocaleDateString()}
    
    Amount received: ${amount.toFixed(2)} PLN
    
    Expected amounts:
    ${expected.resFee ? `- Pre-payment (Zaliczka): ${expected.resFee.toFixed(2)} PLN\n    ` : ""}- To be paid (Balance): ${expected.toBePaid.toFixed(2)} PLN
    - Deposit (Kaucja): ${expected.depositReq.toFixed(2)} PLN
    ${expectedPetFee > 0 ? `- Pet Fee: ${expectedPetFee.toFixed(2)} PLN\n    ` : ""}- Total: ${(expected.toBePaid + expected.depositReq + expectedPetFee).toFixed(2)} PLN
    
    The booking has been updated with the amount, but status might need manual review.
  `.trim();

  await sendAlertEmail(subject, text);
}
