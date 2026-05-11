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

  it("should parse phone if visible", () => {
    const bodyWithPhone = sampleBody.replace("Telefon: Numer telefonu Gościa będzie widoczny po zakończeniu bezpłatnego okresu anulowania rezerwacji. Do tego czasu prosimy o korzystanie z czatu rezerwacyjnego w celu omówienia wszelkich tematów.", "Telefon: +48 123 456 789");
    const data = parseAlohacampEmail(sampleSubject, bodyWithPhone);
    console.log("Body with phone:", bodyWithPhone);
    console.log("Parsed Phone:", data.guestPhone);
    expect(data.guestPhone).toBe("+48 123 456 789");
  });
});
