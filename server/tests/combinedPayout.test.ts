import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MatchingEngine, payoutProperty, type CandidateBooking } from "../services/MatchingEngine";
import type { ParsedBankData } from "../workers/emailParsers";

/**
 * One payout, two bookings.
 *
 * On 2026-09-09 Booking.com sent 3762.00 PLN covering two Hacjenda stays —
 * #85 (1797.40) and #91 (1964.60) — the first combined payout in six years.
 * Booking.com batches per property and per payout run, so it happens whenever
 * two stays in the same property come due together; rare, but not a one-off.
 *
 * These cases are the real numbers, plus the ones that must *not* be read as a
 * batch. That second group is the point: a subset sum will find something in
 * almost any set of figures, so the value of the search is entirely in what it
 * refuses.
 */

const SADOLES_ID = "13324071";
const HACJENDA_ID = "13416371";

beforeAll(() => {
  process.env.SADOLES_BOOKING_ID = SADOLES_ID;
  process.env.HACJENDA_BOOKING_ID = HACJENDA_ID;
});

afterAll(() => {
  delete process.env.SADOLES_BOOKING_ID;
  delete process.env.HACJENDA_BOOKING_ID;
});

/** A Booking.com payout as Nestbank reports it. */
function payout(amount: number, propertyId = HACJENDA_ID, day = "2026-09-09"): ParsedBankData {
  return {
    amount,
    currency: "PLN",
    senderName: "BOOKING.COM B.V",
    transferTitle: `NO.0BW2CPZM38GEV9Z9/${propertyId}.`,
    transferDate: new Date(`${day}T12:00:00Z`),
    accountNumber: "11187010452078106769980001",
  };
}

/** A Booking.com stay the portal still owes for, dated by its checkout. */
function stay(
  spec: { id: number; hostRevenue: string; checkOut: string } & Partial<Omit<CandidateBooking, "checkIn" | "checkOut">>
): CandidateBooking {
  const { checkOut, ...rest } = spec;
  return {
    guestName: `Guest ${spec.id}`,
    companyName: null,
    channel: "booking",
    property: "Hacjenda",
    totalPrice: "0.00",
    amountPaid: "0.00",
    commission: "0.00",
    reservationFee: "0.00",
    depositAmount: "500.00",
    icalUid: null,
    icalSummary: null,
    status: "portal_paid",
    matchedTransferCount: 0,
    ...rest,
    checkIn: new Date(`${checkOut}T16:00:00Z`),
    checkOut: new Date(`${checkOut}T10:00:00Z`),
  } as CandidateBooking;
}

/** Bookings #85 and #91, as they stood when the payout landed. */
const stanek = stay({ id: 85, guestName: "Aleksandra Stanek", hostRevenue: "1797.40", checkOut: "2026-09-03" });
const bartczak = stay({ id: 91, guestName: "Martyna Bartczak", hostRevenue: "1964.60", checkOut: "2026-09-06" });

describe("payoutProperty", () => {
  it("reads the property off the payout reference", () => {
    expect(payoutProperty(payout(3762, HACJENDA_ID))).toBe("Hacjenda");
    expect(payoutProperty(payout(3762, SADOLES_ID))).toBe("Sadoles");
  });

  it("ignores digits in the reference in front of the slash", () => {
    // The reference is alphanumeric and can hold a run of digits of its own;
    // reading the first one in the title would resolve to the wrong property.
    const transfer = { ...payout(3762), transferTitle: `NO.13324071ABCDEFGH/${HACJENDA_ID}.` };
    expect(payoutProperty(transfer)).toBe("Hacjenda");
  });

  it("is null for an unknown ID and for a guest transfer", () => {
    expect(payoutProperty(payout(3762, "99999999"))).toBeNull();
    expect(payoutProperty({ ...payout(500), transferTitle: "Kaucja za pobyt" })).toBeNull();
  });
});

