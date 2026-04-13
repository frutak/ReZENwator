import { describe, expect, it } from "vitest";
import {
  parseEmail,
  detectEmailSource,
} from "../workers/emailParsers";
import { format } from "date-fns";

const formatDate = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : undefined;

describe("Email Parsers", () => {
  
  describe("detectEmailSource", () => {
    it("detects sources correctly", () => {
      expect(detectEmailSource("", "Reservation confirmed", "")).toBe("airbnb");
      expect(detectEmailSource("", "Nowa rezerwacja", "")).toBe("booking");
      expect(detectEmailSource("rezerwacje@slowhop.com", "", "")).toBe("slowhop");
      expect(detectEmailSource("nestinfo@powiadomienia.nestbank.pl", "", "")).toBe("nestbank");
    });
  });

  describe("Slowhop (S1) - Confirmation", () => {
    const from = "rezerwacje@slowhop.com";
    const subject = "Rezerwacja nr 1222769 w dniach 28-03-2026 - 01-04-2026 dla Evelina De Lain została potwierdzona i opłacona";
    const body = `Bezpośredni kontakt do Gości:
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
Wysokość opłaconej przedpłaty: 540 pln`;

    it("parses all fields correctly", () => {
      const result = parseEmail(from, subject, body);
      expect(result?.template).toBe("BOOKING_CONFIRMATION");
      expect(result?.subTemplate).toBe("S1");
      const data = result?.data;
      expect(data.guestName).toBe("Evelina De Lain");
      expect(formatDate(data.checkIn)).toBe("2026-03-28");
      expect(formatDate(data.checkOut)).toBe("2026-04-01");
      expect(data.guestPhone).toBe("447956002507");
      expect(data.totalPrice).toBe(1800);
      expect(data.amountPaid).toBe(540);
      expect(data.property).toBe("Hacjenda");
    });
  });

  describe("Slowhop (S2) - Transfer/Settlement", () => {
    const from = "hop@slowhop.com";
    const subject = "Przelew przedpłaty za rezerwacje id 1222769 na Slowhop";
    const body = `1222769 (Evelina De Lain, 28-03-2026 - 01-04-2026) 1800 zł 540 zł 270 zł 207.9 zł`;

    it("parses settlement details correctly", () => {
      const result = parseEmail(from, subject, body);
      expect(result?.subTemplate).toBe("S2");
      const data = result?.data;
      expect(data.guestName).toBe("Evelina De Lain");
      expect(data.totalPrice).toBe(1800);
      expect(data.amountPaid).toBe(540);
      // Original commission 270, now 270 * 1.23 = 332.1
      expect(data.commission).toBe(332.1);
      expect(data.hostRevenue).toBe(1800 - 332.1);
    });
  });

  describe("Airbnb (A1) - Confirmation", () => {
    const from = "automated@airbnb.com";
    const subject = "Reservation confirmed - Vlad Svidrickiy arrives 27 Jun";
    const body = `Sadoles 66-ECO house
Check-in Sat 27 Jun 15:00
Checkout Mon 29 Jun 11:00
Guests 11 adults, 1 child
Total (PLN) 2,862.00 zl
You earn 2,451.25 zl`;

    it("parses Airbnb booking correctly", () => {
      const result = parseEmail(from, subject, body);
      expect(result?.subTemplate).toBe("A1");
      const data = result?.data;
      expect(data.guestName).toBe("Vlad Svidrickiy");
      expect(data.adultsCount).toBe(11);
      expect(data.childrenCount).toBe(1);
      expect(data.totalPrice).toBe(2862);
      expect(data.hostRevenue).toBe(2451.25);
      expect(data.property).toBe("Sadoles");
    });
  });

  describe("Booking.com (B1) - Confirmation", () => {
    // Note: B1 expects from: owner forwarded or similar, but let's mock it
    const from = "frutak@gmail.com";
    const subject = "Nowa rezerwacja: Jan Kowalski (123456789)";
    const body = `Booking.com
Gość: Jan Kowalski
Kraj: Poland
Liczba gości: 4
Termin: 27.03.2026 do 29.03.2026
Cena dla gościa: PLN 2,666.67
Prowizja Booking: PLN 337.33
Obiekt: Sadoles 66`;

    it("parses Booking.com booking correctly", () => {
      const result = parseEmail(from, subject, body);
      expect(result?.subTemplate).toBe("B1");
      const data = result?.data;
      expect(data.guestName).toBe("Jan Kowalski");
      expect(data.guestCount).toBe(4);
      expect(formatDate(data.checkIn)).toBe("2026-03-27");
      expect(data.totalPrice).toBe(2666.67);
      expect(data.property).toBe("Sadoles");
    });
  });

  describe("Nestbank - Bank Transfer", () => {
    const from = "nestinfo@powiadomienia.nestbank.pl";
    const subject = "Wpływ na konto BIZnest Konto 11187010452078106769980001";
    const body = `dnia 02.03.2026 nastąpił wpływ 1500,00 PLN na konto ..., od RENNER LAURA ANNA, tytułem Laura Renner 7.03 wpłata.`;

    it("parses bank transfer correctly", () => {
      const result = parseEmail(from, subject, body);
      expect(result?.template).toBe("BANK_TRANSFER");
      const data = result?.data;
      expect(data.amount).toBe(1500);
      expect(data.senderName).toBe("RENNER LAURA ANNA");
      expect(data.transferTitle).toBe("Laura Renner 7.03 wpłata.");
      expect(formatDate(data.transferDate)).toBe("2026-03-02");
    });
  });
});
