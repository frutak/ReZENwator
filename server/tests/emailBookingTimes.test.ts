import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBookingConfirmation } from "../workers/emailPoller";
import { parseEmail, type ParsedBookingData } from "../workers/emailParsers";
import { BookingRepository } from "../repositories/BookingRepository";

/**
 * Arrival and departure hours on a booking born from a confirmation mail.
 *
 * A confirmation states a date and no time, so the parsers hand back local
 * midnight. The iCal poller settles the hours for an all-day event and
 * `BookingService` does the same on a manual create, but this path used to write
 * the parse through untouched — and only when the mail beat the iCal feed to it,
 * which is why it went unnoticed for months. Sofia Krutko's stay (#174) was
 * created from its S1 mail on 25.07 and read "16 Oct 2026 00:00" in the app ever
 * since; the feed cannot repair it either, because it deliberately preserves
 * whatever time the row already holds rather than overwrite a deliberate early
 * arrival.
 */

vi.mock("../repositories/BookingRepository", () => ({
  BookingRepository: {
    findBySummaryId: vi.fn().mockResolvedValue(null),
    findEmailMatchCandidates: vi.fn().mockResolvedValue([]),
    insertBooking: vi.fn().mockResolvedValue([{ insertId: 900 }]),
    updateBookingDetails: vi.fn(),
  },
}));
vi.mock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
vi.mock("../_core/email", () => ({
  sendAlertEmail: vi.fn(),
  forwardUnmatchedEmail: vi.fn(),
  GMAIL_USER: "furtka.rentals@gmail.com",
}));

const OWNER = '"Szymon Furtak" <szymonfurtak@hotmail.com>';

/** Sofia Krutko's real S1 mail, the one that created #174 at midnight. */
const KRUTKO_SUBJECT =
  "FW: Rezerwacja nr 1348762 w dniach 16-10-2026 - 21-10-2026 dla Sofia Krutko została potwierdzona i opłacona";

const KRUTKO_BODY = `
________________________________
From: Slowhop <rezerwacje@slowhop.com>
Sent: Saturday, July 25, 2026 1:12:03 PM (UTC+01:00) Brussels, Copenhagen, Madrid, Paris
To: szymonfurtak@hotmail.com <szymonfurtak@hotmail.com>
Subject: Rezerwacja nr 1348762 w dniach 16-10-2026 - 21-10-2026 dla Sofia Krutko została potwierdzona i opłacona

Rezerwacja od: Sofia Krutko została potwierdzona

Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 48577475614
Adres e-mail: sonya.krutko@gmail.com
Rezerwacja nr 1348762:
Gdzie
Sadoleś 66 dom na wyłączność
Kiedy
16-10-2026 - 21-10-2026
Z kim
7  dorosłych + 0 dzieci + 1 zwierząt

Cena całkowita: 3530 pln
Wysokość opłaconej przedpłaty: 1059 pln
Pozostała kwota do zapłaty: 2471 pln

Pozdrawiamy :)
Zespół Slowhopa
`;

const parsedData = (subject: string, body: string): ParsedBookingData => {
  const result = parseEmail(OWNER, subject, body);
  if (!result) throw new Error(`Email did not qualify: ${subject}`);
  return result.data as ParsedBookingData;
};

const inserted = () => (BookingRepository.insertBooking as any).mock.calls.at(-1)[0];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("booking created from a confirmation mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (BookingRepository.findBySummaryId as any).mockResolvedValue(null);
    (BookingRepository.findEmailMatchCandidates as any).mockResolvedValue([]);
    (BookingRepository.insertBooking as any).mockResolvedValue([{ insertId: 900 }]);
  });

  it("arrives at 16:00 and leaves at 10:00", async () => {
    const data = parsedData(KRUTKO_SUBJECT, KRUTKO_BODY);
    // The parser reports the dates alone, as the mail states them.
    expect(hhmm(data.checkIn!)).toBe("00:00");

    const outcome = await handleBookingConfirmation("S1", data, { messageId: "<krutko@slowhop>" }, false);

    expect(outcome).toBe("created");
    const row = inserted();
    expect(hhmm(row.checkIn)).toBe("16:00");
    expect(hhmm(row.checkOut)).toBe("10:00");
  });

  it("keeps the dates the mail states", async () => {
    const data = parsedData(KRUTKO_SUBJECT, KRUTKO_BODY);

    await handleBookingConfirmation("S1", data, { messageId: "<krutko@slowhop>" }, false);

    const row = inserted();
    expect(ymd(row.checkIn)).toBe("2026-10-16");
    expect(ymd(row.checkOut)).toBe("2026-10-21");
  });

  it("leaves an explicit time alone", async () => {
    // Airbnb states real times; only a bare midnight means "hour not given".
    const data = parsedData(KRUTKO_SUBJECT, KRUTKO_BODY);
    const withTimes: ParsedBookingData = {
      ...data,
      checkIn: new Date(2026, 9, 16, 11, 0),
      checkOut: new Date(2026, 9, 21, 13, 30),
    };

    await handleBookingConfirmation("S1", withTimes, { messageId: "<krutko@slowhop>" }, false);

    const row = inserted();
    expect(hhmm(row.checkIn)).toBe("11:00");
    expect(hhmm(row.checkOut)).toBe("13:30");
  });

  it("does not touch the dates of a booking the feed already created", async () => {
    // The common case: iCal saw the stay first and already set 16:00/10:00, and
    // the mail only enriches it. The enrichment must not write dates at all.
    (BookingRepository.findBySummaryId as any).mockResolvedValue({
      id: 174,
      status: "confirmed",
      checkIn: new Date(2026, 9, 16, 16, 0),
      checkOut: new Date(2026, 9, 21, 10, 0),
      guestName: "Sofia Krutko",
      amountPaid: "407.71",
      reservationFee: "1059.00",
    });

    const data = parsedData(KRUTKO_SUBJECT, KRUTKO_BODY);
    const outcome = await handleBookingConfirmation("S1", data, { messageId: "<krutko@slowhop>" }, false);

    expect(outcome).toBe("updated");
    expect(BookingRepository.insertBooking).not.toHaveBeenCalled();
    const update = (BookingRepository.updateBookingDetails as any).mock.calls.at(-1)[1];
    expect(update).not.toHaveProperty("checkIn");
    expect(update).not.toHaveProperty("checkOut");
  });
});