describe("MatchingEngine.findCombinedPayout", () => {
  it("finds the two stays the 2026-09-09 payout was made of", () => {
    const result = MatchingEngine.findCombinedPayout(payout(3762), [stanek, bartczak]);

    expect(result).not.toBeNull();
    expect(result!.allocations.map(a => a.bookingId)).toEqual([85, 91]);
    expect(result!.allocations.map(a => a.amount)).toEqual([1797.4, 1964.6]);
    expect(result!.allocations.reduce((s, a) => s + a.amount, 0)).toBeCloseTo(3762, 2);
    expect(result!.reasons[0]).toContain("1797.40 + 1964.60 = 3762.00");
  });

  it("says nothing when one booking accounts for the payout on its own", () => {
    // Every payout before 2026-09-09 looked like this. A batch is what is left
    // when the ordinary explanation fails, so the search must not run at all
    // while one is available — even though 1797.40 + 1964.60 is still there.
    const whole = stay({ id: 200, hostRevenue: "3762.00", checkOut: "2026-09-04" });
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, bartczak, whole])).toBeNull();
  });

  it("refuses to guess when the total can be reached two ways", () => {
    const other = stay({ id: 92, hostRevenue: "1797.40", checkOut: "2026-09-02" });
    // #85+#91 and #92+#91 both come to 3762.00.
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, bartczak, other])).toBeNull();
  });

  it("ignores stays whose own payout is not due anywhere near this one", () => {
    const distant = stay({ id: 300, hostRevenue: "1964.60", checkOut: "2026-06-06" });
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, distant])).toBeNull();
  });

  it("ignores the other property's stays even when they add up", () => {
    const sadoles = stay({ id: 301, hostRevenue: "1964.60", checkOut: "2026-09-06", property: "Sadoles" });
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, sadoles])).toBeNull();
  });

  it("ignores a stay the portal has already paid for", () => {
    const settled = { ...bartczak, amountPaid: "1964.60", status: "paid", matchedTransferCount: 1 };
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, settled])).toBeNull();
  });

  it("still considers a stay marked paid by hand with no transfer behind it", () => {
    // The balance is a claim, not money — the same reasoning that sends a
    // single payout to such a booking applies to a share of a combined one.
    const claimed = { ...bartczak, amountPaid: "1964.60", matchedTransferCount: 0 };
    const result = MatchingEngine.findCombinedPayout(payout(3762), [stanek, claimed]);
    expect(result!.allocations.map(a => a.bookingId)).toEqual([85, 91]);
  });

  it("requires the parts to add up to the grosz", () => {
    const short = stay({ id: 302, hostRevenue: "1960.00", checkOut: "2026-09-06" });
    // 1797.40 + 1960.00 = 3757.40, within 0.2% — close enough for a single
    // payout's 1% slack, and deliberately not close enough for a batch.
    expect(MatchingEngine.findCombinedPayout(payout(3762), [stanek, short])).toBeNull();
  });

  it("says nothing about a guest's own transfer", () => {
    const guest: ParsedBankData = {
      amount: 3762, currency: "PLN", senderName: "JAN KOWALSKI",
      transferTitle: "Zaplata za pobyt", transferDate: new Date("2026-09-09T12:00:00Z"),
      accountNumber: "11187010452078106769980001",
    };
    expect(MatchingEngine.findCombinedPayout(guest, [stanek, bartczak])).toBeNull();
  });
});

describe("MatchingEngine.scoreCandidates with a payout reference", () => {
  it("drops the other property's stays instead of ranking them", () => {
    // What went wrong on the real transfer: the five bookings offered for the
    // Hacjenda payout were all Sadoles stays that happened to cost about the
    // same, and neither stay it was actually made of appeared at all.
    const sadoles = stay({ id: 13, hostRevenue: "3286.63", totalPrice: "3762.00", checkOut: "2026-06-18", property: "Sadoles" });
    const results = MatchingEngine.scoreCandidates(payout(3762), [sadoles, stanek, bartczak], true);

    expect(results.map(r => r.bookingId)).not.toContain(13);
  });
});
