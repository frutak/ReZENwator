import { parseBookingComEmail, detectEmailSource } from "./server/workers/emailParsers";

const testSubject = "Nowa rezerwacja: Yaroslava Senenko (6365579963)";
const testBody = `Nowa rezerwacja z Booking.com: Obiekt: Sadoleś 66 Gość: Yaroslava Senenko Termin: Fri, Mar 27, 2026 do Sun, Mar 29, 2026 Cena dla gościa: PLN 2,666.67 Prowizja Booking: PLN 337.33 ID Rezerwacji: 6365579963 Email gościa: ysenen.962336@guest.booking.com`;
const testFrom = "Booking.com <frutak@gmail.com>";

console.log("Detecting source...");
const source = detectEmailSource(testFrom, testSubject, testBody);
console.log("Source:", source);

console.log("\nParsing email...");
const parsed = parseBookingComEmail(testSubject, testBody);
console.log("Parsed:", JSON.stringify(parsed, null, 2));
