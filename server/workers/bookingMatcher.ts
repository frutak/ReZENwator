/**
 * Booking Matcher
 *
 * Implements fuzzy matching between bank transfer data (from Nestbank emails)
 * and existing bookings in the database. Uses a scoring algorithm based on:
 *   - Guest name similarity (Levenshtein distance)
 *   - Date proximity (transfer date vs check-in date)
 *   - Amount matching (exact match or partial payment)
 */

import { and, eq, gte, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import type { ParsedBankEmail } from "./emailParsers";
import type { Booking } from "../../drizzle/schema";
import { sendAlertEmail } from "../_core/email";
import { levenshtein, normalizeName } from "../_core/utils/string";
import { Logger } from "../_core/logger";

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

import { ENV } from "../_core/env";

/**
 * Scores how well a bank transfer matches a candidate booking.
 */
export async function findMatchingBookings(
  transfer: ParsedBankEmail
): Promise<Array<{ bookingId: number; score: number; guestName: string | null; checkIn: Date; channel: string; property: string; reasons: string[] }>> {
  const db = await getDb();
  if (!db) return [];

  // 1. Fetch "active" bookings
  // We look for bookings within a very wide window to catch early payments or late deposit returns
  const windowStart = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowStart.setDate(windowStart.getDate() - 365); // Look 1 year back
  const windowEnd = new Date(transfer.transferDate?.getTime() ?? Date.now());
  windowEnd.setDate(windowEnd.getDate() + 365);  // Look 1 year ahead

  const candidates = await db
    .select()
    .from(bookings)
    .where(
      and(
        or(
          eq(bookings.status, "pending"),
          eq(bookings.status, "confirmed"),
          eq(bookings.status, "portal_paid"),
          eq(bookings.status, "paid"),
          eq(bookings.status, "finished") // Include finished for deposit matching
        ),
        gte(bookings.checkIn, windowStart),
        lte(bookings.checkIn, windowEnd)
      )
    );

  const results: any[] = [];

  // Specialized matching for Portal Payouts (Airbnb/Booking.com)
  const tTitle = normalizeName(transfer.transferTitle || "").toUpperCase();
  const isAirbnbPayout = tTitle.includes("AIRBNB") || transfer.senderName?.toUpperCase().includes("PAYONEER");
  
  // Detection for Booking.com: check for name OR known property IDs
  const objectIdMatch = transfer.transferTitle?.match(/(\d{7,10})/);
  const oid = objectIdMatch ? objectIdMatch[1] : null;
  const isBookingPayout = tTitle.includes("BOOKING.COM") || (ENV.hacjendaBookingId && oid === ENV.hacjendaBookingId) || (ENV.sadolesBookingId && oid === ENV.sadolesBookingId);

  if (isAirbnbPayout || isBookingPayout) {
    const portalChannel = isAirbnbPayout ? "airbnb" : "booking";
    
    // Narrow down to candidates for this channel that are awaiting payout
    let portalCandidates = candidates.filter(c => 
      c.channel === portalChannel && 
      (c.status === "portal_paid" || c.status === "finished")
    );
    
    // If Booking.com, try to narrow down by property using objectId
    if (isBookingPayout && oid) {
      if (ENV.hacjendaBookingId && oid === ENV.hacjendaBookingId) portalCandidates = portalCandidates.filter(c => c.property === "Hacjenda");
      else if (ENV.sadolesBookingId && oid === ENV.sadolesBookingId) portalCandidates = portalCandidates.filter(c => c.property === "Sadoles");
    }
    
    if (portalCandidates.length > 0) {
      // Find candidate with closest hostRevenue
      let bestPortalMatch: any = null;
      let minDiff = Infinity;

      for (const candidate of portalCandidates) {
        const cRevenue = parseFloat(String(candidate.hostRevenue || "0"));
        if (cRevenue <= 0) continue;

        const diff = Math.abs(transfer.amount - cRevenue);
        const diffPercent = diff / cRevenue;

        if (diffPercent < 0.01 && diff < minDiff) {
          minDiff = diff;
          bestPortalMatch = candidate;
        }
      }

      if (bestPortalMatch) {
        // High certainty match for portal payout
        return [{
          bookingId: bestPortalMatch.id,
          score: 100,
          bestNameScore: 100,
          dateScore: 100,
          amountScore: 100,
          guestName: bestPortalMatch.guestName ?? null,
          checkIn: bestPortalMatch.checkIn,
          channel: bestPortalMatch.channel,
          property: bestPortalMatch.property,
          reasons: ["Portal payout: Exact or near match to host revenue (within 1%)"],
        }];
      }
    }
  }

  for (const candidate of candidates) {
    let nameScore = 0;
    let titleScore = 0;
    const reasons: string[] = [];

    // ── Name score (100 points max) ──────────────────────────────────────────
    if (candidate.guestName && transfer.senderName) {
      const cName = normalizeName(candidate.guestName);
      const tName = normalizeName(transfer.senderName);
      
      const getNameScore = (nameA: string, nameB: string) => {
        const distance = levenshtein(nameA, nameB);
        const maxLen = Math.max(nameA.length, nameB.length);
        const similarity = 1 - distance / maxLen;
        
        if (similarity > 0.95) return 100; // Perfect or near-perfect
        if (similarity > 0.85) return 90;  // Strong match
        if (similarity > 0.65) return 40;  // Medium match (penalized from 60)
        if (nameA.includes(nameB) || nameB.includes(nameA)) return 50;
        return 0;
      };

      // 1. Original match
      const scoreOriginal = getNameScore(cName, tName);
      
      // 2. Swapped match (First and last words swapped)
      const tParts = tName.split(/\s+/).filter(p => p.length > 0);
      let scoreSwapped = 0;
      if (tParts.length >= 2) {
        const swapped = [tParts[tParts.length - 1], ...tParts.slice(1, -1), tParts[0]].join(" ");
        scoreSwapped = getNameScore(cName, swapped);
      }

      // 3. Individual part match
      let partScore = 0;
      const cParts = cName.split(/\s+/).filter(p => p.length > 3);
      const tPartsLong = tName.split(/\s+/).filter(p => p.length > 3);
      let partMatch = false;
      for (const cp of cParts) {
        for (const tp of tPartsLong) {
          if (cp === tp) { partMatch = true; break; }
        }
        if (partMatch) break;
      }
      if (partMatch) partScore = 25; // Penalized from 40

      // Special check: Shared surname
      let surnameScore = 0;
      const cPartsNames = cName.split(/\s+/).filter(p => p.length > 0);
      const tPartsNames = tName.split(/\s+/).filter(p => p.length > 0);
      const cSurname = cPartsNames[cPartsNames.length - 1];
      const tSurname = tPartsNames[tPartsNames.length - 1];
      if (cSurname && tSurname && cSurname === tSurname && cSurname.length > 3) {
        surnameScore = 30; // Penalized from 40
      }

      nameScore = Math.max(scoreOriginal, scoreSwapped, partScore, surnameScore);
      if (nameScore >= 90) reasons.push("Guest name match (high)");
      else if (nameScore === 50) reasons.push("Name is subset of sender or vice-versa");
      else if (nameScore > 0) reasons.push(surnameScore === nameScore ? `Shared surname: ${cSurname}` : "Partial name match");
    }

    // Also check transfer title for guest name or Airbnb confirmation codes
    if (transfer.transferTitle) {
      const tTitle = normalizeName(transfer.transferTitle).toUpperCase();
      
      if (candidate.guestName) {
        const cName = normalizeName(candidate.guestName);
        if (tTitle.includes(cName)) {
          titleScore += 70;
          reasons.push("Guest name found in transfer title");
        } else {
          // Check for individual name parts (surnames)
          const cPartsTitle = cName.split(/\s+/).filter(p => p.length > 3);
          for (const part of cPartsTitle) {
            if (tTitle.includes(part.toUpperCase())) {
              titleScore += 50;
              reasons.push(`Name part (${part}) found in transfer title`);
              break;
            }
          }
        }
      }
      // ... (rest of the code for Airbnb and Booking.com codes)

      // Airbnb codes are 10-character alphanumeric starting with HM...
      const airbnbCodeMatch = tTitle.match(/HM[A-Z0-9]{8}/);
      if (airbnbCodeMatch && candidate.icalUid?.includes(airbnbCodeMatch[0])) {
        titleScore += 100;
        reasons.push(`Airbnb confirmation code match: ${airbnbCodeMatch[0]}`);
      }

      // Booking.com IDs are 10-digit numbers
      const bookingIdMatch = tTitle.match(/\d{10}/);
      if (bookingIdMatch && (candidate.icalUid?.includes(bookingIdMatch[0]) || candidate.icalSummary?.includes(bookingIdMatch[0]))) {
        titleScore += 100;
        reasons.push(`Booking.com ID match: ${bookingIdMatch[0]}`);
      }
    }

    // Special check: Deposit keyword "kaucja" or "deposit"
    if (transfer.transferTitle?.toLowerCase().includes("kaucja") || transfer.transferTitle?.toLowerCase().includes("deposit")) {
      titleScore += 40;
      reasons.push("Contains deposit keyword (kaucja/deposit)");
    }

    // Special check: Dates in title (e.g. "24-26 lipca")
    let titleDateMatch = 0;
    if (transfer.transferTitle) {
      const monthMap: Record<string, number> = {
        stycze: 0, lut: 1, mar: 2, kwie: 3, maja: 4, maj: 4, czerw: 5, lip: 6, sierp: 7, wrzes: 8, paźdz: 9, pazdz: 9, list: 10, grud: 11,
        jan: 0, feb: 1, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      
      const tLower = transfer.transferTitle.toLowerCase();
      const cIn = new Date(candidate.checkIn);
      const cMonth = cIn.getMonth();
      const cDay = cIn.getDate();

      // Extract month from title
      let referencedMonth: number | undefined;
      for (const [name, index] of Object.entries(monthMap)) {
        if (tLower.includes(name)) {
          referencedMonth = index;
          break;
        }
      }

      // Extract first number that looks like a day (1-31)
      const dayMatchTitle = tLower.match(/\b([1-9]|[12][0-9]|3[01])\b/);
      const referencedDay = dayMatchTitle ? parseInt(dayMatchTitle[1]) : undefined;

      if (referencedMonth !== undefined && referencedDay !== undefined) {
        // We have a full date reference. Calculate proximity to candidate check-in.
        const referencedDate = new Date(cIn.getFullYear(), referencedMonth, referencedDay);
        const diffRef = Math.abs((cIn.getTime() - referencedDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffRef === 0) {
          titleDateMatch = 100;
          reasons.push(`Title exactly matches booking date: ${referencedDay}.${referencedMonth + 1}`);
        } else if (diffRef <= 2) {
          titleDateMatch = 80;
          reasons.push(`Title references very close date: ${referencedDay}.${referencedMonth + 1}`);
        }
      } else if (referencedMonth === cMonth) {
        titleDateMatch = 30;
        reasons.push(`Title contains matching month: ${cMonth + 1}`);
      }
    }

    const bestNameScore = Math.min(100, nameScore);
    const bestTitleScore = Math.min(100, titleScore);
    const finalNameScore = Math.max(bestNameScore, bestTitleScore);

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
    } else if (diffDays <= 120) {
      dateScore = 15;
      reasons.push("Date is far in range (<120 days)");
    } else if (diffDays <= 365) {
      dateScore = 5;
      reasons.push("Date is very far in range (<365 days)");
    }

    // ── Amount score (100 points max) ────────────────────────────────────────
    let amountScore = 0;
    if (transfer.amount) {
      const cTotal = parseFloat(String(candidate.totalPrice || "0"));
      const cPaid = parseFloat(String(candidate.amountPaid || "0"));
      const cRevenue = parseFloat(String(candidate.hostRevenue || "0"));
      const cComm = parseFloat(String(candidate.commission || "0"));
      const cResFee = parseFloat(String(candidate.reservationFee || "0"));
      const cDeposit = parseFloat(String(candidate.depositAmount || "500.00"));
      const cRemaining = Math.max(0, cTotal - cPaid);
      
      const isPetFeeMatch = candidate.channel === "booking" && 
                           candidate.animalsCount != null && 
                           candidate.animalsCount > 0 && 
                           Math.abs(transfer.amount - (candidate.animalsCount * 200.0)) < 1.0;

      let isMatch = false;

      if (isPetFeeMatch) {
        amountScore = 100;
        reasons.push(`Matches pet fee for ${candidate.animalsCount} pet(s)`);
        isMatch = true;
      }

      if (!isMatch && candidate.status === "portal_paid") {
        // High priority: match host revenue (net amount from portal)
        if (cRevenue > 0 && Math.abs(transfer.amount - cRevenue) < 1.0) {
          amountScore = 100;
          reasons.push("Matches host revenue (portal payout)");
          isMatch = true;
        }
      }

      if (!isMatch && candidate.channel === "slowhop") {
        // Slowhop Target 1: Rest of pre-payment (Portal -> Host)
        // GuestPrepayment (cResFee) - Commission (cComm)
        const hostPrepayment = cResFee - cComm;
        if (cResFee > 0 && Math.abs(transfer.amount - hostPrepayment) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop host pre-payment (ResFee - Commission)");
          isMatch = true;
        }
        
        // Slowhop Target 2: Balance + Deposit from Guest
        // (Total - GuestPrepayment) + Deposit
        const guestBalance = (cTotal - cResFee) + cDeposit;
        if (cTotal > 0 && Math.abs(transfer.amount - guestBalance) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop guest balance + deposit");
          isMatch = true;
        }

        // Slowhop Target 3: Just Balance from Guest
        const guestJustBalance = (cTotal - cResFee);
        if (cTotal > 0 && Math.abs(transfer.amount - guestJustBalance) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop guest balance");
          isMatch = true;
        }
      }

      if (!isMatch) {
        const isTotalMatch = cTotal > 0 && Math.abs(transfer.amount - cTotal) < 1.0;
        const isRemainingMatch = cRemaining > 0 && Math.abs(transfer.amount - cRemaining) < 1.0;
        const isResFeeMatch = cResFee > 0 && Math.abs(transfer.amount - cResFee) < 1.0;
        const isDepositMatch = Math.abs(transfer.amount - cDeposit) < 1.0;
        const isBothMatch = cRemaining > 0 && Math.abs(transfer.amount - (cRemaining + cDeposit)) < 1.0;
        const isRevenueMatch = cRevenue > 0 && Math.abs(transfer.amount - cRevenue) < 1.0;

        if (isTotalMatch || isRemainingMatch || isBothMatch || isRevenueMatch || isResFeeMatch) {
          amountScore = 100;
          reasons.push(isTotalMatch ? "Matches total price" : isRemainingMatch ? "Matches remaining balance" : isRevenueMatch ? "Matches host revenue" : isResFeeMatch ? "Matches reservation fee" : "Matches balance + deposit");
          isMatch = true;
        } else if (isDepositMatch) {
          amountScore = 90;
          reasons.push("Matches deposit amount");
          isMatch = true;
        }
      }

      if (!isMatch && cTotal > 0) {
        // Near matches (e.g. within 10% of total or balance+deposit)
        const diffTotal = Math.abs(transfer.amount - cTotal) / cTotal;
        const diffBoth = cRemaining > 0 ? Math.abs(transfer.amount - (cRemaining + cDeposit)) / (cRemaining + cDeposit) : 1.0;
        
        if (diffTotal < 0.1 || diffBoth < 0.1) {
          amountScore = 80;
          reasons.push(`Near match to total or balance+deposit (${Math.round(Math.min(diffTotal, diffBoth) * 100)}% diff)`);
        } else {
          const ratio = transfer.amount / cTotal;
          if (ratio >= 0.1 && ratio <= 1.1) {
            amountScore = 50;
            reasons.push("Amount is plausible partial payment");
          } else {
            amountScore = 10;
          }
        }
      } else if (!isMatch) {
        amountScore = 40;
      }
    } else {
      amountScore = 40; // No price data — neutral
    }

    // ── Composite score ────────────────────────────────────────────────────
    // Weights: name 50%, date 10%, amount 40%
    // titleDateMatch is a bonus that can override date proximity if it's high
    const finalDateScore = Math.max(dateScore, titleDateMatch);
    let score = Math.round(finalNameScore * 0.5 + finalDateScore * 0.1 + amountScore * 0.4);

    // Bonus for "Obvious Match" — both name and amount are very strong
    if (finalNameScore >= 90 && amountScore >= 90) {
      score += 20;
      reasons.push("Obvious match bonus (Name + Amount)");
    }

    if (score >= 25) {
      results.push({
        bookingId: candidate.id,
        score: Math.min(110, score), // cap at 110
        bestNameScore: finalNameScore,
        dateScore: finalDateScore,
        amountScore,
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

  const isPetFeeMatch = b.channel === "booking" && 
                       b.animalsCount != null && 
                       b.animalsCount > 0 && 
                       Math.abs(transferAmount - (b.animalsCount * 200.0)) < 1.0;

  const cResFee = parseFloat(String(b.reservationFee || "0"));
  const isResFeeMatch = cResFee > 0 && Math.abs(transferAmount - cResFee) < 1.0;
  const cComm = parseFloat(String(b.commission || "0"));
  const cRevenue = parseFloat(String(b.hostRevenue || "0"));

  if (b.channel === "slowhop") {
    const hostPrepayment = cResFee - cComm;
    const guestBalance = totalPrice - cResFee;
    const guestBalancePlusDeposit = guestBalance + depositReq;

    if (Math.abs(transferAmount - hostPrepayment) < 1.0) {
      // Slowhop pre-payment forward - status stays 'confirmed' (or current)
      newStatus = b.status === "pending" ? "confirmed" : b.status;
    } else if (Math.abs(transferAmount - guestBalancePlusDeposit) < 1.0) {
      newStatus = "paid";
      newDepositStatus = "paid";
    } else if (Math.abs(transferAmount - guestBalance) < 1.0) {
      newStatus = "paid";
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
    } else {
      await sendPaymentMismatchEmail(b, transferAmount, { toBePaid: guestBalance, depositReq, resFee: cResFee });
    }
  } else if (b.status === "portal_paid") {
    // Portals (Airbnb/Booking) that were already marked as portal_paid
    const diff = Math.abs(transferAmount - cRevenue);
    const diffPercent = cRevenue > 0 ? diff / cRevenue : 1.0;

    if (diffPercent < 0.01) {
      newStatus = "paid";
    } else if (isDepositMatch) {
      newDepositStatus = "paid";
    } else if (isPetFeeMatch) {
      // Pet fee paid
    } else {
      await sendPaymentMismatchEmail(b, transferAmount, { toBePaid: cRevenue, depositReq });
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
      await sendPaymentMismatchEmail(b, transferAmount, { toBePaid, depositReq, resFee: cResFee });
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
    } else {
      newStatus = "paid"; // Usually the portal payment
      if (!isToBePaidMatch && toBePaid > 0) {
        await sendPaymentMismatchEmail(b, transferAmount, { toBePaid, depositReq, resFee: cResFee });
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

  await Logger.bookingAction(bookingId, "status_change", `Auto-matched bank transfer (Score: ${score})`, `Sender: ${transfer.senderName}, Amount: ${transferAmount} PLN, New Status: ${newStatus}`);

  console.log(`[Matcher] Booking #${bookingId} updated: status=${newStatus}, deposit=${newDepositStatus}`);
}

async function sendPaymentMismatchEmail(booking: Booking, amount: number, expected: { toBePaid: number; depositReq: number; resFee?: number }) {
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
