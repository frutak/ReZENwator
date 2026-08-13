import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyTransferSource } from "../repositories/BankTransferRepository";

/**
 * Two records of the same money, and what happens when they disagree.
 *
 * `bookings.amountPaid` and the transfers matched to that booking are written by
 * different paths and never compared. The April 2026 incident lived in that gap
 * for four months: a kaucja applied twice to a booking that only ever had one
 * transfer behind it, found by reading the mail archive by hand.
 *
 * The `source` column is the other half — it records who sent each payment
 * instead of leaving the guest/portal split to be inferred from the booking's
 * status.
 */

describe("classifyTransferSource", () => {
  const t = (senderName: string, transferTitle = "") => ({ senderName, transferTitle });

  it("recognises each portal from how its payout actually arrives", () => {
    // Every one of these is a real sender from the bank statements.
    expect(classifyTransferSource(t("SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"))).toBe("portal");
    expect(classifyTransferSource(t("BOOKING.COM B.V"))).toBe("portal");
    expect(classifyTransferSource(t("Airbnb 888 Brannan St. 94103 San Fr"))).toBe("portal");
    // Airbnb pays through Payoneer as often as under its own name.
    expect(classifyTransferSource(t("PAYONEER EUROPE LIMITED", "/OPF/IN/4366185569829246/Airbnb Payments"))).toBe("portal");
    expect(classifyTransferSource(t("ALOHACAMP SP. Z O.O.", "Wypłata 202608952357"))).toBe("portal");
  });

  it("treats anyone else as the guest, including a companion paying for them", () => {
    expect(classifyTransferSource(t("DANIŁOWSKA ANNA", "Hacjenda 24.04."))).toBe("guest");
    // Booking #172: the balance came from a fellow traveller, not from Maria.
    expect(classifyTransferSource(t("Oleksandr Kotov", "/ref/281475545653695/Hacjenda Kiekrz 23.08."))).toBe("guest");
    expect(classifyTransferSource(t("MACIEJ K DOWNAR-DUKOWICZ OS. JANA III SOBI"))).toBe("guest");
  });

  it("reads the title too, since the bank sometimes names the portal only there", () => {
    expect(classifyTransferSource(t("NEST BANK", "Slowhop przedpłaty id: 1345090"))).toBe("portal");
  });
});

/**
 * The reconciliation arithmetic, kept honest against the real shapes it has to
 * survive. The query itself lives in SQL; this pins the rule it implements.
 */
describe("reconciliation arithmetic", () => {
  const expected = (transfersTotal: number, depositReturned: number) => transfersTotal - depositReturned;
  const discrepancy = (amountPaid: number, transfersTotal: number, depositReturned = 0) =>
    +(amountPaid - expected(transfersTotal, depositReturned)).toFixed(2);

  it("passes a booking whose transfers add up", () => {
    // #172 Maria Satsiuk: 161.70 forward + 980 balance, kaucja never collected.
    expect(discrepancy(1141.7, 1141.7)).toBe(0);
  });

  it("passes a booking whose kaucja was returned", () => {
    // The return subtracts 500 from amountPaid, so the expectation drops too.
    expect(discrepancy(2046.9, 2546.9, 500)).toBe(0);
  });

  it("catches the April incident's shape", () => {
    // A 500 zł kaucja applied twice against a single transfer.
    expect(discrepancy(2546.9, 2046.9)).toBe(500);
  });

  it("catches money recorded but never applied", () => {
    // #76: two Airbnb payouts of 1352 matched to the booking, one on the balance.
    expect(discrepancy(1352, 2704)).toBe(-1352);
  });
});
