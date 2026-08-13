import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEmail, type ParsedBankData, type ParsedBookingData } from "../workers/emailParsers";
import { applyTransferMatch, revertTransferMatch } from "../workers/bookingMatcher";
import { MatchingEngine, type CandidateBooking } from "../services/MatchingEngine";
import { BookingRepository } from "../repositories/BookingRepository";
import { initialStatus, initialDepositStatus } from "../workers/icalPoller";
import { sendAlertEmail } from "../_core/email";
import { calculateBalanceDue } from "@shared/utils";

/**
 * Portal settlement end to end: confirmation mail → new booking → the money.
 *
 * Slowhop and Alohacamp settle a stay the same way, in two steps. The portal
 * keeps its whole commission (net + 23% VAT) out of the guest's zaliczka and
 * forwards what is left to the owner's account; the guest then pays the rest of
 * the stay — and the kaucja, which the portal never touches — to the owner
 * directly. So the owner sees up to three inflows per booking:
 *
 *   1. the portal's forward:  zaliczka − commission
 *   2. the guest's balance:   totalPrice − zaliczka
 *   3. the kaucja             (sometimes arriving together with 2)
 *
 * Each case below replays a real booking. Its real confirmation mail is parsed
 * the way the poller parses it, a booking row is built from that parse exactly
 * as `emailPoller.handleBookingConfirmation` inserts one, and then the transfers
 * that booking actually received are applied in the order they arrived. Nothing
 * touches a database: the repository is mocked and the row is kept in memory so
 * the inflows accumulate on it, as they would across successive polls.
 *
 * What these guard against is the accounting bug fixed in "count only money that
 * reached the account as paid": the S1/AL1 parsers used to write the portal
 * prepayment into `amountPaid`, so the zaliczka was counted once from the
 * confirmation mail and a second time when the portal's forward of that same
 * zaliczka was matched to a bank transfer. `amountPaid` means one thing only —
 * money that reached the owner's account — and every assertion below is written
 * in those terms.
 */

// No DB configured → applyTransferMatch takes its non-transactional path and
// writes through updateBookingPayment, which the in-memory ledger below records.
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    getBookingById: vi.fn(),
    updateBookingPayment: vi.fn(),
  },
}));
vi.mock("../repositories/BankTransferRepository", () => ({
  BankTransferRepository: { updateTransferStatus: vi.fn(), updateTransferStatusByExternalId: vi.fn() },
}));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../_core/email", () => ({ sendAlertEmail: vi.fn() }));

/** The score emailPoller requires before applying a match unattended. */
const AUTO_MATCH_THRESHOLD = 80;

const money = (n: number | undefined) => (n != null ? n.toFixed(2) : null);

type LedgerRow = CandidateBooking & Record<string, any>;

/**
 * The booking row a confirmation mail creates, mirroring the insert in
 * `emailPoller.handleBookingConfirmation`. Decimals are rendered the way MySQL
 * hands them back, so the assertions compare against real stored shapes.
 */
function bookingFromConfirmation(id: number, data: ParsedBookingData): LedgerRow {
  const settledInFull = data.channel !== "slowhop" && data.settledWithPortalInFull === true;

  return {
    id,
    channel: data.channel,
    property: data.property ?? "Sadoles",
    checkIn: data.checkIn!,
    checkOut: data.checkOut!,
    status: settledInFull ? "portal_paid" : initialStatus(data.channel as any),
    depositStatus: initialDepositStatus(data.channel as any),
    guestName: data.guestName ?? null,
    companyName: null,
    icalUid: `email-${data.channel}-${id}`,
    icalSummary: data.bookingId ? `Reservation no ${data.bookingId} (from email)` : null,
    totalPrice: money(data.totalPrice),
    commission: money(data.commission),
    hostRevenue: money(data.hostRevenue),
    // The insert hardcodes "0.00" — a confirmation mail never reports money
    // reaching the owner's account. Reading it from the parse instead keeps that
    // guarantee under test: a parser that ever again reports a portal prepayment
    // as received lands in these ledgers and fails the flow, rather than being
    // masked by a hardcoded zero here.
    amountPaid: money(data.amountPaid) ?? "0.00",
    reservationFee: money(data.reservationFee),
    depositAmount: "500.00", // schema default; the kaucja is the same on both houses
    animalsCount: data.animalsCount ?? null,
  };
}

