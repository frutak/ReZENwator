import { levenshtein, normalizeName } from "../_core/utils/string";
import { ENV } from "../_core/env";
import type { Property } from "@shared/config";
import type { ParsedBankData } from "../workers/emailParsers";

export interface CandidateBooking {
  id: number;
  guestName: string | null;
  companyName: string | null;
  checkIn: Date;
  checkOut: Date;
  /** When the booking entered the system — the anchor for a portal's forward. */
  createdAt?: Date | string | null;
  /**
   * How many matched transfers already stand behind this booking's balance.
   * Absent means unknown, which is treated as "backed" — the conservative
   * reading for callers that do not supply it.
   */
  matchedTransferCount?: number;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When each channel's money is actually due to land.
 *
 *   Slowhop / Alohacamp — the forward of the zaliczka goes out at most 2 days
 *     after the reservation is made, plus a business day to arrive (Slowhop runs
 *     payouts around Mon/Wed/Fri). It lands within days of the booking, normally
 *     months before check-in.
 *   Airbnb — the payout is sent on the second day of the stay (check-in + 1) and
 *     is usually credited the next day.
 *   Booking.com — pays the whole stay about 5 business days after checkout; the
 *     transfers originate in NL/LU, so their holidays shift it a day or two.
 *
 * Scoring a portal payout by its distance from check-in — the generic rule —
 * gets all three wrong: a Slowhop forward can precede check-in by months (5
 * points, "very far in range") and a Booking.com payout follows checkout by a
 * week. Anchoring each to the date its own channel pays on turns a near-useless
 * date signal into a decisive one.
 */
function expectedPayoutDate(channel: string, candidate: CandidateBooking): Date | null {
  switch (channel) {
    case "slowhop":
    case "alohacamp": {
      if (!candidate.createdAt) return null;
      return new Date(new Date(candidate.createdAt).getTime() + 2 * DAY_MS);
    }
    case "airbnb":
      return new Date(new Date(candidate.checkIn).getTime() + DAY_MS);
    case "booking":
      return new Date(new Date(candidate.checkOut).getTime() + 6 * DAY_MS);
    default:
      return null;
  }
}

/** Which portal, if any, this transfer came from. */
export function payoutSource(transfer: ParsedBankData): string | null {
  const text = `${transfer.senderName ?? ""} ${transfer.transferTitle ?? ""}`.toUpperCase();
  if (text.includes("SLOWHOP")) return "slowhop";
  if (text.includes("ALOHACAMP")) return "alohacamp";
  if (text.includes("AIRBNB") || text.includes("PAYONEER")) return "airbnb";
  if (text.includes("BOOKING.COM")) return "booking";
  return null;
}

/**
 * Which property a Booking.com payout is for, read off its own reference.
 *
 * Every Booking.com payout title ends in the hotel ID — Hacjenda is 13416371,
 * Sadoles 13324071 — as in "NO.0BW2CPZM38GEV9Z9/13416371." Across all 18
 * payouts recorded so far it agrees with the matched booking's property every
 * single time, which makes it the one piece of hard evidence a portal payout
 * carries about where the money belongs. Everything else — amount, dates — is
 * inference.
 *
 * The digits are read from after the slash rather than from anywhere in the
 * title: the reference in front of it is alphanumeric and could hold a run of
 * seven digits of its own, and picking that up would silently resolve to no
 * property (harmless) or, far worse, to the wrong one.
 *
 * Returns null when the ID is absent or unrecognised, which is the signal to
 * fall back to matching without it. That also keeps the whole mechanism inert
 * until `SADOLES_BOOKING_ID` / `HACJENDA_BOOKING_ID` are configured.
 */
export function payoutProperty(transfer: ParsedBankData): Property | null {
  const match = /\/\s*(\d{7,10})\b/.exec(transfer.transferTitle ?? "");
  if (!match) return null;
  const id = match[1];
  if (ENV.hacjendaBookingId && id === ENV.hacjendaBookingId) return "Hacjenda";
  if (ENV.sadolesBookingId && id === ENV.sadolesBookingId) return "Sadoles";
  return null;
}

/**
 * How well a transfer's date fits the payout clock of the channel it came from.
 * Returns 0 for anything that is not a portal payout — a guest's own transfer is
 * still judged by its proximity to check-in.
 */
function payoutTimingScore(
  transfer: ParsedBankData,
  candidate: CandidateBooking
): { score: number; reason?: string } {
  const source = payoutSource(transfer);
  if (!source || source !== candidate.channel || !transfer.transferDate) return { score: 0 };

  const expected = expectedPayoutDate(source, candidate);
  if (!expected) return { score: 0 };

  const diffDays = Math.abs(transfer.transferDate.getTime() - expected.getTime()) / DAY_MS;
  const label =
    source === "slowhop" || source === "alohacamp"
      ? "just after the booking was made"
      : source === "airbnb"
        ? "on the second day of the stay"
        : "days after checkout";

  // Slack: bank holidays and the portals' own payout days move the date around.
  if (diffDays <= 4) return { score: 100, reason: `Payout landed when ${source} pays — ${label}` };
  if (diffDays <= 10) return { score: 70, reason: `Payout landed near ${source}'s usual date — ${label}` };
  return { score: 0 };
}

/**
 * Is this payout still owed to this booking?
 *
 * Lifted out of the portal-payout branch of `scoreCandidates` so the
 * combined-payout search applies exactly the same test. A batch is only ever
 * assembled from bookings that a single payout could have been assembled from;
 * the two must not disagree about which those are.
 *
 * A balance typed in by hand is a claim with no transfer behind it, so a
 * booking whose `amountPaid` covers its revenue is only excluded when a
 * transfer actually backs it — see the note on the Airbnb payout of 24.05.2026.
 */
function isPayoutOutstanding(candidate: CandidateBooking): boolean {
  const revenue = parseFloat(String(candidate.hostRevenue || "0"));
  if (!(revenue > 0)) return false;
  const paid = parseFloat(String(candidate.amountPaid || "0"));
  const isBacked = (candidate.matchedTransferCount ?? 1) > 0;
  return !(paid >= revenue - 1.0 && isBacked);
}

/** One booking's share of a payout that covers several. */
export interface PayoutAllocation {
  bookingId: number;
  amount: number;
  booking: CandidateBooking;
}

export interface CombinedPayoutMatch {
  allocations: PayoutAllocation[];
  reasons: string[];
}

/**
 * How many bookings one payout is allowed to cover.
 *
 * Booking.com batches per property and per payout run, so in practice this is
 * two. Three is headroom; beyond that the search stops being evidence and
 * starts being numerology — with enough parts some subset sums to almost any
 * amount.
 */
const COMBINED_PAYOUT_MAX_PARTS = 3;

/**
 * How close the parts must add up. A batch is the portal adding its own
 * figures, so it is exact to the grosz — 1797.40 + 1964.60 = 3762.00. This is
 * a rounding allowance, deliberately not the 1% slack a single payout gets:
 * fuzz is what turns a subset sum into a coincidence.
 */
const COMBINED_PAYOUT_TOLERANCE = 0.02;

/** How far a part's own payout date may sit from the day the batch landed. */
const COMBINED_PAYOUT_WINDOW_DAYS = 10;

/**
 * Above this many candidates the search is abandoned rather than widened.
 * The payout window normally leaves one to three; a pool this large means the
 * window failed to constrain anything, and a sum found in it would not be
 * evidence of anything either.
 */
const COMBINED_PAYOUT_MAX_POOL = 12;

/** Every combination of exactly `size` items, in index order. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      out.push([items[i], ...rest]);
    }
  }
  return out;
}

export class MatchingEngine {
  /**
   * The bookings a payout could belong to: same channel, same property when the
   * transfer names one, and still owed the money.
   */
  private static eligiblePayoutCandidates(
    transfer: ParsedBankData,
    candidates: CandidateBooking[],
    source: string
  ): CandidateBooking[] {
    const property = payoutProperty(transfer);
    return candidates.filter(
      c => c.channel === source && (!property || c.property === property) && isPayoutOutstanding(c)
    );
  }

