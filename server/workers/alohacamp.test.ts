import { describe, it, expect } from "vitest";
import { parseAlohacampEmail, qualifyEmail } from "./emailParsers";

describe("Alohacamp AL1 Parser", () => {
  const sampleSubject = "Jest! Nowa, opłacona rezerwacja (nr 20251037489)🌳";
  const sampleBody = `
Dobre wieści!
Gospodarzu, udało się! Kolejna rezerwacja natychmiastowa została opłacona.
Szczegóły rezerwacji:
Zameldowanie: 09/01/2026 od godz. 17:00
Wymeldowanie: 11/01/2026 do godz. 11:00
Obiekt: Sadoleś 66
Miejsce: Dom
Adres: Sadoleś 66, 07-140 Sadoleś, Poland
Cena: 3000.00 zł - opłacona w całości
Wpłata Gościa: 2600.00 zł
Środki z portfela Gościa: 400.00 zł
Numer rezerwacji: 20251037489
Dane podróżującego:
Imię i nazwisko: Maciej Suchocki
Telefon: Numer telefonu Gościa będzie widoczny po zakończeniu bezpłatnego okresu anulowania rezerwacji. Do tego czasu prosimy o korzystanie z czatu rezerwacyjnego w celu omówienia wszelkich tematów.
  `.trim();

  it("should qualify Alohacamp confirmation email", () => {
    const qualified = qualifyEmail("bookings@alohacamp.com", sampleSubject, sampleBody);
    expect(qualified.template).toBe("BOOKING_CONFIRMATION");
    expect(qualified.subTemplate).toBe("AL1");
  });

  it("should parse Alohacamp AL1 correctly", () => {
    const data = parseAlohacampEmail(sampleSubject, sampleBody);
    console.log("Parsed Data:", JSON.stringify(data, null, 2));
    
    expect(data.channel).toBe("alohacamp");
    expect(data.bookingId).toBe("20251037489");
    expect(data.guestName).toBe("Maciej Suchocki");
    
    // Check if dates are defined before checking ISO string
    expect(data.checkIn).toBeDefined();
    expect(data.checkOut).toBeDefined();
    
    if (data.checkIn) {
      const dateStr = data.checkIn.toDateString();
      console.log("Check-in DateString:", dateStr);
      // Jan 09 2026
      expect(dateStr.includes("Jan 09 2026")).toBe(true);
    }
    
    if (data.checkOut) {
      expect(data.checkOut.toDateString().includes("Jan 11 2026")).toBe(true);
    }

    expect(data.totalPrice).toBe(3000);
    expect(data.commission).toBe(553.5);
    expect(data.hostRevenue).toBe(2446.5);
    expect(data.property).toBe("Sadoles");
    expect(data.guestPhone).toBeUndefined();
  });

  it("flags 'opłacona w całości' without booking it as money received", () => {
    const data = parseAlohacampEmail(sampleSubject, sampleBody);
    expect(data.settledWithPortalInFull).toBe(true);
    // The guest has settled with Alohacamp, but the owner has not been paid yet —
    // the payout still has to be forwarded, so nothing counts as received.
    expect(data.amountPaid).toBeUndefined();
    // A stay settled in full has no separate prepayment.
    expect(data.reservationFee).toBeUndefined();
  });

  // Verbatim text/plain body of a real Alohacamp mail forwarded by the owner
  // (12.08.2026). Note the bulleted layout and that this variant states no
  // "Cena:" line — the total has to come from zaliczka + do dopłaty. It also
  // carries no guest count and no guest email; Alohacamp simply omits them.
  describe("real forwarded mail — prepayment variant", () => {
    const subject = "Fw: Jest! Nowa, opłacona rezerwacja (nr 202608952357)🌳";
    const body = [
      "From: AlohaCamp <hello@alohacamp.com>",
      "Subject: Jest! Nowa, opłacona rezerwacja (nr 202608952357)🌳",
      "Dobre wieści!",
      "Gospodarzu, udało się! Kolejna rezerwacja natychmiastowa została opłacona.",
      "Szczegóły rezerwacji:",
      "",
      "  *   Zameldowanie: 02/10/2026 od godz. 17:00",
      "  *   Wymeldowanie: 04/10/2026 do godz. 10:00",
      "  *   Obiekt: Sadoleś 66",
      "  *   Miejsce:",
      "  • Sadoleś 66 (Dom 1)",
      "  *   Adres: Sadoleś 66, 07-140 Sadoleś, Poland",
      "  *   Zapłacono zaliczkę: 675.00 zł",
      "  *   Do dopłaty: 2025.00 zł",
      "  *   Numer rezerwacji: 202608952357",
      "",
      "Dane podróżującego:",
      "",
      "  *   Imię i nazwisko: Serhii Kozachenko",
      "  *   Telefon: Numer telefonu Gościa będzie widoczny po zakończeniu bezpłatnego okresu anulowania rezerwacji.",
      "",
      "Zespół AlohaCamp",
    ].join("\n");

    it("qualifies as AL1 when forwarded from the owner's own address", () => {
      const q = qualifyEmail('"Szymon Furtak" <szymonfurtak@hotmail.com>', subject, body);
      expect(q.template).toBe("BOOKING_CONFIRMATION");
      expect(q.subTemplate).toBe("AL1");
    });

    it("reconstructs the total from zaliczka + do dopłaty", () => {
      const data = parseAlohacampEmail(subject, body);
      expect(data.bookingId).toBe("202608952357");
      expect(data.guestName).toBe("Serhii Kozachenko");
      expect(data.property).toBe("Sadoles");
      expect(data.checkIn?.toDateString()).toContain("Oct 02 2026");
      expect(data.checkOut?.toDateString()).toContain("Oct 04 2026");
      expect(data.totalPrice).toBe(2700);
      // The zaliczka went to Alohacamp, not to the owner's account.
      expect(data.amountPaid).toBeUndefined();
      expect(data.reservationFee).toBe(675);
      expect(data.settledWithPortalInFull).toBe(false);
      expect(data.commission).toBe(498.15);
      expect(data.hostRevenue).toBe(2201.85);
      // Placeholder text, not a number — must not be stored as a phone.
      expect(data.guestPhone).toBeUndefined();
    });
  });

  it("should parse phone if visible", () => {
    const bodyWithPhone = sampleBody.replace("Telefon: Numer telefonu Gościa będzie widoczny po zakończeniu bezpłatnego okresu anulowania rezerwacji. Do tego czasu prosimy o korzystanie z czatu rezerwacyjnego w celu omówienia wszelkich tematów.", "Telefon: +48 123 456 789");
    const data = parseAlohacampEmail(sampleSubject, bodyWithPhone);
    console.log("Body with phone:", bodyWithPhone);
    console.log("Parsed Phone:", data.guestPhone);
    expect(data.guestPhone).toBe("+48 123 456 789");
  });
});