/**
 * Enrichment from the S2 accounting mail, mirroring
 * `emailPoller.handleSlowhopS2`. It states the commission Slowhop actually
 * charged and the forward it is sending — but announces no money that has
 * arrived, so it must not move `amountPaid`.
 */
function applyAccountingMail(row: LedgerRow, data: ParsedBookingData): LedgerRow {
  row.status = "confirmed";
  row.commission = money(data.commission) ?? row.commission;
  row.hostRevenue = money(data.hostRevenue) ?? row.hostRevenue;
  row.reservationFee = money(data.reservationFee) ?? row.reservationFee;
  return row;
}

/** Keeps the booking in memory so successive transfers accumulate on it. */
function track(row: LedgerRow): LedgerRow {
  (BookingRepository.getBookingById as any).mockImplementation(async () => row);
  (BookingRepository.updateBookingPayment as any).mockImplementation(async (_id: number, update: any) => {
    Object.assign(row, update);
  });
  return row;
}

/** What `findMatchingBookings` would score this transfer against this booking. */
function scoreFor(transfer: ParsedBankData, row: LedgerRow): number {
  // `false`: neither portal pays out the way Airbnb/Booking.com do, so these
  // transfers are scored on the direct-transfer path.
  const [best] = MatchingEngine.scoreCandidates(transfer, [row as CandidateBooking], false);
  return best?.score ?? 0;
}

/** Score the transfer and apply it, exactly as an unattended poll would. */
async function autoMatch(row: LedgerRow, transfer: ParsedBankData): Promise<number> {
  const score = scoreFor(transfer, row);
  expect(score).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  await applyTransferMatch(row.id, transfer, score);
  return score;
}

const parsed = (from: string, subject: string, body: string): ParsedBookingData => {
  const result = parseEmail(from, subject, body);
  if (!result) throw new Error(`Email did not qualify: ${subject}`);
  return result.data as ParsedBookingData;
};

const OWNER = '"Szymon Furtak" <szymonfurtak@hotmail.com>';

// ─── Case 1: Maria Satsiuk, booking #172 ──────────────────────────────────────
// Hacjenda, 23–24.08.2026, Slowhop reservation 1345090. The first booking to run
// through the corrected accounting: the forward landed on 21.07, the guest's
// balance on 11.08, and its live row reads amountPaid 1141.70 today. The stay is
// still ahead, so the kaucja — the third inflow — is projected rather than real.

const SATSIUK_S1_SUBJECT =
  "FW: Rezerwacja nr 1345090 w dniach 23-08-2026 - 24-08-2026 dla Maria Satsiuk została potwierdzona i opłacona";

const SATSIUK_S1_BODY = `
________________________________
From: Slowhop <rezerwacje@slowhop.com>
Sent: Monday, July 20, 2026 7:23:54 PM (UTC+01:00) Brussels, Copenhagen, Madrid, Paris
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Rezerwacja nr 1345090 w dniach 23-08-2026 - 24-08-2026 dla Maria Satsiuk została potwierdzona i opłacona

Rezerwacja od: Maria Satsiuk została potwierdzona

Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 48696783302
Adres e-mail: maria.satsiuk@gmail.com
Rezerwacja nr 1345090:
Gdzie
Hacjenda Kiekrz Hacjenda na wyłączność
Kiedy
23-08-2026 - 24-08-2026
Z kim
5  dorosłych + 0 dzieci + 0 zwierząt

Cena całkowita: 1400 pln
Wysokość opłaconej przedpłaty: 420 pln
Pozostała kwota do zapłaty: 980 pln

Dodatkowe informacje dla Gości:
The whole house without food

Pozdrawiamy :)
Zespół Slowhopa
`;

const SATSIUK_S2_SUBJECT = "FW: Przelew przedpłaty za rezerwacje id 1345090 na Slowhop";

const SATSIUK_S2_BODY = `
________________________________
From: Slowhop <hop@slowhop.com>
Sent: Wednesday, July 22, 2026 11:04:43 AM (UTC+01:00) Brussels, Copenhagen, Madrid, Paris
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Przelew przedpłaty za rezerwacje id 1345090 na Slowhop

Przelaliśmy przedpłatę za rezerwację nr 1345090 od Maria Satsiuk na Twoje konto


Numer rezerwacji        Cena pobytu     Przedpłata      Prowizja
Slowhop netto   Przelew na
Wasze konto
1345090 (Maria Satsiuk, 23-08-2026 - 24-08-2026)        1400 zł 420 zł  210 zł  161.7 zł


Zbiorczą fakturę za prowizje Slowhopa prześlemy na koniec miesiąca.

Pozdrawiamy :)
Zespół Slowhopa
`;

