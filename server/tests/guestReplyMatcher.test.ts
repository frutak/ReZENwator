import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractDisplayName,
  extractEmailAddress,
  matchBookingForEmail,
  namesMatch,
} from "../workers/guestReplyMatcher";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";

vi.mock("../repositories/GuestReplyRepository", () => ({
  GuestReplyRepository: {
    findBookingsByGuestEmail: vi.fn(),
    findBookingsWithGuestNameSince: vi.fn(),
  },
}));

const NOW = new Date("2026-07-29T12:00:00Z");

function booking(id: number, checkIn: string, checkOut: string, guestName?: string) {
  return { id, checkIn: new Date(checkIn), checkOut: new Date(checkOut), guestName } as any;
}

function withCandidates(...rows: any[]) {
  (GuestReplyRepository.findBookingsByGuestEmail as any).mockResolvedValue(rows);
  (GuestReplyRepository.findBookingsWithGuestNameSince as any).mockResolvedValue([]);
}

function withNameCandidates(...rows: any[]) {
  (GuestReplyRepository.findBookingsByGuestEmail as any).mockResolvedValue([]);
  (GuestReplyRepository.findBookingsWithGuestNameSince as any).mockResolvedValue(rows);
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

describe("extractDisplayName", () => {
  it("pulls a quoted display name", () => {
    expect(extractDisplayName('"Maja Gibalska" <maja@example.com>')).toBe("Maja Gibalska");
  });

  it("pulls an unquoted display name", () => {
    expect(extractDisplayName("Maja Gibalska <maja@example.com>")).toBe("Maja Gibalska");
  });

  it("reports none for a bare address", () => {
    expect(extractDisplayName("maja.gibalska@example.com")).toBeNull();
    expect(extractDisplayName("<maja@example.com>")).toBeNull();
  });
});

describe("namesMatch", () => {
  it("ignores case, order, punctuation and diacritics", () => {
    expect(namesMatch("Maja Gibalska", "maja gibalska")).toBe(true);
    expect(namesMatch("Gibalska, Maja", "Maja Gibalska")).toBe(true);
    expect(namesMatch("Łukasz Wójcik", "Lukasz Wojcik")).toBe(true);
  });

  it("refuses one-token names, which would match every namesake", () => {
    expect(namesMatch("Maja", "Maja Gibalska")).toBe(false);
    expect(namesMatch("Maja", "Maja")).toBe(false);
  });

  it("refuses a partial overlap", () => {
    expect(namesMatch("Maja Gibalska", "Maja Kowalska")).toBe(false);
    expect(namesMatch("Maja Gibalska", "Maja Anna Gibalska")).toBe(false);
  });
});

describe("matchBookingForEmail — name fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches a guest writing from a mailbox the booking never saw", async () => {
    // The Allegro case: booking carries the portal alias, guest writes from gmail.
    withNameCandidates(booking(72, "2026-08-21T12:00:00Z", "2026-08-23T06:00:00Z", "Maja Gibalska"));
    const match = await matchBookingForEmail("majagibalska@gmail.com", NOW, "Maja Gibalska");
    expect(match).toMatchObject({ method: "name", booking: { id: 72 } });
  });

  it("prefers the address when one matches, without consulting names", async () => {
    withCandidates(booking(7, "2026-08-10T14:00:00Z", "2026-08-17T10:00:00Z", "Jan Kowalski"));
    const match = await matchBookingForEmail("jan@example.com", NOW, "Someone Else");
    expect(match).toMatchObject({ method: "email", booking: { id: 7 } });
    expect(GuestReplyRepository.findBookingsWithGuestNameSince).not.toHaveBeenCalled();
  });

  it("reports none when the sender set no display name", async () => {
    withNameCandidates(booking(72, "2026-08-21T12:00:00Z", "2026-08-23T06:00:00Z", "Maja Gibalska"));
    const match = await matchBookingForEmail("majagibalska@gmail.com", NOW, null);
    expect(match.method).toBe("none");
  });

  it("reports none when no guest carries that name", async () => {
    withNameCandidates(booking(72, "2026-08-21T12:00:00Z", "2026-08-23T06:00:00Z", "Maja Gibalska"));
    const match = await matchBookingForEmail("stranger@example.com", NOW, "Anna Nowak");
    expect(match.method).toBe("none");
  });

  it("refuses to guess between two stays under the same name", async () => {
    withNameCandidates(
      booking(10, "2026-08-10T14:00:00Z", "2026-08-17T10:00:00Z", "Maja Gibalska"),
      booking(11, "2026-09-05T14:00:00Z", "2026-09-12T10:00:00Z", "Maja Gibalska")
    );
    const match = await matchBookingForEmail("majagibalska@gmail.com", NOW, "Maja Gibalska");
    expect(match.method).toBe("ambiguous");
  });
});
