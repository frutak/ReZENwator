import { describe, expect, it } from "vitest";
import {
  parseSlowhoEmail,
  parseAirbnbEmail,
  parseNestbankEmail,
  detectEmailSource,
  parseEmail,
} from "../workers/emailParsers";

// ─── Slowhop parser tests ─────────────────────────────────────────────────────

describe("parseSlowhoEmail", () => {
  const subject =
    "Rezerwacja nr 1222769 w dniach 28-03-2026 - 01-04-2026 dla Evelina De Lain została potwierdzona i opłacona";
  const body = `Rezerwacja od: Evelina De Lain została potwierdzona

Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 447956002507
Adres e-mail: evelinajazz@gmail.com
Rezerwacja nr 1222769:
Gdzie
Hacjenda Kiekrz Hacjenda na wyłączność
Kiedy
28-03-2026 - 01-04-2026
Z kim
2  dorosłych + 0 dzieci + 0 zwierząt

Cena całkowita: 1800 pln
Wysokość opłaconej przedpłaty: 540 pln
Pozostała kwota do zapłaty: 1260 pln`;

  it("extracts guest name from subject", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result).not.toBeNull();
    expect(result?.guestName).toBe("Evelina De Lain");
  });

  it("extracts check-in and check-out dates", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.checkIn).toBeInstanceOf(Date);
    expect(result?.checkOut).toBeInstanceOf(Date);
    expect(result?.checkIn?.getDate()).toBe(28);
    expect(result?.checkIn?.getMonth()).toBe(2); // March = 2
    expect(result?.checkOut?.getDate()).toBe(1);
    expect(result?.checkOut?.getMonth()).toBe(3); // April = 3
  });

  it("extracts phone number", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.guestPhone).toBe("447956002507");
  });

  it("extracts email address", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.guestEmail).toBe("evelinajazz@gmail.com");
  });

  it("extracts guest counts", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.adultsCount).toBe(2);
    expect(result?.childrenCount).toBe(0);
    expect(result?.animalsCount).toBe(0);
  });

  it("extracts total price", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.totalPrice).toBe(1800);
  });

  it("detects property as Hacjenda", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.property).toBe("Hacjenda");
  });

  it("sets channel to slowhop", () => {
    const result = parseSlowhoEmail(subject, body);
    expect(result?.channel).toBe("slowhop");
    expect(result?.type).toBe("booking");
  });
});

// ─── Airbnb parser tests ──────────────────────────────────────────────────────

describe("parseAirbnbEmail", () => {
  const subject = "Reservation confirmed - Vlad Svidrickiy arrives 27 Jun";
  const body = `New booking confirmed! Vlad arrives 27 Jun.
Vlad Svidrickiy
Identity verified · 2 reviews
Warsaw, Poland
Sadoles 66-ECO house in Nature Reserve 1h from Waw
Entire home/flat
Check-in
Sat 27 Jun
15:00
Checkout
Mon 29 Jun
11:00
Guests
11 adults, 1 child
Confirmation code
HM8NCRQQ5H
Guest paid
975.00 zl x 2 nights
1,950.00 zl
Cleaning fee
700.00 zl
Total (PLN)
2,862.00 zl
Host payout
You earn
2,451.25 zl`;

  it("extracts guest name from subject", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.guestName).toBe("Vlad Svidrickiy");
  });

  it("extracts check-in date", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.checkIn).toBeInstanceOf(Date);
    expect(result?.checkIn?.getDate()).toBe(27);
    // Month 5 = June
    expect(result?.checkIn?.getMonth()).toBe(5);
  });

  it("extracts check-out date", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.checkOut).toBeInstanceOf(Date);
    expect(result?.checkOut?.getDate()).toBe(29);
    expect(result?.checkOut?.getMonth()).toBe(5);
  });

  it("extracts guest counts", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.adultsCount).toBe(11);
    expect(result?.childrenCount).toBe(1);
  });

  it("extracts total price", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.totalPrice).toBe(2862);
  });

  it("extracts host revenue", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.hostRevenue).toBe(2451.25);
  });

  it("detects property as Sadoles", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.property).toBe("Sadoles");
  });

  it("sets channel to airbnb", () => {
    const result = parseAirbnbEmail(subject, body);
    expect(result?.channel).toBe("airbnb");
  });
});

// ─── Nestbank parser tests ────────────────────────────────────────────────────