/** The portal's forward, as it landed on 21.07.2026. */
const satsiukForward: ParsedBankData = {
  amount: 161.7,
  currency: "PLN",
  senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  transferTitle: "Slowhop przedpłaty id: 1345090 (Mar ia Satsiuk ).",
  transferDate: new Date("2026-07-21"),
  accountNumber: "11187010452078106769980001",
};

/** The balance, paid on 11.08.2026 — by a travelling companion, not the guest. */
const satsiukBalance: ParsedBankData = {
  amount: 980,
  currency: "PLN",
  senderName: "Oleksandr Kotov",
  transferTitle: "/ref/281475545653695/Hacjenda Kiekrz 23.08.",
  transferDate: new Date("2026-08-11"),
  accountNumber: "11187010452078106769980001",
};

/** Projected: the kaucja, collected before the 23.08 arrival. */
const satsiukDeposit: ParsedBankData = {
  amount: 500,
  currency: "PLN",
  senderName: "MARIA SATSIUK",
  transferTitle: "Kaucja Hacjenda 23.08",
  transferDate: new Date("2026-08-20"),
  accountNumber: "11187010452078106769980001",
};

// ─── Case 2: Agata Jalosinska, booking #62 ────────────────────────────────────
// Sadoleś, 10–12.04.2026, Slowhop reservation 1249415. All three inflows arrived
// separately, and the portal's forward came last — after the guest had already
// settled everything.

const JALOSINSKA_S1_SUBJECT =
  "FW: Rezerwacja nr 1249415 w dniach 10-04-2026 - 12-04-2026 dla Agata Jalosinska została potwierdzona i opłacona";

const JALOSINSKA_S1_BODY = `
________________________________
From: Slowhop <rezerwacje@slowhop.com>
Sent: Friday, April 3, 2026 2:18:13 PM (UTC+01:00) Brussels, Copenhagen, Madrid, Paris
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Rezerwacja nr 1249415 w dniach 10-04-2026 - 12-04-2026 dla Agata Jalosinska została potwierdzona i opłacona

Rezerwacja od: Agata Jalosinska została potwierdzona

Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 48608516872
Adres e-mail: wlocze53podbrodki@icloud.com
Rezerwacja nr 1249415:
Gdzie
Sadoleś 66 dom na wyłączność
Kiedy
10-04-2026 - 12-04-2026
Z kim
15  dorosłych + 0 dzieci + 0 zwierząt

Cena całkowita: 2510 pln
Wysokość opłaconej przedpłaty: 753 pln
Pozostała kwota do zapłaty: 1757 pln

Pozdrawiamy :)
Zespół Slowhopa
`;

const JALOSINSKA_S2_SUBJECT = "FW: Przelew przedpłaty za rezerwacje id 1249415 na Slowhop";

const JALOSINSKA_S2_BODY = `
________________________________
From: Slowhop <hop@slowhop.com>
Sent: Wednesday, April 8, 2026 1:48:23 PM (UTC+01:00) Brussels, Copenhagen, Madrid, Paris
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Przelew przedpłaty za rezerwacje id 1249415 na Slowhop

Przelaliśmy przedpłatę za rezerwację nr 1249415 od Agata Jalosinska na Twoje konto


Numer rezerwacji        Cena pobytu     Przedpłata      Prowizja
Slowhop netto   Przelew na
Wasze konto
1249415 (Agata Jalosinska, 10-04-2026 - 12-04-2026)     2510 zł 753 zł  376.5 zł        289.9 zł


Zbiorczą fakturę za prowizje Slowhopa prześlemy na koniec miesiąca.

Pozdrawiamy :)
Zespół Slowhopa
`;