  /**
   * One payout, several bookings.
   *
   * Booking.com pays per property, per payout run: two stays in the same
   * property whose payout dates fall in the same run go out as a single
   * transfer. On 2026-09-09 that happened for the first time in six years —
   * 3762.00 PLN covering bookings #85 (1797.40) and #91 (1964.60), both
   * Hacjenda. `scoreCandidates` compares the transfer against one booking's
   * revenue at a time, so it had nothing to offer: the two stays it was
   * actually made of did not appear in its top five at all, and the five it did
   * offer were all the wrong property.
   *
   * The search is deliberately narrow, because a subset sum over a loose pool
   * will find something in almost any set of numbers:
   *
   *   - only when no single booking accounts for the payout on its own. A
   *     batch is what is left when the ordinary explanation fails, and this
   *     alone rules out all 17 payouts that came before.
   *   - only bookings the portal still owes, in the property the transfer
   *     names, whose own payout dates sit within days of the day it landed.
   *   - the parts must add up exactly, and there must be exactly one way to
   *     make the total. Two ways is not a near miss, it is a guess, and the
   *     owner is better served by an honest blank.
   *
   * Run over every Booking.com payout on record, those rules fire once: on the
   * transfer that needs them, with the right pair, exact to the grosz.
   *
   * Nothing here applies the money. The result is a proposal for the owner to
   * confirm, which is why an exact sum is allowed to be decisive without also
   * having to survive the scoring model.
   */
  static findCombinedPayout(
    transfer: ParsedBankData,
    candidates: CandidateBooking[]
  ): CombinedPayoutMatch | null {
    const source = payoutSource(transfer);
    if (!source || !transfer.transferDate || !(transfer.amount > 0)) return null;

    const eligible = this.eligiblePayoutCandidates(transfer, candidates, source);

    // A payout one booking explains on its own is not a batch.
    const explainedAlone = eligible.some(c => {
      const revenue = parseFloat(String(c.hostRevenue || "0"));
      return Math.abs(transfer.amount - revenue) / revenue < 0.01;
    });
    if (explainedAlone) return null;

    const pool = eligible.filter(c => {
      const expected = expectedPayoutDate(source, c);
      if (!expected) return false;
      const diffDays = Math.abs(transfer.transferDate!.getTime() - expected.getTime()) / DAY_MS;
      return diffDays <= COMBINED_PAYOUT_WINDOW_DAYS;
    });
    if (pool.length < 2 || pool.length > COMBINED_PAYOUT_MAX_POOL) return null;

    const revenueOf = (c: CandidateBooking) => parseFloat(String(c.hostRevenue || "0"));

    // Smallest batch first: a pair is a better account of the money than a
    // triple that happens to reach the same total.
    for (let size = 2; size <= Math.min(COMBINED_PAYOUT_MAX_PARTS, pool.length); size++) {
      const exact = combinations(pool, size).filter(combo => {
        const sum = combo.reduce((acc, c) => acc + revenueOf(c), 0);
        return Math.abs(sum - transfer.amount) < COMBINED_PAYOUT_TOLERANCE;
      });

      // More than one way to reach the total is ambiguity, not a match.
      if (exact.length !== 1) {
        if (exact.length > 1) return null;
        continue;
      }

      const combo = [...exact[0]].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
      const parts = combo.map(c => revenueOf(c).toFixed(2)).join(" + ");
      const property = payoutProperty(transfer);

      return {
        allocations: combo.map(c => ({ bookingId: c.id, amount: revenueOf(c), booking: c })),
        reasons: [
          `Combined ${source} payout: ${parts} = ${transfer.amount.toFixed(2)}`,
          `${combo.length} stays still owed by the portal, paid out together`,
          ...(property ? [`Payout reference names ${property}`] : []),
        ],
      };
    }

    return null;
  }

