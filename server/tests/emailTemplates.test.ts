import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Booking } from "../../drizzle/schema";
import { predictFirstName } from "../_core/utils";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: "123" }),
}));

// Set environment variables for the test
process.env.OWNER_NAME = "Szymon Furtak";
process.env.BUSINESS_NAME = "Furtka - Szymon Furtak";
process.env.BUSINESS_ADDRESS = "Paderewskiego 14, 05-520 Konstancin-Jeziorna";
process.env.BUSINESS_NIP = "9291792877";
process.env.BUSINESS_REGON = "080368396";
process.env.BANK_ACCOUNT_NUMBER = "11 1870 1045 2078 1067 6998 0001";
process.env.BLIK_NUMBER = "571525563";
process.env.SADOLES_MANAGER_NAME = "Iwona";
process.env.SADOLES_MANAGER_PHONE = "695-757-149";
process.env.HACJENDA_MANAGER_NAME = "Marcin";
process.env.HACJENDA_MANAGER_PHONE = "533200016";
process.env.HACJENDA_KEYLOCK_CODE = "2025";
process.env.SADOLES_GUIDE_PL = "https://docs.google.com/document/d/19D_nH60OJKJCd_K_zggBNqsDEH2wUpWOYaVe2TZqBLc/edit";
process.env.SADOLES_GUIDE_EN = "https://docs.google.com/document/d/1ka3hBdJLMcdtSi-4LBZEcutzd0MJGikT3aCUhEAvzi0/edit?tab=t.0";
process.env.HACJENDA_GUIDE_PL = "https://docs.google.com/document/d/1neWOvJlLRhKL5IucQGHgwSrhUQhcI5itjKqKRGxKHyc/edit#heading=h.rlwqj2rlo0xk";
process.env.HACJENDA_GUIDE_EN = "https://docs.google.com/document/d/1OdFYSNrGAnCbPKFcBun_1nhLoUJbigt-eij1UN9m0h0/edit?tab=t.0#heading=h.rlwqj2rlo0xk";
process.env.SADOLES_ADDRESS = "Sadoleś 66, 07-130 Sadoleś";
process.env.HACJENDA_ADDRESS = "Kiekrz";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: sendMailMock,
    }),
  },
}));

// --- THE "OLD" HARDCODED LOGIC (GROUND TRUTH) ---

interface EmailTemplate {
  subject: string;
  html: string;
}