// The activity log preserves the sender, amount and match score of the two guest
// transfers but not their titles, so those are left empty rather than invented —
// which is why the two are replayed at their logged score of 110 instead of
// having a score re-derived from an incomplete fixture. Note the spellings: the
// bank writes the surname with Polish diacritics, Slowhop without.
//
// The kaucja arrived once, on 08.04, as the bank statement confirms. It appeared
// twice in this booking's history because the bank notification was re-processed
// on 09.04 during the Apr 7–9 replay incident, back when applyTransferMatch had
// no idempotency gate; that phantom entry has since been removed (see
// scripts/remove_phantom_deposit_62.ts). The flow below books each inflow once,
// which is what actually hit the account.
const jalosinskaDeposit: ParsedBankData = {
  amount: 500,
  currency: "PLN",
  senderName: "AGATA JAŁOSIŃSKA UL. STANISŁAWA AUG",
  transferTitle: "",
  transferDate: new Date("2026-04-07"),
  accountNumber: "11187010452078106769980001",
};

const jalosinskaBalance: ParsedBankData = {
  amount: 1757,
  currency: "PLN",
  senderName: "AGATA JAŁOSIŃSKA UL. STANISŁAWA AUG",
  transferTitle: "",
  transferDate: new Date("2026-04-07"),
  accountNumber: "11187010452078106769980001",
};

const jalosinskaForward: ParsedBankData = {
  amount: 289.9,
  currency: "PLN",
  senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  transferTitle: "Slowhop przedpłaty id: 1249415 (Aga ta Jalosinska ).",
  transferDate: new Date("2026-04-08"),
  accountNumber: "11187010452078106769980001",
};

// ─── Case 3: Anna Daniłowska, booking #24 ─────────────────────────────────────
// Hacjenda, 24–26.04.2026, Slowhop reservation 1210215. The guest sent the
// balance and the kaucja as one transfer.

const DANILOWSKA_S1_SUBJECT =
  "Fw: Rezerwacja nr 1210215 w dniach 24-04-2026 - 26-04-2026 dla Anna  Daniłowska została potwierdzona i opłacona";

const DANILOWSKA_S1_BODY = `
________________________________
From: Slowhop <rezerwacje@slowhop.com>
Sent: Wednesday, January 21, 2026 12:25 PM
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Rezerwacja nr 1210215 w dniach 24-04-2026 - 26-04-2026 dla Anna Daniłowska została potwierdzona i opłacona

Rezerwacja od: Anna Daniłowska została potwierdzona

Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 48723913753
Adres e-mail: danonobus@gmail.com
Rezerwacja nr 1210215:
Gdzie
Hacjenda Kiekrz Hacjenda na wyłączność
Kiedy
24-04-2026 - 26-04-2026
Z kim
5  dorosłych + 0 dzieci + 0 zwierząt

Cena całkowita: 1800 pln
Wysokość opłaconej przedpłaty: 540 pln
Pozostała kwota do zapłaty: 1260 pln

Pozdrawiamy :)
Zespół Slowhopa
`;

const DANILOWSKA_S2_SUBJECT = "Fw: Przelew przedpłaty za rezerwacje id 1210215 na Slowhop";

const DANILOWSKA_S2_BODY = `
________________________________
From: Slowhop <hop@slowhop.com>
Sent: Friday, January 23, 2026 11:56 AM
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Przelew przedpłaty za rezerwacje id 1210215 na Slowhop

Przelaliśmy przedpłatę za rezerwację nr 1210215 od Anna Daniłowska na Twoje konto


Numer rezerwacji        Cena pobytu     Przedpłata      Prowizja
Slowhop netto   Przelew na
Wasze konto
1210215 (Anna Daniłowska, 24-04-2026 - 26-04-2026)      1800 zł 540 zł  270 zł  207.9 zł


Zbiorczą fakturę za prowizje Slowhopa prześlemy na koniec miesiąca.

Pozdrawiamy :)
Zespół Slowhopa
`;

// This transfer predates the bank_transfers table, so its title follows the
// pattern of the forwards that were kept; the S2 mail dates it to 23.01.2026.
const danilowskaForward: ParsedBankData = {
  amount: 207.9,
  currency: "PLN",
  senderName: "SLOWHOP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  transferTitle: "Slowhop przedpłaty id: 1210215 (Ann a Daniłowska ).",
  transferDate: new Date("2026-01-23"),
  accountNumber: "11187010452078106769980001",
};

/** Balance and kaucja in one transfer: 1260 + 500. */
const danilowskaBalanceAndDeposit: ParsedBankData = {
  amount: 1760,
  currency: "PLN",
  senderName: "DANIŁOWSKA ANNA",
  transferTitle: "Hacjenda 24.04.",
  transferDate: new Date("2026-04-15"),
  accountNumber: "11187010452078106769980001",
};