describe("parseNestbankEmail", () => {
  const subject = "Wpływ na konto BIZnest Konto 11...0001";
  const body = `Dzień dobry,
dnia 02.03.2026 nastąpił wpływ 1500,00 PLN na konto BIZnest Konto 11187010452078106769980001, od RENNER LAURA ANNA, tytułem Laura Renner 7.03 wpłata.

Pozdrawiamy
Zespół Nest Banku`;

  it("extracts transfer amount", () => {
    const result = parseNestbankEmail(subject, body);
    expect(result?.amount).toBe(1500);
  });

  it("extracts sender name", () => {
    const result = parseNestbankEmail(subject, body);
    expect(result?.senderName).toBe("RENNER LAURA ANNA");
  });

  it("extracts transfer title", () => {
    const result = parseNestbankEmail(subject, body);
    expect(result?.transferTitle).toContain("Laura Renner");
  });

  it("extracts transfer date", () => {
    const result = parseNestbankEmail(subject, body);
    expect(result?.transferDate).toBeInstanceOf(Date);
    expect(result?.transferDate?.getDate()).toBe(2);
    expect(result?.transferDate?.getMonth()).toBe(2); // March = 2
    expect(result?.transferDate?.getFullYear()).toBe(2026);
  });

  it("sets type to bank and bank to nestbank", () => {
    const result = parseNestbankEmail(subject, body);
    expect(result?.type).toBe("bank");
    expect(result?.bank).toBe("nestbank");
  });
});

// ─── Email source detection tests ─────────────────────────────────────────────

describe("detectEmailSource", () => {
  it("detects Slowhop from subject", () => {
    expect(
      detectEmailSource("", "Rezerwacja nr 1222769 w dniach - Slowhop", "")
    ).toBe("slowhop");
  });

  it("detects Airbnb from subject", () => {
    expect(
      detectEmailSource("", "Reservation confirmed - Vlad arrives 27 Jun", "")
    ).toBe("airbnb");
  });

  it("detects Nestbank from subject", () => {
    expect(
      detectEmailSource("", "Wpływ na konto BIZnest Konto 11...0001", "")
    ).toBe("nestbank");
  });

  it("detects Airbnb from sender", () => {
    expect(
      detectEmailSource("automated@airbnb.com", "New booking", "")
    ).toBe("airbnb");
  });

  it("returns unknown for unrecognized email", () => {
    expect(
      detectEmailSource("random@example.com", "Hello world", "")
    ).toBe("unknown");
  });
});

// ─── parseEmail dispatcher tests ─────────────────────────────────────────────

describe("parseEmail", () => {
  it("dispatches Nestbank email correctly", () => {
    const result = parseEmail(
      "",
      "Wpływ na konto BIZnest Konto 11...0001",
      "dnia 02.03.2026 nastąpił wpływ 1500,00 PLN na konto ..., od RENNER LAURA ANNA, tytułem Laura Renner 7.03 wpłata."
    );
    expect(result?.type).toBe("bank");
  });

  it("returns null for unknown email", () => {
    const result = parseEmail("random@example.com", "Hello", "World");
    expect(result).toBeNull();
  });
});

// ─── Booking.com parser tests ────────────────────────────────────────────────

describe("parseBookingComEmail", () => {
  const subject = "Nowa rezerwacja z Booking.com:";
  const body = `Nowa rezerwacja z Booking.com:
Obiekt: Sadoles 66
ID Rezerwacji: 123456789
Gość: Jan Kowalski
Kraj: Poland
Liczba gości: 4
Termin: Fri, Mar 27, 2026 do Sun, Mar 29, 2026
Cena dla gościa: PLN 2,666.67
Prowizja Booking: PLN 337.33
Email gościa: jan.kowalski@example.com.`;

  it("extracts guest name from body", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.guestName).toBe("Jan Kowalski");
  });

  it("extracts guest country", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.guestCountry).toBe("Poland");
  });

  it("extracts guest count", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.guestCount).toBe(4);
  });

  it("extracts check-in and check-out dates", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.checkIn?.getDate()).toBe(27);
    expect(result?.checkOut?.getDate()).toBe(29);
  });

  it("extracts total price, commission and host revenue", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.totalPrice).toBe(2666.67);
    expect(result?.commission).toBe(337.33);
    expect(result?.hostRevenue).toBe(2666.67 - 337.33);
  });

  it("detects property as Sadoles", () => {
    const result = parseEmail("automated@booking.com", subject, body) as any;
    expect(result?.property).toBe("Sadoles");
  });

  it("handles old format subject", () => {
    const oldSubject = "Nowa rezerwacja: Yaroslava Senenko (6365579963)";
    const result = parseEmail("automated@booking.com", oldSubject, body) as any;
    expect(result?.guestName).toBe("Yaroslava Senenko");
  });
});