  static scoreCandidates(transfer: ParsedBankData, candidates: CandidateBooking[], isPortalPayout: boolean): MatchResult[] {
    const results: MatchResult[] = [];

    // The payout's own reference says which property it is for, and it is never
    // wrong. Dropping the other property's stays here rather than letting them
    // compete on price is what stops a Hacjenda payout being offered five
    // Sadoles bookings that happen to cost about the same.
    const property = payoutProperty(transfer);
    const pool = property ? candidates.filter(c => c.property === property) : candidates;

    // Specialized matching for Portal Payouts (Airbnb/Booking.com)
    if (isPortalPayout) {
      const matches = pool
        .filter(c => {
          // Skip a booking that is already fully paid, so a payout cannot be
          // applied to it twice — see `isPayoutOutstanding`, which the
          // combined-payout search shares so the two cannot drift apart.
          if (!isPayoutOutstanding(c)) return false;

          const cRevenue = parseFloat(String(c.hostRevenue || "0"));
          return Math.abs(transfer.amount - cRevenue) / cRevenue < 0.01;
        })
        .sort((a, b) => {
          const revA = parseFloat(String(a.hostRevenue || "0"));
          const revB = parseFloat(String(b.hostRevenue || "0"));
          const diffA = Math.abs(transfer.amount - revA);
          const diffB = Math.abs(transfer.amount - revB);

          // If the difference in amount is negligible (less than 0.01 PLN), the
          // payout clock decides: Airbnb pays on day 2 of the stay and
          // Booking.com about 5 business days after checkout, so the booking
          // whose own payout date sits closest to this transfer wins. Two stays
          // priced identically are otherwise indistinguishable, and the old
          // tie-break — earliest check-in — picked by nothing but age.
          if (Math.abs(diffA - diffB) < 0.01) {
            const timingA = payoutTimingScore(transfer, a).score;
            const timingB = payoutTimingScore(transfer, b).score;
            if (timingA !== timingB) return timingB - timingA;
            return a.checkIn.getTime() - b.checkIn.getTime();
          }
          return diffA - diffB;
        });

      if (matches.length > 0) {
        return matches.map(m => ({
          bookingId: m.id,
          score: 100,
          booking: m,
          reasons: ["Portal payout: Exact or near match to host revenue (within 1%)"],
        }));
      }
    }

    for (const candidate of pool) {
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
      } else if (candidate.channel === "slowhop" || candidate.channel === "alohacamp") {
        // Both portals settle the same way: they forward the guest's zaliczka
        // less their whole commission, and the guest then pays the rest (plus
        // the kaucja) straight to the owner's account. The forward is the amount
        // that needs naming explicitly — on a 2700 zł Alohacamp stay it is
        // 675 − 498.15 = 176.85, which none of the generic amount tests below
        // come close to, leaving it at a score of 10.
        const label = candidate.channel === "slowhop" ? "Slowhop" : "Alohacamp";
        const hostPrepayment = cResFee - cComm;
        const guestBalance = (cTotal - cResFee) + cDeposit;
        const guestJustBalance = (cTotal - cResFee);
        if (cResFee > 0 && Math.abs(transfer.amount - hostPrepayment) < 1.0) {
          amountScore = 100;
          reasons.push(`Matches ${label} host pre-payment (ResFee - Gross Commission)`);
          bonus += 20;
        } else if (cTotal > 0 && Math.abs(transfer.amount - guestBalance) < 1.0) {
          amountScore = 100;
          reasons.push(`Matches ${label} guest balance + deposit`);
        } else if (cTotal > 0 && Math.abs(transfer.amount - guestJustBalance) < 1.0) {
          amountScore = 100;
          reasons.push(`Matches ${label} guest balance`);
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

    // A portal payout is dated by its own clock, not by the guest's arrival.
    const timing = payoutTimingScore(transfer, candidate);
    if (timing.reason) reasons.push(timing.reason);

    const finalDateScore = Math.max(dateScore, titleDateMatch, timing.score);
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