// ─── Case 4: Serhii Kozachenko, booking #181 (Alohacamp) ──────────────────────
// Sadoleś, 2–4.10.2026, Alohacamp reservation 202608952357. Booked on
// 12.08.2026; the stay is still ahead, so none of its money has arrived. The
// transfers below are what this booking is due to receive, projected from the
// confirmation mail and from how Alohacamp settled the earlier stays.

const KOZACHENKO_AL1_SUBJECT = "Fw: Jest! Nowa, opłacona rezerwacja (nr 202608952357)🌳";

const KOZACHENKO_AL1_BODY = `
________________________________
From: AlohaCamp <hello@alohacamp.com>
Sent: Wednesday, August 12, 2026 10:12 PM
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Jest! Nowa, opłacona rezerwacja (nr 202608952357)🌳

Dobre wieści!
Gospodarzu, udało się! Kolejna rezerwacja natychmiastowa została opłacona.
Szczegóły rezerwacji:

  *   Zameldowanie: 02/10/2026 od godz. 17:00
  *   Wymeldowanie: 04/10/2026 do godz. 10:00
  *   Obiekt: Sadoleś 66
  *   Miejsce:
  • Sadoleś 66 (Dom 1)
  *   Adres: Sadoleś 66, 07-140 Sadoleś, Poland
  *   Zapłacono zaliczkę: 675.00 zł
  *   Do dopłaty: 2025.00 zł
  *   Numer rezerwacji: 202608952357

Dane podróżującego:

  *   Imię i nazwisko: Serhii Kozachenko
  *   Telefon: Numer telefonu Gościa będzie widoczny po zakończeniu bezpłatnego okresu anulowania rezerwacji. Do tego czasu prosimy o korzystanie z czatu rezerwacyjnego w celu omówienia wszelkich tematów.

Dziękujemy, że z nami jesteś 🤗
Zespół AlohaCamp
`;

/** Projected: the zaliczka less Alohacamp's whole commission, 675 − 498.15. */
const kozachenkoForward: ParsedBankData = {
  amount: 176.85,
  currency: "PLN",
  senderName: "ALOHACAMP SP. Z O.O.",
  transferTitle: "Wypłata 202608952357",
  transferDate: new Date("2026-08-14"),
  accountNumber: "11187010452078106769980001",
};

/** Projected: the guest settles the balance with the owner before arrival. */
const kozachenkoBalance: ParsedBankData = {
  amount: 2025,
  currency: "PLN",
  senderName: "SERHII KOZACHENKO",
  transferTitle: "Sadoles 2-4.10 dopłata",
  transferDate: new Date("2026-09-20"),
  accountNumber: "11187010452078106769980001",
};

