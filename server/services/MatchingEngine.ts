import { levenshtein, normalizeName } from "../_core/utils/string";
import type { ParsedBankData } from "../workers/emailParsers";

export interface CandidateBooking {
  id: number;
  guestName: string | null;
  companyName: string | null;
  checkIn: Date;
  checkOut: Date;
  channel: string;
  property: string;
  totalPrice: string | null;
  amountPaid: string | null;
  hostRevenue: string | null;
  commission: string | null;
  reservationFee: string | null;
  depositAmount: string | null;
  icalUid: string | null;
  icalSummary: string | null;
  status: string;
}

export interface MatchResult {
  bookingId: number;
  score: number;
  booking: CandidateBooking;
  reasons: string[];
}

export class MatchingEngine {
  static scoreCandidates(transfer: ParsedBankData, candidates: CandidateBooking[], isPortalPayout: boolean): MatchResult[] {
    const results: MatchResult[] = [];

    // Specialized matching for Portal Payouts (Airbnb/Booking.com)
    if (isPortalPayout) {
      const matches = candidates
        .filter(c => {
          const cRevenue = parseFloat(String(c.hostRevenue || "0"));
          const cPaid = parseFloat(String(c.amountPaid || "0"));
          
          // Skip if already fully paid (within 1 PLN margin) for portal payouts.
          // This prevents duplicate matching when a booking was already marked paid (e.g. via email parser).
          if (cRevenue > 0 && cPaid >= cRevenue - 1.0) return false;

          return cRevenue > 0 && Math.abs(transfer.amount - cRevenue) / cRevenue < 0.01;
        })
        .sort((a, b) => {
          const revA = parseFloat(String(a.hostRevenue || "0"));
          const revB = parseFloat(String(b.hostRevenue || "0"));
          const diffA = Math.abs(transfer.amount - revA);
          const diffB = Math.abs(transfer.amount - revB);
          
          // If the difference in amount is negligible (less than 0.01 PLN), 
          // use the earliest check-in date as a tie-breaker.
          if (Math.abs(diffA - diffB) < 0.01) {
            return a.checkIn.getTime() - b.checkIn.getTime();
          }
          return diffA - diffB;
        });

      if (matches.length > 0) {
        return matches.map(m => ({
          bookingId: m.id,
          score: 100,
          booking: m,
          reasons: ["Portal payout: Exact or near match to host revenue"],
        }));
      }
    }

    for (const candidate of candidates) {
      const match = this.scoreSingleCandidate(transfer, candidate);
      if (match.score >= 25) {
        results.push(match);
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private static scoreSingleCandidate(transfer: ParsedBankData, candidate: CandidateBooking): MatchResult {
    let nameScore = 0;
    let titleScore = 0;
    let bonus = 0;
    const reasons: string[] = [];

    const tTitleNorm = normalizeName(transfer.transferTitle || "").toUpperCase();
    const hasDepositKeyword = tTitleNorm.includes("KAUCJA") || tTitleNorm.includes("DEPOZYT") || tTitleNorm.includes("DEPOSIT");

    const getNameScore = (nameA: string, nameB: string) => {
      const distance = levenshtein(nameA, nameB);
      const maxLen = Math.max(nameA.length, nameB.length);
      const similarity = 1 - distance / maxLen;
      
      if (similarity > 0.95) return 100;
      if (similarity > 0.85) return 90;
      if (similarity > 0.65) return 40;
      if (nameA.includes(nameB) || nameB.includes(nameA)) {
        const wordsA = nameA.split(/\s+/).filter(w => w.length > 2);
        const wordsB = nameB.split(/\s+/).filter(w => w.length > 2);
        if (wordsA.length >= 2 || wordsB.length >= 2) return 80;
        return 50;
      }
      const wordsA = nameA.split(/\s+/);
      const wordsB = nameB.split(/\s+/);
      for (const w of wordsA) {
        if (w.length > 3 && wordsB.includes(w)) return 30;
      }
      return 0;
    };

    let localNameScore = 0;
    if (transfer.senderName) {
      const tName = normalizeName(transfer.senderName);
      if (candidate.guestName) {
        const cName = normalizeName(candidate.guestName);
        const scoreOriginal = getNameScore(cName, tName);
        
        const tParts = tName.split(/\s+/).filter(p => p.length > 0);
        let scoreSwapped = 0;
        if (tParts.length >= 2) {
          const swapped = [tParts[tParts.length - 1], ...tParts.slice(1, -1), tParts[0]].join(" ");
          scoreSwapped = getNameScore(cName, swapped);
        }

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
        if (partMatch) partScore = 25;

        let surnameScore = 0;
        const cPartsNames = cName.split(/\s+/).filter(p => p.length > 0);
        const cSurname = cPartsNames[cPartsNames.length - 1];
        const tPartsNames = tName.split(/\s+/).filter(p => p.length > 0);
        const tSurname = tPartsNames[tPartsNames.length - 1];
        if (cSurname && tSurname && cSurname === tSurname && cSurname.length > 3) {
          surnameScore = 70; 
        }
        if (cSurname && tName.includes(cSurname)) {
          surnameScore = Math.max(surnameScore, 40); 
        }

        localNameScore = Math.max(localNameScore, scoreOriginal, scoreSwapped, partScore, surnameScore);
      }

      if (candidate.companyName) {
        const compName = normalizeName(candidate.companyName);
        const compScore = getNameScore(compName, tName);
        localNameScore = Math.max(localNameScore, compScore);
        if (compScore >= 90) reasons.push("Company name match (high)");
        else if (compScore >= 50) reasons.push("Partial company name match");
      }
    }

    nameScore = localNameScore;
    if (nameScore >= 90) reasons.push("Guest name match (high)");
    else if (nameScore === 50) reasons.push("Name is subset of sender or vice-versa");
    else if (nameScore > 0) reasons.push("Partial name match");

    if (transfer.transferTitle) {
      const tTitle = normalizeName(transfer.transferTitle).toUpperCase();
      
      const checkTitleForName = (name: string | null) => {
        if (!name) return { score: 0, reasons: [] };
        const nName = normalizeName(name);
        const nParts = nName.split(/\s+/).filter(p => p.length > 0);
        const nSurname = nParts[nParts.length - 1];
        
        const res: { score: number, reasons: string[] } = { score: 0, reasons: [] };

        if (tTitle.includes(nName.toUpperCase()) || tTitle.replace(/\s/g, "").includes(nName.toUpperCase().replace(/\s/g, ""))) {
          res.score = 100;
          res.reasons.push(`Name (${name}) found in transfer title`);
        } else {
          const nPartsTitle = nName.split(/\s+/).filter(p => p.length > 3);
          for (const part of nPartsTitle) {
            if (tTitle.includes(part.toUpperCase())) {
              res.score = 80;
              res.reasons.push(`Name part (${part}) found in transfer title`);
              break;
            }
          }
        }

        if (nSurname && nSurname.length > 3 && tTitle.includes(nSurname.toUpperCase()) && res.score < 80) {
          bonus += 40;
          res.reasons.push(`Surname (${nSurname}) found in transfer title`);
        }
        return res;
      };

      const guestMatch = checkTitleForName(candidate.guestName);
      const companyMatch = checkTitleForName(candidate.companyName);

      titleScore = Math.max(guestMatch.score, companyMatch.score);
      reasons.push(...guestMatch.reasons, ...companyMatch.reasons);

      const airbnbCodeMatch = tTitle.match(/HM[A-Z0-9]{8}/);
      if (airbnbCodeMatch && candidate.icalUid?.includes(airbnbCodeMatch[0])) {
        titleScore += 100;
        reasons.push(`Airbnb confirmation code match: ${airbnbCodeMatch[0]}`);
      }

      const bookingIdMatch = tTitle.match(/\d{10}/);
      if (bookingIdMatch && (candidate.icalUid?.includes(bookingIdMatch[0]) || candidate.icalSummary?.includes(bookingIdMatch[0]))) {
        titleScore += 100;
        reasons.push(`Booking.com ID match: ${bookingIdMatch[0]}`);
      }
    }

    if (transfer.transferTitle?.toLowerCase().includes("kaucja") || transfer.transferTitle?.toLowerCase().includes("deposit")) {
      titleScore += 40;
      reasons.push("Contains deposit keyword (kaucja/deposit)");
    }

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

      let referencedMonth: number | undefined;
      for (const [name, index] of Object.entries(monthMap)) {
        if (tLower.includes(name)) {
          referencedMonth = index;
          break;
        }
      }

      const dayMatchTitle = tLower.match(/\b([1-9]|[12][0-9]|3[01])\b/);
      const referencedDay = dayMatchTitle ? parseInt(dayMatchTitle[1]) : undefined;

      if (referencedMonth !== undefined && referencedDay !== undefined) {
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

    let amountScore = 0;
    if (transfer.amount) {
      const cTotal = parseFloat(String(candidate.totalPrice || "0"));
      const cPaid = parseFloat(String(candidate.amountPaid || "0"));
      const cRevenue = parseFloat(String(candidate.hostRevenue || "0"));
      const cComm = parseFloat(String(candidate.commission || "0"));
      const cResFee = parseFloat(String(candidate.reservationFee || "0"));
      const cDeposit = parseFloat(String(candidate.depositAmount || "500.00"));
      const cRemaining = Math.max(0, cTotal - cPaid);
      const isDepositMatch = Math.abs(transfer.amount - cDeposit) < 1.0;

      if (candidate.status === "portal_paid" && cRevenue > 0 && Math.abs(transfer.amount - cRevenue) < 1.0) {
        amountScore = 100;
        reasons.push("Matches host revenue (portal payout)");
      } else if (candidate.channel === "slowhop") {
        const hostPrepayment = cResFee - cComm;
        const guestBalance = (cTotal - cResFee) + cDeposit;
        const guestJustBalance = (cTotal - cResFee);
        if (cResFee > 0 && Math.abs(transfer.amount - hostPrepayment) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop host pre-payment (ResFee - Gross Commission)");
          bonus += 20;
        } else if (cTotal > 0 && Math.abs(transfer.amount - guestBalance) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop guest balance + deposit");
        } else if (cTotal > 0 && Math.abs(transfer.amount - guestJustBalance) < 1.0) {
          amountScore = 100;
          reasons.push("Matches Slowhop guest balance");
        }
      }

      if (isDepositMatch && hasDepositKeyword) {
        amountScore = 100;
        bonus += 20;
        reasons.push("Matches deposit amount + keyword");
      }

      if (amountScore === 0) {
        const isTotalMatch = cTotal > 0 && Math.abs(transfer.amount - cTotal) < 80.0;
        const isRemainingMatch = cRemaining > 0 && Math.abs(transfer.amount - cRemaining) < 80.0;
        const isResFeeMatch = cResFee > 0 && Math.abs(transfer.amount - cResFee) < 80.0;
        const isDepositMatchExact = Math.abs(transfer.amount - cDeposit) < 1.0;
        const isBothMatch = cRemaining > 0 && Math.abs(transfer.amount - (cRemaining + cDeposit)) <= 81.0;
        const isFullBothMatch = cTotal > 0 && Math.abs(transfer.amount - (cTotal + cDeposit)) <= 81.0;
        const isJustTotal = cTotal > 0 && Math.abs(transfer.amount - (cTotal - cDeposit)) <= 81.0;
        const isJustRemaining = cRemaining > 0 && Math.abs(transfer.amount - (cRemaining - cDeposit)) <= 81.0;
        const isRevenueMatch = cRevenue > 0 && Math.abs(transfer.amount - cRevenue) < 1.0;
        
        const isRestOfStayMatch = cTotal > 0 && cResFee > 0 && Math.abs(transfer.amount - (cTotal - cResFee)) <= 81.0;
        const isRestPlusDepositMatch = cTotal > 0 && cResFee > 0 && Math.abs(transfer.amount - (cTotal - cResFee + cDeposit)) <= 81.0;

        if (isTotalMatch || isRemainingMatch || isBothMatch || isFullBothMatch || isRevenueMatch || isResFeeMatch || isJustTotal || isJustRemaining || isRestOfStayMatch || isRestPlusDepositMatch) {
          amountScore = 100;
          reasons.push(
            isTotalMatch ? "Matches total price" : 
            isRemainingMatch ? "Matches remaining balance" : 
            isRevenueMatch ? "Matches host revenue" : 
            isResFeeMatch ? "Matches reservation fee" : 
            isFullBothMatch ? "Matches total + deposit" : 
            isBothMatch ? "Matches balance + deposit" : 
            isJustTotal ? "Matches stay price (no deposit)" : 
            isJustRemaining ? "Matches stay balance (no deposit)" :
            isRestOfStayMatch ? "Matches rest of stay price" :
            "Matches rest of stay + deposit"
          );
        } else if (isDepositMatchExact) {
          amountScore = 90;
          reasons.push("Matches deposit amount");
        }
      }

      if (amountScore === 0 && cTotal > 0) {
        const diffTotal = Math.abs(transfer.amount - cTotal) / cTotal;
        const diffBoth = cRemaining > 0 ? Math.abs(transfer.amount - (cRemaining + cDeposit)) / (cRemaining + cDeposit) : 1.0;
        
        if (diffTotal < 0.15 || diffBoth < 0.15) {
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
      } else if (amountScore === 0) {
        amountScore = 40;
      }
    } else {
      amountScore = 40;
    }

    const finalDateScore = Math.max(dateScore, titleDateMatch);
    let score = Math.round(finalNameScore * 0.4 + finalDateScore * 0.1 + amountScore * 0.5) + bonus;

    if (reasons.some(r => r.includes("Shared surname")) && amountScore === 100) {
      score += 40;
      reasons.push("Surname + Amount match bonus");
    }

    if (finalNameScore >= 90 && amountScore >= 90) {
      score += 20;
      reasons.push("Obvious match bonus (Name + Amount)");
    }

    return {
      bookingId: candidate.id,
      score: Math.min(110, score),
      booking: candidate,
      reasons,
    };
  }
}