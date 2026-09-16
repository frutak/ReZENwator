/**
 * Centralized business configuration for the ReZENwator.
 * Adding a new property or channel here will update types across the system.
 */

export const PROPERTIES = ["Sadoles", "Hacjenda"] as const;
export type Property = typeof PROPERTIES[number];

export const CHANNELS = ["slowhop", "airbnb", "booking", "alohacamp", "direct"] as const;
export type Channel = typeof CHANNELS[number];

export const STATUSES = ["pending", "confirmed", "portal_paid", "paid", "finished", "cancelled"] as const;
export type BookingStatus = typeof STATUSES[number];

export const DEPOSIT_STATUSES = ["pending", "paid", "returned", "not_applicable"] as const;
export type DepositStatus = typeof DEPOSIT_STATUSES[number];

export const CLEANING_STAFF = ["Ala", "Krysia"] as const;
export type CleaningStaff = typeof CLEANING_STAFF[number];

export const BOOKING_TYPES = ["normal", "block", "internal"] as const;
export type BookingType = typeof BOOKING_TYPES[number];

/**
 * Party size the price audit quotes for.
 *
 * A portal price only means something next to the number of guests it covers —
 * Booking prices an entire-place listing in occupancy tiers and lists them all at
 * once, so an audit that asks for one size and reads the price of another compares
 * nothing. This is the size the auditor puts in every portal URL and the size the
 * internal benchmark is calculated for; the two must not drift apart.
 */
export const AUDIT_OCCUPANCY: Record<Property, number> = {
  Sadoles: 11,
  Hacjenda: 4,
};

/**
 * Channels that hand over no guest address, so guest mail goes to the owner.
 *
 * Airbnb never discloses one. Alohacamp's confirmation carries a name and
 * nothing else reachable: the phone is withheld until the free-cancellation
 * window closes ("Numer telefonu Gościa będzie widoczny po zakończeniu
 * bezpłatnego okresu anulowania"), an address is never sent at all, and the mail
 * points the host at the portal's reservation chat instead. A blank `guestEmail`
 * on these channels is therefore normal rather than a data gap — the guest email
 * is addressed to the owner, who pastes it into the portal's messenger by hand.
 *
 * Contactability only. This says nothing about who collects the money:
 * Alohacamp settles in two steps and its guest still owes the owner the balance
 * after the zaliczka, while an Airbnb guest owes nothing — see
 * `calculateAmountsDue`, which keys that on its own channel list.
 */
export const CHANNELS_WITHOUT_GUEST_EMAIL = ["airbnb", "alohacamp"] as const satisfies readonly Channel[];

/** Is this channel's guest reachable only through the portal's own messenger? */
export function contactsGuestViaPortal(channel: string | null | undefined): boolean {
  return (CHANNELS_WITHOUT_GUEST_EMAIL as readonly string[]).includes(channel ?? "");
}

/**
 * A guest email we actually need but do not have. Blank on a portal-chat channel
 * does not count — see `CHANNELS_WITHOUT_GUEST_EMAIL`.
 */
export function isGuestEmailMissing(booking: { guestEmail?: string | null; channel: string }): boolean {
  return !booking.guestEmail && !contactsGuestViaPortal(booking.channel);
}
