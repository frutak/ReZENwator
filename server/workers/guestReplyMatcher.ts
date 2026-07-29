import type { Booking } from "../../drizzle/schema";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";

export type GuestReplyMatch =
  | { method: "email"; booking: Booking }
  | { method: "ambiguous"; candidates: Booking[] }
  | { method: "none"; candidates: [] };

/**
 * Pulls the bare address out of a From header.
 *
 * `mailparser` hands us the rendered form, which is usually
 * `"Jan Kowalski" <jan@example.com>` but is a bare address when the sender set
 * no display name.
 */
export function extractEmailAddress(from: string): string | null {
  if (!from) return null;

  const angled = from.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : from).trim().toLowerCase();

  // Good enough to reject display-name-only or malformed headers; real
  // validation is the database lookup that follows.
  if (!candidate.includes("@") || /\s/.test(candidate)) return null;
  return candidate;
}

/**
 * Resolves which booking an inbound guest email belongs to, by sender address.
 *
 * A returning guest has several bookings under one address, so an address alone
 * does not identify a stay. The ladder below picks the stay the guest is most
 * plausibly writing about, and refuses to guess when two are equally plausible:
 *
 *   1. A stay in progress — they are on site, nothing else competes.
 *   2. Exactly one future stay — the ordinary pre-arrival question.
 *   3. Several future stays — `ambiguous`. This is the case worth stopping for:
 *      answering the wrong one quotes the wrong dates, price and balance.
 *   4. Only past stays — the most recent, which is what "I left a charger"
 *      refers to.
 *
 * Cancelled bookings, blocks and internal bookings are already excluded by the
 * repository query.
 */
export async function matchBookingForEmail(address: string, now = new Date()): Promise<GuestReplyMatch> {
  const candidates = await GuestReplyRepository.findBookingsByGuestEmail(address);
  if (candidates.length === 0) return { method: "none", candidates: [] };

  const active = candidates.filter(
    (b) => new Date(b.checkIn) <= now && now <= new Date(b.checkOut)
  );
  if (active.length === 1) return { method: "email", booking: active[0] };
  // Two overlapping stays for one guest means the data is wrong, not that the
  // email is unanswerable — but it still needs a human to look.
  if (active.length > 1) return { method: "ambiguous", candidates: active };

  const upcoming = candidates.filter((b) => new Date(b.checkIn) > now);
  if (upcoming.length === 1) return { method: "email", booking: upcoming[0] };
  if (upcoming.length > 1) return { method: "ambiguous", candidates: upcoming };

  const past = [...candidates].sort(
    (a, b) => new Date(b.checkOut).getTime() - new Date(a.checkOut).getTime()
  );
  if (past.length > 0) return { method: "email", booking: past[0] };

  return { method: "none", candidates: [] };
}
