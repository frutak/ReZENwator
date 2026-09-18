import { describe, it, expect } from "vitest";
import { nightKind, planFor } from "../services/pricingCalendar";

const night = (iso: string) => new Date(`${iso}T00:00:00Z`);
const kind = (iso: string) => nightKind(night(iso));

describe("nightKind — the premium belongs to the eve of a day off", () => {
  it("prices Friday and Saturday nights as weekend, Sunday night as weekday", () => {
    expect(kind("2027-01-15")).toBe("weekend"); // Fri
    expect(kind("2027-01-16")).toBe("weekend"); // Sat
    expect(kind("2027-01-17")).toBe("weekday"); // Sun → Monday at work
    expect(kind("2027-01-18")).toBe("weekday"); // Mon
  });

  it("moves a midweek holiday's premium to the night before it", () => {
    // 11 Nov 2026 is a Wednesday.
    expect(kind("2026-11-10")).toBe("weekend");
    expect(kind("2026-11-11")).toBe("weekday");
    // 6 Jan 2027 is a Wednesday.
    expect(kind("2027-01-05")).toBe("weekend");
    expect(kind("2027-01-06")).toBe("weekday");
  });

  it("does not charge a weekend rate for a Sunday holiday's own night", () => {
    // 1 Nov 2026 is a Sunday; Monday is a working day.
    expect(kind("2026-10-31")).toBe("weekend");
    expect(kind("2026-11-01")).toBe("weekday");
    // 1 Nov 2027 is a Monday: Sunday night is its eve.
    expect(kind("2027-10-31")).toBe("weekend");
    expect(kind("2027-11-01")).toBe("weekday");
  });

  it("treats the night before Christmas Eve as a weekend night (a day off since 2025)", () => {
    expect(kind("2026-12-23")).toBe("weekend");
  });

  it("puts Easter on Saturday and Sunday nights, not on Easter Monday night", () => {
    // Easter 2027: Sunday 28 March.
    expect(kind("2027-03-26")).toBe("weekend");
    expect(kind("2027-03-27")).toBe("special");
    expect(kind("2027-03-28")).toBe("special");
    expect(kind("2027-03-29")).toBe("weekday");
  });

  it("covers the May weekend from its eve and stops before the working day", () => {
    // 2027: 1 May Saturday, 3 May Monday.
    expect(kind("2027-04-29")).toBe("weekday");
    expect(kind("2027-04-30")).toBe("special");
    expect(kind("2027-05-01")).toBe("special");
    expect(kind("2027-05-02")).toBe("special");
    expect(kind("2027-05-03")).toBe("weekday");
    // 2028: 1 May Monday pulls in the weekend before it.
    expect(kind("2028-04-28")).toBe("special"); // Fri → Sat 29 Apr
    expect(kind("2028-05-02")).toBe("special"); // Tue → 3 May
    expect(kind("2028-05-03")).toBe("weekday");
  });

  it("starts Corpus Christi on Wednesday evening", () => {
    // Corpus Christi 2027: Thursday 27 May.
    expect(kind("2027-05-25")).toBe("weekday");
    expect(kind("2027-05-26")).toBe("special");
    expect(kind("2027-05-29")).toBe("special");
    expect(kind("2027-05-30")).toBe("weekday");
  });

  it("keeps Christmas on the 24th and 25th and New Year's Eve on its own plan", () => {
    expect(kind("2026-12-24")).toBe("special");
    expect(kind("2026-12-25")).toBe("special");
    expect(kind("2026-12-31")).toBe("newYear");
  });
});

describe("planFor", () => {
  it("maps kinds and seasons onto each property's plans", () => {
    expect(planFor("Hacjenda", night("2027-01-15"))).toBe("H3: Standard");
    expect(planFor("Hacjenda", night("2027-01-18"))).toBe("H1: Low Weekday");
    expect(planFor("Hacjenda", night("2027-07-16"))).toBe("H5: High Weekend");
    expect(planFor("Hacjenda", night("2027-07-19"))).toBe("H3: Standard");
    expect(planFor("Sadoles", night("2027-05-26"))).toBe("S7: Special Holiday");
    expect(planFor("Sadoles", night("2026-12-31"))).toBe("S8: New Year");
    expect(planFor("Sadoles", night("2027-06-11"))).toBe("S4: Mid Weekend");
  });
});