/** Projected: the kaucja, which Alohacamp never handles. */
const kozachenkoDeposit: ParsedBankData = {
  amount: 500,
  currency: "PLN",
  senderName: "SERHII KOZACHENKO",
  transferTitle: "Kaucja Sadoles 2-4.10",
  transferDate: new Date("2026-09-28"),
  accountNumber: "11187010452078106769980001",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Slowhop #172 — Maria Satsiuk, Hacjenda 23–24.08.2026 (rez. 1345090)", () => {
  const open = () => {
    const s1 = parsed(OWNER, SATSIUK_S1_SUBJECT, SATSIUK_S1_BODY);
    const s2 = parsed(OWNER, SATSIUK_S2_SUBJECT, SATSIUK_S2_BODY);
    return { s1, s2, row: track(applyAccountingMail(bookingFromConfirmation(172, s1), s2)) };
  };

  it("reads the stay's money out of the two Slowhop mails", () => {
    const { s1, s2 } = open();

    expect(s1.totalPrice).toBe(1400);
    // The przedpłata went to Slowhop, so it is a reservation fee, not an inflow.
    expect(s1.reservationFee).toBe(420);
    expect(s1.amountPaid).toBeUndefined();
    // 15% + 23% VAT — and the accounting mail's own figure (210 netto) agrees.
    expect(s1.commission).toBe(258.3);
    expect(s2.commission).toBe(258.3);
    expect(s1.hostRevenue).toBe(1141.7);
    expect(s2.hostRevenue).toBe(1141.7);
  });

  it("opens the booking owing the whole payout plus the kaucja", () => {
    const { row } = open();

    expect(row.status).toBe("confirmed");
    expect(row.depositStatus).toBe("pending");
    expect(row.amountPaid).toBe("0.00");
    // Nothing has reached the account: 161.70 forward + 980 balance still due.
    expect(calculateBalanceDue(row as any, false)).toBe(1141.7);
    expect(calculateBalanceDue(row as any, true)).toBe(1641.7);
  });

  it("books the forward, then the balance, ending on the live row", async () => {
    const { row } = open();

    await autoMatch(row, satsiukForward);

    expect(row.status).toBe("confirmed");
    expect(row.depositStatus).toBe("pending");
    // The first money to actually arrive. Before the fix this read 581.70: the
    // 420 zł przedpłata from the confirmation mail plus the forward of it.
    expect(row.amountPaid).toBe("161.70");
    expect(calculateBalanceDue(row as any, false)).toBe(980);

    // The balance was paid by a fellow traveller, not by Maria, so the name
    // scores nothing and the transfer falls short of an unattended match — this
    // one was confirmed by hand in the app (which applies it with a score of 100).
    expect(scoreFor(satsiukBalance, row)).toBeLessThan(AUTO_MATCH_THRESHOLD);
    await applyTransferMatch(row.id, satsiukBalance, 100);

    expect(row.status).toBe("paid");
    // 161.70 + 980 = the full 1141.70 payout, which is what booking #172 holds.
    expect(row.amountPaid).toBe("1141.70");
    expect(calculateBalanceDue(row as any, false)).toBe(0);
    // The kaucja has not arrived yet — the stay is still ahead (check-in 23.08)
    // and the owner collects it before arrival, so this is where booking #172
    // stands today: the payout complete, 500 still to come.
    expect(row.depositStatus).toBe("pending");
    expect(calculateBalanceDue(row as any, true)).toBe(500);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("closes on the kaucja still to be collected before arrival", async () => {
    const { row } = open();

    await autoMatch(row, satsiukForward);
    await applyTransferMatch(row.id, satsiukBalance, 100);

    // Projected, not yet received: the third inflow this booking is still due.
    await autoMatch(row, satsiukDeposit);

    expect(row.depositStatus).toBe("paid");
    // A kaucja is not payment for the stay, so a booking already `paid` stays paid.
    expect(row.status).toBe("paid");
    expect(row.amountPaid).toBe("1641.70");
    expect(calculateBalanceDue(row as any, true)).toBe(0);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });
});

describe("Slowhop #62 — Agata Jalosinska, Sadoleś 10–12.04.2026 (rez. 1249415)", () => {
  const open = () => {
    const s1 = parsed(OWNER, JALOSINSKA_S1_SUBJECT, JALOSINSKA_S1_BODY);
    const s2 = parsed(OWNER, JALOSINSKA_S2_SUBJECT, JALOSINSKA_S2_BODY);
    return { s1, s2, row: track(applyAccountingMail(bookingFromConfirmation(62, s1), s2)) };
  };

  it("agrees with Slowhop's own arithmetic on the forward", () => {
    const { s1, s2 } = open();

    expect(s1.totalPrice).toBe(2510);
    expect(s1.reservationFee).toBe(753);
    // Slowhop states 376.50 netto; with VAT that is the 463.10 the parser derives
    // from the total, and 753 − 463.10 = the 289.90 the mail promises to send.
    expect(s2.commission).toBe(463.1);
    expect(s1.commission).toBe(463.1);
    expect(s1.reservationFee! - s1.commission!).toBeCloseTo(289.9, 2);
    expect(s2.hostRevenue).toBe(2046.9);
  });

  it("books kaucja, balance and a late forward in the order they arrived", async () => {
    const { row } = open();

    expect(calculateBalanceDue(row as any, true)).toBe(2546.9);

    // 1. The kaucja arrives first, days before check-in.
    await applyTransferMatch(row.id, jalosinskaDeposit, 110);
    expect(row.depositStatus).toBe("paid");
    // A kaucja is not payment for the stay, so the booking is still `confirmed`.
    expect(row.status).toBe("confirmed");
    expect(row.amountPaid).toBe("500.00");

    // 2. The rest of what the guest owes: 2510 − 753.
    await applyTransferMatch(row.id, jalosinskaBalance, 110);
    expect(row.status).toBe("paid");
    expect(row.amountPaid).toBe("2257.00");
    // The forward has not landed yet, so the account is still short by 289.90.
    // The deposit-inclusive view is the meaningful one once a kaucja has been
    // received: `amountPaid` holds every kind of inflow, kaucja included, so the
    // stay-only figure nets that 500 off the payout and reads too low.
    expect(calculateBalanceDue(row as any, true)).toBeCloseTo(289.9, 2);

    // 3. Slowhop forwards the rest of the zaliczka last, after the guest settled.
    await autoMatch(row, jalosinskaForward);

    // Already `paid` — a forward arriving late must not knock it back.
    expect(row.status).toBe("paid");
    expect(row.depositStatus).toBe("paid");
    // 500 + 1757 + 289.90 = hostRevenue 2046.90 + kaucja 500.
    expect(row.amountPaid).toBe("2546.90");
    expect(calculateBalanceDue(row as any, true)).toBe(0);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });
});

describe("Slowhop #24 — Anna Daniłowska, Hacjenda 24–26.04.2026 (rez. 1210215)", () => {
  const open = () => {
    const s1 = parsed(OWNER, DANILOWSKA_S1_SUBJECT, DANILOWSKA_S1_BODY);
    const s2 = parsed(OWNER, DANILOWSKA_S2_SUBJECT, DANILOWSKA_S2_BODY);
    return { s1, s2, row: track(applyAccountingMail(bookingFromConfirmation(24, s1), s2)) };
  };

  it("derives the same 207.90 forward the accounting mail announces", () => {
    const { s1, s2 } = open();

    expect(s1.totalPrice).toBe(1800);
    expect(s1.reservationFee).toBe(540);
    expect(s2.commission).toBe(332.1); // 270 netto × 1.23
    expect(s1.reservationFee! - s2.commission!).toBeCloseTo(207.9, 2);
    expect(s2.hostRevenue).toBe(1467.9);
  });

  it("settles balance and kaucja from a single guest transfer", async () => {
    const { row } = open();

    await autoMatch(row, danilowskaForward);
    expect(row.status).toBe("confirmed");
    expect(row.amountPaid).toBe("207.90");

    // 1260 balance + 500 kaucja in one payment.
    await autoMatch(row, danilowskaBalanceAndDeposit);

    expect(row.status).toBe("paid");
    expect(row.depositStatus).toBe("paid");
    // 207.90 + 1760 = hostRevenue 1467.90 + kaucja 500. The pre-fix row carried
    // 2300.00 here — the przedpłata counted from the mail and the forward lost.
    expect(row.amountPaid).toBe("1967.90");
    expect(calculateBalanceDue(row as any, false)).toBe(0);
    expect(calculateBalanceDue(row as any, true)).toBe(0);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });
});

describe("Alohacamp #181 — Serhii Kozachenko, Sadoleś 2–4.10.2026 (rez. 202608952357)", () => {
  const open = () => {
    const al1 = parsed(OWNER, KOZACHENKO_AL1_SUBJECT, KOZACHENKO_AL1_BODY);
    return { al1, row: track(bookingFromConfirmation(181, al1)) };
  };

  it("reconstructs the total from zaliczka + do dopłaty", () => {
    const { al1 } = open();

    // This variant of the confirmation states no "Cena:" line at all.
    expect(al1.totalPrice).toBe(2700);
    expect(al1.reservationFee).toBe(675);
    expect(al1.amountPaid).toBeUndefined();
    // 15% + 23% VAT = 18.45%.
    expect(al1.commission).toBe(498.15);
    expect(al1.hostRevenue).toBe(2201.85);
    // A zaliczka is not a stay settled in full, so the booking stays `pending`
    // rather than jumping to `portal_paid`.
    expect(al1.settledWithPortalInFull).toBe(false);
    expect(al1.property).toBe("Sadoles");
    expect(al1.bookingId).toBe("202608952357");
  });

  it("opens owing 2701.85: forward, balance and kaucja all still to come", () => {
    const { row } = open();

    expect(row.status).toBe("pending");
    expect(row.depositStatus).toBe("pending");
    expect(row.amountPaid).toBe("0.00");
    expect(calculateBalanceDue(row as any, false)).toBe(2201.85);
    // 176.85 + 2025 + 500.
    expect(calculateBalanceDue(row as any, true)).toBe(2701.85);
  });

  it("books the projected forward, balance and kaucja", async () => {
    const { row } = open();

    // 675 − 498.15. Before this was modelled, the forward fell through to the
    // generic portal branch, which read it as the whole payment, flipped the
    // booking to `paid` and sent a mismatch alert.
    await autoMatch(row, kozachenkoForward);
    expect(row.status).toBe("confirmed");
    expect(row.depositStatus).toBe("pending");
    expect(row.amountPaid).toBe("176.85");
    expect(calculateBalanceDue(row as any, false)).toBe(2025);

    await autoMatch(row, kozachenkoBalance);
    expect(row.status).toBe("paid");
    expect(row.amountPaid).toBe("2201.85");

    await autoMatch(row, kozachenkoDeposit);
    expect(row.depositStatus).toBe("paid");
    expect(row.amountPaid).toBe("2701.85");
    expect(calculateBalanceDue(row as any, true)).toBe(0);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("settles balance and kaucja together when they arrive as one transfer", async () => {
    const { row } = open();

    await autoMatch(row, kozachenkoForward);
    await autoMatch(row, { ...kozachenkoBalance, amount: 2525, transferTitle: "Sadoles 2-4.10 dopłata + kaucja" });

    expect(row.status).toBe("paid");
    expect(row.depositStatus).toBe("paid");
    expect(row.amountPaid).toBe("2701.85");
    expect(calculateBalanceDue(row as any, true)).toBe(0);
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });
});

// ─── Unpicking a match ────────────────────────────────────────────────────────
// The mirror image of the flows above: when a transfer is unlinked in the app,
// the booking has to stop claiming money it no longer holds.

describe("reverting a match", () => {
  const slowhopSettled = () =>
    track({
      id: 172,
      channel: "slowhop",
      property: "Hacjenda",
      status: "paid",
      depositStatus: "pending",
      guestName: "Maria Satsiuk",
      companyName: null,
      checkIn: new Date("2026-08-23"),
      checkOut: new Date("2026-08-24"),
      totalPrice: "1400.00",
      hostRevenue: "1141.70",
      commission: "258.30",
      reservationFee: "420.00",
      amountPaid: "1141.70",
      depositAmount: "500.00",
      icalUid: null,
      icalSummary: null,
    } as LedgerRow);

  const alohacampSettled = () =>
    track({
      id: 181,
      channel: "alohacamp",
      property: "Sadoles",
      status: "paid",
      depositStatus: "paid",
      guestName: "Serhii Kozachenko",
      companyName: null,
      checkIn: new Date("2026-10-02"),
      checkOut: new Date("2026-10-04"),
      totalPrice: "2700.00",
      hostRevenue: "2201.85",
      commission: "498.15",
      reservationFee: "675.00",
      amountPaid: "2701.85",
      depositAmount: "500.00",
      icalUid: null,
      icalSummary: null,
    } as LedgerRow);

  it("stops an Alohacamp booking claiming to be paid", async () => {
    const row = alohacampSettled();

    // Alohacamp was missing from the channel chain entirely, so this took the
    // 2025 off the booking and left it standing at `paid`.
    await revertTransferMatch(row.id, 2025);

    expect(row.amountPaid).toBe("676.85");
    expect(row.status).toBe("confirmed");
    expect(row.depositStatus).toBe("paid");
  });

  it("stops a Slowhop booking claiming to be paid on the forward alone", async () => {
    const row = slowhopSettled();

    // 1141.70 − 980 = 161.70 left, which is only the portal's forward. The old
    // rule asked whether the booking had been emptied below 10 zł, so it stayed
    // `paid` on that 161.70.
    await revertTransferMatch(row.id, 980);

    expect(row.amountPaid).toBe("161.70");
    expect(row.status).toBe("confirmed");
  });

  it("leaves the stay paid when only the kaucja is unpicked", async () => {
    const row = alohacampSettled();

    await revertTransferMatch(row.id, 500);

    // The stay itself is still covered: 2201.85 of payout received.
    expect(row.amountPaid).toBe("2201.85");
    expect(row.status).toBe("paid");
    expect(row.depositStatus).toBe("pending");
  });

  it("sends an Airbnb booking back to portal_paid", async () => {
    const row = track({
      ...alohacampSettled(),
      id: 42,
      channel: "airbnb",
      status: "paid",
      depositStatus: "not_applicable",
      reservationFee: null,
      hostRevenue: "4151.82",
      amountPaid: "4151.82",
    } as LedgerRow);

    await revertTransferMatch(row.id, 4151.82);

    expect(row.status).toBe("portal_paid");
    expect(row.amountPaid).toBe("0.00");
  });
});
