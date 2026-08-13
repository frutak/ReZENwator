import { setHours, setMinutes } from "date-fns";

/**
 * Standardizes check-in and check-out times if they are set exactly at midnight.
 * Check-in defaults to 16:00.
 * Check-out defaults to 10:00.
 */
export function normalizeBookingDates(checkIn: Date, checkOut: Date) {
  let normalizedCheckIn = checkIn;
  let normalizedCheckOut = checkOut;

  if (checkIn.getHours() === 0 && checkIn.getMinutes() === 0) {
    normalizedCheckIn = setMinutes(setHours(checkIn, 16), 0);
  }
  if (checkOut.getHours() === 0 && checkOut.getMinutes() === 0) {
    normalizedCheckOut = setMinutes(setHours(checkOut, 10), 0);
  }

  return { checkIn: normalizedCheckIn, checkOut: normalizedCheckOut };
}

/**
 * Calculates the total guest count by combining adults and children if available,
 * otherwise falling back to the raw guest count.
 */
export function calculateTotalGuests(
  guestCount?: number,
  adultsCount?: number,
  childrenCount?: number
): number {
  const adults = adultsCount ?? 0;
  const children = childrenCount ?? 0;
  const calculatedTotal = adults + children;
  
  if (calculatedTotal > 0) {
    return calculatedTotal;
  }
  
  return guestCount ?? 1;
}

/**
 * Normalizes decimal fields in booking details, converting empty strings to null.
 */
export function normalizeDecimalFields<T extends Record<string, any>>(details: T): T {
  const normalized = { ...details };
  const decimalFields = ['totalPrice', 'commission', 'hostRevenue', 'amountPaid', 'depositAmount'];
  
  for (const field of decimalFields) {
    if (normalized[field] === "") {
      (normalized as any)[field] = null;
    }
  }
  
  return normalized;
}

/** The shape every "what is still owed" question is answered from. */
export interface BookingAmounts {
  channel: string;
  status?: string | null;
  totalPrice: string | number | null;
  hostRevenue: string | number | null;
  amountPaid: string | number | null;
  reservationFee?: string | number | null;
  depositAmount?: string | number | null;
  depositStatus?: string | null;
}

/**
 * What is still owed on a booking, split by who owes it.
 *
 * One number cannot answer both questions the app asks. "How much is still to
 * reach the account" and "how much should we ask the guest for" differ whenever
 * a portal's forward is in flight: on Alohacamp #181 the account is waiting for
 * 2701.85 while the guest owes 2525, because 176.85 is Alohacamp's to send. Ask
 * the guest for the account figure and the mail overcharges them.
 *
 * The kaucja enters in two distinct roles, and conflating them is what made the
 * old boolean flag wrong: while `pending` it is a debt still to be collected;
 * once `paid` it is money sitting inside `amountPaid`, which has to be added
 * back before comparing against `hostRevenue` — otherwise a received kaucja
 * silently nets off an outstanding payout. Both roles are named here, so the
 * answer no longer depends on whether the kaucja has landed.
 */
export interface AmountsDue {
  /** The guest's own share of the stay, still to be transferred to the owner. */
  guestStayDue: number;
  /** The portal's forward (or payout), still to arrive. */
  portalDue: number;
  /** The kaucja, if it is still to be collected. */
  depositDue: number;
  /** guestStayDue + portalDue — everything still owed for the stay itself. */
  stayDue: number;
  /** stayDue + depositDue — what the account is still waiting for. */
  accountDue: number;
  /** guestStayDue + depositDue — what to ask the guest for. */
  guestDue: number;
}

export function calculateAmountsDue(booking: BookingAmounts): AmountsDue {
  const totalPrice = parseFloat(String(booking.totalPrice || "0"));
  const hostRevenue = parseFloat(String(booking.hostRevenue || "0"));
  const amountPaid = parseFloat(String(booking.amountPaid || "0"));
  const reservationFee = parseFloat(String(booking.reservationFee || "0"));
  const depositAmount = parseFloat(String(booking.depositAmount || "500.00"));

  // What we expect to receive in total is hostRevenue where it is known,
  // otherwise totalPrice — direct bookings, where the two are the same.
  const baseAmount = hostRevenue > 0 ? hostRevenue : totalPrice;

  const depositHeld = booking.depositStatus === "paid" ? depositAmount : 0;
  const depositDue = booking.depositStatus === "pending" ? depositAmount : 0;

  const stayDue = Math.max(0, baseAmount + depositHeld - amountPaid);

  // Slowhop and Alohacamp settle in two steps, so part of what is still due may
  // be the portal's, not the guest's. Airbnb and Booking.com collect the whole
  // stay themselves — their guest owes the owner nothing.
  const twoStepPortal =
    (booking.channel === "slowhop" || booking.channel === "alohacamp") && reservationFee > 0;
  const guestSettlesWithPortal = booking.channel === "airbnb" || booking.channel === "booking";
  const staySettled = booking.status === "paid" || booking.status === "finished";

  // `amountPaid` is a single figure that does not record who paid it, so the
  // guest's share is read from what they were asked for and whether the booking
  // has been marked settled — which the matcher does exactly when their balance
  // lands. Tagging inflows by sender would make this exact rather than derived.
  const guestStayDue =
    staySettled || guestSettlesWithPortal
      ? 0
      : twoStepPortal
        ? Math.max(0, totalPrice - reservationFee)
        : stayDue;

  const portalDue = Math.max(0, stayDue - guestStayDue);

  return {
    guestStayDue,
    portalDue,
    depositDue,
    stayDue,
    accountDue: stayDue + depositDue,
    guestDue: guestStayDue + depositDue,
  };
}

/**
 * Balance due, in the older two-value form.
 *
 * `includeDeposit` picks between the two totals of {@link calculateAmountsDue}:
 * the stay alone, or the stay plus a kaucja still to collect. Prefer calling
 * `calculateAmountsDue` directly — a caller that means "what should the guest
 * pay" wants `guestDue`, which neither of these two answers.
 */
export function calculateBalanceDue(booking: BookingAmounts, includeDeposit = false): number {
  const due = calculateAmountsDue(booking);
  return includeDeposit ? due.accountDue : due.stayDue;
}
