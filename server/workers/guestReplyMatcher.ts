import type { Booking } from "../../drizzle/schema";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";

export type GuestReplyMatch =
  | { method: "email"; booking: Booking }
  | { method: "name"; booking: Booking }
  | { method: "ambiguous"; candidates: Booking[] }
  | { method: "none"; candidates: [] };

/** How far back a name match will look for a finished stay. */
const NAME_MATCH_PAST_DAYS = 60;

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
 * Pulls the display name out of a From header, when the sender set one.
 *
 * Returns null for a bare address: `jan.kowalski@example.com` is a mailbox, not
 * a name, and treating the local part as one would match far too eagerly.
 */
export function extractDisplayName(from: string): string | null {
  if (!from) return null;

  const angled = from.match(/^(.*)<[^>]+>\s*$/);
  if (!angled) return null;

  const name = angled[1].trim().replace(/^["']|["']$/g, "").trim();
  return name.length > 0 && !name.includes("@") ? name : null;
}

/**
 * Reduces a name to comparable tokens: lowercase, no diacritics, no punctuation.
 *
 * "Gibalska, Maja" and "maja gibalska" are the same person written two ways, and
 * a guest who booked as "Maja Gibalska" may well write from a mailbox whose
 * display name is "MAJA GIBALSKA".
 */
export function nameTokens(name: string): string[] {
  return name
    // NFD splits accents off their letter, but a slashed L is a letter in its
    // own right and survives it, so Polish names need it spelled out.
    .replace(/\u0142/g, "l")
    .replace(/\u0141/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Whether two names identify the same person.
 *
 * Deliberately strict — same token set, at least two tokens. A single-token
 * match ("Maja") would pull in every other Maja, and a name match is already the
 * weaker signal: it exists because portals hand the guest an alias address, so
 * their real mailbox never appears on the booking.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return ta.slice().sort().join(" ") === tb.slice().sort().join(" ");
}

/**
 * Picks the stay a guest with these bookings is most plausibly writing about.
 *
 * A returning guest has several bookings, so identity alone does not identify a
 * stay. This ladder refuses to guess when two are equally plausible:
 *
 *   1. A stay in progress — they are on site, nothing else competes.
 *   2. Exactly one future stay — the ordinary pre-arrival question.
 *   3. Several future stays — `ambiguous`. This is the case worth stopping for:
 *      answering the wrong one quotes the wrong dates, price and balance.
 *   4. Only past stays — the most recent, which is what "I left a charger"
 *      refers to.
 */
function pickBooking(
  candidates: Booking[],
  now: Date,
  method: "email" | "name"
): GuestReplyMatch {
  if (candidates.length === 0) return { method: "none", candidates: [] };

  const active = candidates.filter(
    (b) => new Date(b.checkIn) <= now && now <= new Date(b.checkOut)
  );
  if (active.length === 1) return { method, booking: active[0] };
  // Two overlapping stays for one guest means the data is wrong, not that the
  // email is unanswerable — but it still needs a human to look.
  if (active.length > 1) return { method: "ambiguous", candidates: active };

  const upcoming = candidates.filter((b) => new Date(b.checkIn) > now);
  if (upcoming.length === 1) return { method, booking: upcoming[0] };
  if (upcoming.length > 1) return { method: "ambiguous", candidates: upcoming };

  const past = [...candidates].sort(
    (a, b) => new Date(b.checkOut).getTime() - new Date(a.checkOut).getTime()
  );
  if (past.length > 0) return { method, booking: past[0] };

  return { method: "none", candidates: [] };
}

/**
 * Resolves which booking an inbound guest email belongs to.
 *
 * The sender's address is tried first, because it is the only signal that is
 * unique. When it belongs to no booking, the sender's display name is tried
 * against recent and upcoming guests — a portal booking carries an alias address
 * (`maja.gibalska@allegro.com`) that the guest never writes from, so their real
 * mail would otherwise look like a stranger's and be dropped.
 *
 * A name match is weaker by construction and the caller is expected to treat it
 * as needing the owner's eyes; it decides which facts a draft is grounded in,
 * not whether anything is sent.
 *
 * Cancelled bookings, blocks and internal bookings are excluded by the
 * repository queries.
 */
export async function matchBookingForEmail(
  address: string,
  now = new Date(),
  displayName?: string | null
): Promise<GuestReplyMatch> {
  const byEmail = await GuestReplyRepository.findBookingsByGuestEmail(address);
  if (byEmail.length > 0) return pickBooking(byEmail, now, "email");

  if (!displayName || nameTokens(displayName).length < 2) {
    return { method: "none", candidates: [] };
  }

  const since = new Date(now.getTime() - NAME_MATCH_PAST_DAYS * 24 * 60 * 60 * 1000);
  const recent = await GuestReplyRepository.findBookingsWithGuestNameSince(since);
  const byName = recent.filter((b) => b.guestName && namesMatch(b.guestName, displayName));
  if (byName.length === 0) return { method: "none", candidates: [] };

  return pickBooking(byName, now, "name");
}