const getArrivalReminderTemplateOld = (booking: Booking, isPL: boolean, isEarlyArrival: boolean): EmailTemplate => {
  const firstName = predictFirstName(booking.guestName);
  const isSadoles = booking.property === "Sadoles";
  const checkInDate = new Date(booking.checkIn);
  
  const getDayOfWeek = (date: Date, isPL: boolean): string => {
    if (isPL) {
      const days = ["W niedzielę", "W poniedziałek", "We wtorek", "W środę", "W czwartek", "W piątek", "W sobotę"];
      return days[date.getDay()];
    }
    return `On ${format(date, "EEEE", { locale: enUS })}`;
  };
  const dayOfWeek = getDayOfWeek(checkInDate, isPL);

  const guideLink = isSadoles 
    ? (isPL ? "https://docs.google.com/document/d/19D_nH60OJKJCd_K_zggBNqsDEH2wUpWOYaVe2TZqBLc/edit" : "https://docs.google.com/document/d/1ka3hBdJLMcdtSi-4LBZEcutzd0MJGikT3aCUhEAvzi0/edit?tab=t.0")
    : (isPL ? "https://docs.google.com/document/d/1neWOvJlLRhKL5IucQGHgwSrhUQhcI5itjKqKRGxKHyc/edit#heading=h.rlwqj2rlo0xk" : "https://docs.google.com/document/d/1OdFYSNrGAnCbPKFcBun_1nhLoUJbigt-eij1UN9m0h0/edit?tab=t.0#heading=h.rlwqj2rlo0xk");

  const arrivalTimePL = isEarlyArrival ? "od rana" : "od godziny 16";
  const arrivalTimeEN = isEarlyArrival ? "from the morning" : "from 4 PM";

  const needsPaymentInfo = !["airbnb", "booking"].includes(booking.channel);
  const totalPrice = parseFloat(String(booking.totalPrice || "0"));
  const amountPaid = parseFloat(String(booking.amountPaid || "0"));
  const remaining = totalPrice - amountPaid;
  const deposit = parseFloat(String(booking.depositAmount || "500"));

  let petFeeHtml = "";
  if (booking.channel === "booking") {
    petFeeHtml = isPL ? `
      <p>Czy planujecie przyjechać ze zwierzętami? Zapraszamy także futrzastych i kudłatych gości, pobyt psa lub kota kosztuje 200 zł za zwierzaka, płatności można dokonać przelewem na numer konta 11 1870 1045 2078 1067 6998 0001, Nazwisko do przelewu: Szymon Furtak, lub blikiem na numer 571525563 (koniecznie napisz, o który pobyt chodzi oraz że jest to opłata za zwierzaka). W razie pytań dawaj znać.</p>
    ` : `
      <p>Are you planning to come with pets? We also welcome furry and shaggy guests, the stay of a dog or cat costs 200 PLN per pet, payment can be made by transfer to account number 11 1870 1045 2078 1067 6998 0001, transfer name: Szymon Furtak, or by BLIK to number 571525563 (be sure to write which stay it is and that it is a pet fee). If you have any questions, let me know.</p>
    `;
  }

  let paymentHtml = "";
  if (needsPaymentInfo) {
    paymentHtml = isPL ? `
      <p><strong>reszta opłaty za pobyt:</strong><br>
      prosiłbym o przelew reszty - ${remaining} zł + ${deposit} zł zwrotnego depozytu, na moje konto, ${isSadoles ? "najlepiej tak na 5 dni przed Waszym przyjazdem" : "tak najpóźniej tydzień przed Waszym przyjazdem"}:<br>
      11 1870 1045 2078 1067 6998 0001<br>
      Nazwisko do przelewu: Szymon Furtak</p>
    ` : `
      <p><strong>Balance of the stay fee:</strong><br>
      I would like to ask for a transfer of the balance - ${remaining} PLN + ${deposit} PLN refundable deposit, to my account, ${isSadoles ? "preferably 5 days before your arrival" : "at the latest one week before your arrival"}:<br>
      11 1870 1045 2078 1067 6998 0001<br>
      Account name: Szymon Furtak</p>
    `;
  }

  if (isSadoles) {
    return {
      subject: isPL ? `Twój przyjazd do Sadoles - ${format(checkInDate, "dd.MM")}` : `Your stay at Sadoles - ${format(checkInDate, "dd.MM")}`,
      html: isPL ? `
        <p>Cześć ${firstName},<br>zbliża się termin Waszego przyjazdu, wiec kilka kwestii organizacyjnych z mojej strony:</p>
        ${petFeeHtml}
        ${paymentHtml}
        <p><strong>przewodnik:</strong><br>załączam przewodnik po domu i okolicy, który przygotowaliśmy dla naszych gości:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>przyjazd:</strong><br>czy wiesz już o której mniej więcej planujecie przyjechać? ${dayOfWeek} dom powinien być dla Was dostępny ${arrivalTimePL}, tylko zależnie od godziny Waszego przyjazdu albo Iwona będzie czekać na Was w domu albo zostawimy Wam klucz w umówionym miejscu. W tym wypadku jeśli będziecie mieli jakieś pytania po przyjeździe to po prostu możecie zadzwonić do mnie lub do Iwony.<br>
        mój numer: 571525563<br>
        numer Iwony: 695-757-149<br>
        Co do wyjazdu: zwykle ustalamy godzinę wyjazdu na 11, jeśli Wam zależy żeby było później to dajcie znać.</p>
        <p>dajcie znać, jeśli macie jakieś pytania!<br>pozdrawiam,<br>Szymon</p>
      ` : `
        <p>Hi ${firstName},<br>Your arrival is approaching, so here are a few organizational details from my side:</p>
        ${petFeeHtml}
        ${paymentHtml}
        <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>arrival:</strong><br>Do you already know roughly what time you plan to arrive? ${dayOfWeek}, the house should be available for you ${arrivalTimeEN}. Depending on your arrival time, either Iwona will be waiting for you at the house or we will leave the key for you in an agreed place. In that case, if you have any questions after arrival, you can simply call me or Iwona.<br>
        My number: 571525563<br>
        Iwona's number: 695-757-149<br>
        Regarding departure: we usually set the departure time to 11 am. If you would like it to be later, please let me know.</p>
        <p>Let me know if you have any questions!<br>Regards,<br>Szymon</p>
      `,
    };
  }

  return {
    subject: isPL ? `Twój przyjazd do Hacjendy - ${format(checkInDate, "dd.MM")}` : `Your stay at Hacjenda - ${format(checkInDate, "dd.MM")}`,
    html: isPL ? `
      <p>Cześć ${firstName},<br><br>dzięki za Waszą rezerwację. Zbliża się termin Waszego przyjazdu, więc przesyłam kilka informacji praktycznych:</p>
      ${petFeeHtml}
      ${paymentHtml}
      <p><strong>przewodnik:</strong><br>załączam przewodnik po domu i okolicy, który przygotowaliśmy dla naszych gości:<br><a href="${guideLink}">${guideLink}</a></p>
      <p><strong>przyjazd:</strong><br>${isEarlyArrival ? `Czy wiecie już o której możecie być na miejscu? Zwykle dom jest dostępny od 15, ale jeśli Wam na tym zależy może się uda, żeby był dostępny wcześniej, tylko musicie to potwierdzić z Marcinem (numer na dole wiadomości).` : `Dom będzie dostępny dla Was od godziny 16.`} Check-in wygląda tak , że mamy przy górnych drzwiach keylocka - mały sejfik na klucz. Kod do sejfu to 2025. Co do wyjazdu to analogicznie zakładamy wyjazd do godziny 11, a jeśli bardzo Wam zależy żeby było inaczej to możecie porozmawiać o możliwościach z Marcinem.</p>
      <p>jeśli macie jakieś pytania odnośnie godzin przyjazdu i wyjazdu czy rzeczy znajdujących się w domu możecie się skontaktować z managerem obiektu Marcinem, tel 533200016.<br>pozdrawiam,<br>Szymon</p>
    ` : `
      <p>Hi ${firstName},<br><br>thanks for your booking. Your arrival is approaching, so I'm sending some practical information:</p>
      ${petFeeHtml}
      ${paymentHtml}
      <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
      <p><strong>arrival:</strong><br>${isEarlyArrival ? `Do you already know what time you can be there? Usually, the house is available from 3 pm, but if it's important to you, it might be possible to have it available earlier, but you must confirm this with Marcin (number at the bottom of the message).` : `The house will be available for you from 4 pm.`} Check-in looks like this: we have a keylock by the upper door - a small safe for the key. The safe code is 2025. Regarding departure, we similarly assume departure by 11 am, and if it's very important to you to have it otherwise, you can discuss the possibilities with Marcin.</p>
      <p>If you have any questions regarding arrival and departure times or things in the house, you can contact the property manager Marcin at 533200016.<br>Regards,<br>Szymon</p>
    `,
  };
};


// --- THE NEW DYNAMIC LOGIC ---
import { sendGuestEmail } from "../_core/email";

describe("Email Template Dynamic Population", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockBooking: Booking = {
    id: 64,
    icalUid: "test-uid",
    property: "Sadoles",
    channel: "direct",
    checkIn: new Date("2026-07-24T16:00:00Z"),
    checkOut: new Date("2026-07-26T11:00:00Z"),
    status: "confirmed",
    depositStatus: "pending",
    guestName: "Jan Kowalski",
    guestEmail: "jan@example.com",
    guestPhone: "123456789",
    guestCountry: "PL",
    guestCount: 2,
    adultsCount: 2,
    childrenCount: 0,
    animalsCount: 0,
    purpose: "leisure",
    companyName: null,
    nip: null,
    totalPrice: "1800.00",
    amountPaid: "540.00",
    reservationFee: "540.00",
    depositAmount: "500.00",
    commission: "0.00",
    hostRevenue: "1800.00",
    currency: "PLN",
    transferAmount: null,
    transferSender: null,
    transferTitle: null,
    transferDate: null,
    matchScore: null,
    icalSummary: null,
    emailMessageId: null,
    reminderSent: 0,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    type: "normal",
    depositReturnedAt: null,
    invoiceIssued: 0,
    invoiceMonth: null,
    cleaningDate: null,
    cleaningStaff: null,
  };

  it("should match Sadoles Arrival Reminder (PL) with hardcoded ground truth", async () => {
    const expected = getArrivalReminderTemplateOld(mockBooking, true, true);
    await sendGuestEmail("arrival_reminder", mockBooking, { isEarlyArrival: true });

    expect(sendMailMock).toHaveBeenCalled();
    const sentCall = sendMailMock.mock.calls[0][0];
    const sentHtml = sentCall.html;

    expect(sentCall.subject).toBe(expected.subject);
    
    // Check key variables from .env are in the HTML
    expect(sentHtml).toContain("11 1870 1045 2078 1067 6998 0001"); // Bank
    expect(sentHtml).toContain("Szymon Furtak"); // Owner
    expect(sentHtml).toContain("571525563"); // Blik
    expect(sentHtml).toContain("Iwona"); // Manager
    expect(sentHtml).toContain("695-757-149"); // Manager Phone
    expect(sentHtml).toContain("https://docs.google.com/document/d/19D_nH60OJKJCd_K_zggBNqsDEH2wUpWOYaVe2TZqBLc/edit"); // Guide
  });

  it("should match Hacjenda Arrival Reminder (PL) with hardcoded ground truth", async () => {
    const hacjendaBooking = { ...mockBooking, property: "Hacjenda" as const };
    const expected = getArrivalReminderTemplateOld(hacjendaBooking, true, true);

    await sendGuestEmail("arrival_reminder", hacjendaBooking, { isEarlyArrival: true });

    expect(sendMailMock).toHaveBeenCalled();
    const sentCall = sendMailMock.mock.calls[0][0];
    const sentHtml = sentCall.html;

    expect(sentCall.subject).toBe(expected.subject);
    expect(sentHtml).toContain("Marcin"); 
    expect(sentHtml).toContain("533200016");
    expect(sentHtml).toContain("2025"); // Keylock
    expect(sentHtml).toContain("https://docs.google.com/document/d/1neWOvJlLRhKL5IucQGHgwSrhUQhcI5itjKqKRGxKHyc/edit#heading=h.rlwqj2rlo0xk");
  });

  it("should include pet fee section for Booking.com channel", async () => {
    const bookingCom = { ...mockBooking, channel: "booking" as const };

    await sendGuestEmail("arrival_reminder", bookingCom, { isEarlyArrival: true });

    expect(sendMailMock).toHaveBeenCalled();
    const sentHtml = sendMailMock.mock.calls[0][0].html;
    expect(sentHtml).toContain("200 zł za zwierzaka");
    expect(sentHtml).toContain("11 1870 1045 2078 1067 6998 0001");
  });

  // The fee used to reach Booking.com guests only, so a Slowhop or direct guest
  // could arrive with an undeclared animal having never been told it costs
  // anything. These two cases guard the channel-independent behaviour.
  it("tells guests on every channel about the pet fee, not just Booking.com", async () => {
    const slowhop = { ...mockBooking, channel: "slowhop" as const, animalsCount: 0 };

    await sendGuestEmail("arrival_reminder", slowhop, { isEarlyArrival: true });

    const sentHtml = sendMailMock.mock.calls[0][0].html;
    expect(sentHtml).toContain("200 zł za zwierzaka");
    expect(sentHtml).toContain("571525563"); // BLIK — the route the owner prefers
  });

  it("states how many animals the reservation already covers", async () => {
    const withPets = { ...mockBooking, channel: "direct" as const, animalsCount: 2 };

    await sendGuestEmail("arrival_reminder", withPets, { isEarlyArrival: true });

    const sentHtml = sendMailMock.mock.calls[0][0].html;
    expect(sentHtml).toContain("w liczbie 2");
    // The extra-animal offer must survive alongside the declared count.
    expect(sentHtml).toContain("200 zł za zwierzaka");
  });

  it("says plainly when no animal is declared", async () => {
    const noPets = { ...mockBooking, channel: "airbnb" as const, animalsCount: 0 };

    await sendGuestEmail("arrival_reminder", noPets, { isEarlyArrival: true });

    expect(sendMailMock.mock.calls[0][0].html).toContain("nie mamy zgłoszonego żadnego zwierzaka");
  });

  // A portal guest owes the owner the stay minus the zaliczka they already paid
  // the portal — never totalPrice minus what the owner's account has received.
  // The two differ by the portal's forward, and quoting the second is how
  // booking #172 asked Maria Satsiuk for 1238.30 zł when she owed 980.
  it("asks a Slowhop guest for the balance the portal itself states", async () => {
    const satsiuk = {
      ...mockBooking,
      channel: "slowhop" as const,
      property: "Hacjenda" as const,
      totalPrice: "1400.00",
      reservationFee: "420.00",
      commission: "258.30",
      hostRevenue: "1141.70",
      amountPaid: "161.70", // the portal's forward, already received
      depositStatus: "pending" as const,
    };

    await sendGuestEmail("arrival_reminder", satsiuk, { isEarlyArrival: false });

    const sentHtml = sendMailMock.mock.calls[0][0].html;
    // "Pozostała kwota do zapłaty: 980 pln", exactly as the Slowhop mail says.
    expect(sentHtml).toContain("980 zł oraz 500 zł depozytu");
    expect(sentHtml).not.toContain("1238.3");
  });

  it("leaves the portal's own forward out of what it asks an Alohacamp guest for", async () => {
    // Booking #181 before anything has arrived: the account is waiting for
    // 2701.85, of which 176.85 is Alohacamp's to send, not the guest's.
    const kozachenko = {
      ...mockBooking,
      channel: "alohacamp" as const,
      status: "pending" as const,
      totalPrice: "2700.00",
      reservationFee: "675.00",
      commission: "498.15",
      hostRevenue: "2201.85",
      amountPaid: "0.00",
      depositStatus: "pending" as const,
    };

    await sendGuestEmail("arrival_reminder", kozachenko, { isEarlyArrival: false });

    const sentHtml = sendMailMock.mock.calls[0][0].html;
    expect(sentHtml).toContain("2025 zł oraz 500 zł depozytu");
    expect(sentHtml).not.toContain("2700 zł oraz");
  });

  it("asks only for the kaucja once the stay itself is settled", async () => {
    const settled = {
      ...mockBooking,
      channel: "slowhop" as const,
      status: "paid" as const,
      totalPrice: "1400.00",
      reservationFee: "420.00",
      hostRevenue: "1141.70",
      amountPaid: "1141.70",
      depositStatus: "pending" as const,
    };

    await sendGuestEmail("arrival_reminder", settled, { isEarlyArrival: false });

    const sentHtml = sendMailMock.mock.calls[0][0].html;
    expect(sentHtml).toContain("przelew depozytu 500 zł");
    expect(sentHtml).not.toContain("reszty kwoty");
  });
});
