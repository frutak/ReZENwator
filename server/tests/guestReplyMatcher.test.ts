import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractEmailAddress, matchBookingForEmail } from "../workers/guestReplyMatcher";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";

vi.mock("../repositories/GuestReplyRepository", () => ({
  GuestReplyRepository: {
    findBookingsByGuestEmail: vi.fn(),
  },
}));

const NOW = new Date("2026-07-29T12:00:00Z");

function booking(id: number, checkIn: string, checkOut: string) {
  return { id, checkIn: new Date(checkIn), checkOut: new Date(checkOut) } as any;
}

function withCandidates(...rows: any[]) {
  (GuestReplyRepository.findBookingsByGuestEmail as any).mockResolvedValue(rows);
}

describe("extractEmailAddress", () => {
  it("pulls the address out of a display-name header", () => {
    expect(extractEmailAddress('"Jan Kowalski" <Jan@Example.com>')).toBe("jan@example.com");
  });

  it("accepts a bare address", () => {
    expect(extractEmailAddress("  jan@example.com ")).toBe("jan@example.com");
  });

  it("rejects headers carrying no address", () => {
    expect(extractEmailAddress("Jan Kowalski")).toBeNull();
    expect(extractEmailAddress("")).toBeNull();
  });
});

describe("matchBookingForEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports none when the address belongs to no booking", async () => {
    withCandidates();
    const match = await matchBookingForEmail("stranger@example.com", NOW);
    expect(match.method).toBe("none");
  });

  it("matches the single booking behind an address", async () => {
    withCandidates(booking(7, "2026-08-10T14:00:00Z", "2026-08-17T10:00:00Z"));
    const match = await matchBookingForEmail("jan@example.com", NOW);
    expect(match).toMatchObject({ method: "email", booking: { id: 7 } });
  });

  it("prefers the stay in progress over an upcoming one", async () => {
    withCandidates(
      booking(1, "2026-07-27T14:00:00Z", "2026-08-02T10:00:00Z"), // guest is on site
      booking(2, "2026-09-01T14:00:00Z", "2026-09-08T10:00:00Z")
    );
    const match = await matchBookingForEmail("jan@example.com", NOW);
    expect(match).toMatchObject({ method: "email", booking: { id: 1 } });
  });

  it("refuses to guess between two upcoming stays", async () => {
    withCandidates(
      booking(3, "2026-08-10T14:00:00Z", "2026-08-17T10:00:00Z"),
      booking(4, "2026-09-05T14:00:00Z", "2026-09-12T10:00:00Z")
    );
    const match = await matchBookingForEmail("jan@example.com", NOW);
    expect(match.method).toBe("ambiguous");
    if (match.method === "ambiguous") expect(match.candidates).toHaveLength(2);
  });

  it("falls back to the most recent past stay when nothing is upcoming", async () => {
    withCandidates(
      booking(5, "2025-06-01T14:00:00Z", "2025-06-08T10:00:00Z"),
      booking(6, "2026-07-01T14:00:00Z", "2026-07-08T10:00:00Z") // most recent checkout
    );
    const match = await matchBookingForEmail("jan@example.com", NOW);
    expect(match).toMatchObject({ method: "email", booking: { id: 6 } });
  });

  it("flags overlapping active stays rather than picking one", async () => {
    withCandidates(
      booking(8, "2026-07-27T14:00:00Z", "2026-08-02T10:00:00Z"),
      booking(9, "2026-07-28T14:00:00Z", "2026-08-03T10:00:00Z")
    );
    const match = await matchBookingForEmail("jan@example.com", NOW);
    expect(match.method).toBe("ambiguous");
  });
});
