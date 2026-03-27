import nodemailer from "nodemailer";
import type { Booking } from "../../drizzle/schema";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { predictFirstName } from "./utils";

const TEST_RECIPIENT = "szymonfurtak@hotmail.com";

export type GuestEmailType =
  | "booking_confirmed"
  | "arrival_reminder"
  | "stay_finished"
  | "missing_data_alert";

export interface EmailTemplate {
  subject: string;
  html: string;
}

export const GMAIL_USER = process.env.GMAIL_USER || "furtka.rentals@gmail.com";
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || "";

export const getTransporter = () => {
  if (!GMAIL_PASS) {
    console.warn("[Email] Gmail credentials not configured, skipping email");
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
};

const getFirstName = (name: string | null): string => {
  return predictFirstName(name);
};

const getDayOfWeek = (date: Date, isPL: boolean): string => {
  if (isPL) {
    const days = ["W niedzielę", "W poniedziałek", "We wtorek", "W środę", "W czwartek", "W piątek", "W sobotę"];
    return days[date.getDay()];
  }
  return `On ${format(date, "EEEE", { locale: enUS })}`;
};

const getArrivalReminderTemplate = (booking: Booking, isPL: boolean, isEarlyArrival: boolean): EmailTemplate => {
  const firstName = getFirstName(booking.guestName);
  const isSadoles = booking.property === "Sadoles";
  const checkInDate = new Date(booking.checkIn);
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
        ${paymentHtml}
        <p><strong>przewodnik:</strong><br>załączam przewodnik po domu i okolicy, który przygotowaliśmy dla naszych gości:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>przyjazd:</strong><br>czy wiesz już o której mniej więcej planujecie przyjechać? ${dayOfWeek} dom powinien być dla Was dostępny ${arrivalTimePL}, tylko zależnie od godziny Waszego przyjazdu albo Iwona (nasza sąsiadka) będzie czekać na Was w domu albo zostawimy Wam klucz w umówionym miejscu. W tym wypadku jeśli będziecie mieli jakieś pytania po przyjeździe to po prostu możecie zadzwonić do mnie lub do Iwony.<br>
        mój numer: 571 525 563<br>
        numer Iwony 695-757-149<br>
        Co do wyjazdu: zwykle ustalamy godzinę wyjazdu na 11, jeśli Wam zależy żeby było później to dajcie znać.</p>
        <p>dajcie znać, jeśli macie jakieś pytania!<br>pozdrawiam,<br>Szymon</p>
      ` : `
        <p>Hi ${firstName},<br>Your arrival is approaching, so here are a few organizational details from my side:</p>
        ${paymentHtml}
        <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>arrival:</strong><br>Do you already know roughly what time you plan to arrive? ${dayOfWeek}, the house should be available for you ${arrivalTimeEN}. Depending on your arrival time, either Iwona (our neighbor) will be waiting for you at the house or we will leave the key for you in an agreed place. In that case, if you have any questions after arrival, you can simply call me or Iwona.<br>
        My number: 571 525 563<br>
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
      ${paymentHtml}
      <p><strong>przewodnik:</strong><br>załączam przewodnik po domu i okolicy, który przygotowaliśmy dla naszych gości:<br><a href="${guideLink}">${guideLink}</a></p>
      <p><strong>przyjazd:</strong><br>Czy wiecie już o której możecie być na miejscu? Zwykle dom jest dostępny od 15, ale jeśli Wam na tym zależy może się uda, żeby był dostępny wcześniej, tylko musicie to potwierdzić z Marcinem (numer na dole wiadomości). Check-in wygląda tak , że mamy przy górnych drzwiach keylocka - mały sejfik na klucz. Kod do sejfu to 2025. Co do wyjazdu to analogicznie zakładamy wyjazd do godziny 11, a jeśli bardzo Wam zależy żeby było inaczej to możecie porozmawiać o możliwościach z Marcinem.</p>
      <p>jeśli macie jakieś pytania odnośnie godzin przyjazdu i wyjazdu czy rzeczy znajdującycj się w domu możecie się skontaktować z Marcinem, tel 533200016.<br>pozdrawiam,<br>Szymon</p>
    ` : `
      <p>Hi ${firstName},<br><br>thanks for your booking. Your arrival is approaching, so I'm sending some practical information:</p>
      ${paymentHtml}
      <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
      <p><strong>arrival:</strong><br>Do you already know what time you can be there? Usually, the house is available from 3 pm, but if it's important to you, it might be possible to have it available earlier, but you must confirm this with Marcin (number at the bottom of the message). Check-in looks like this: we have a keylock by the upper door - a small safe for the key. The safe code is 2025. Regarding departure, we similarly assume departure by 11 am, and if it's very important to you to have it otherwise, you can discuss the possibilities with Marcin.</p>
      <p>If you have any questions regarding arrival and departure times or things in the house, you can contact Marcin at 533200016.<br>Regards,<br>Szymon</p>
    `,
  };
};

const getTemplates = (type: GuestEmailType, booking: Booking, language: "PL" | "EN", extraData?: any): EmailTemplate => {
  const isPL = language === "PL";
  const firstName = getFirstName(booking.guestName);
  const propertyName = booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz";

  switch (type) {
    case "booking_confirmed":
      const propertyLocative = booking.property === "Sadoles" ? "Sadolesiu" : "Hacjendzie";
      return {
        subject: isPL ? `Do zobaczenia w ${propertyLocative}` : `See you in ${booking.property}`,
        html: isPL 
          ? `<p>Cześć ${firstName},<br><br>Cieszymy się, że planujesz przyjazd do ${propertyName}. Bliżej terminu przyjazdu prześlemy Ci wszystkie informacje, a póki co pamiętaj, że możesz się z nami skontaktować jeśli tylko będziesz mieć jakieś pytania.<br><br>Do zobaczenia!<br>Szymon, ${propertyName}</p>`
          : `<p>Hi ${firstName},<br><br>We are glad you are planning a visit to ${propertyName}. Closer to your arrival date, we will send you all the necessary information. In the meantime, remember that you can contact us if you have any questions.<br><br>See you!<br>Szymon, ${propertyName}</p>`,
      };
    case "arrival_reminder":
      return getArrivalReminderTemplate(booking, isPL, extraData?.isEarlyArrival ?? true);
    case "stay_finished":
      return {
        subject: isPL ? "Podziękowanie za pobyt" : "Thank you for your stay",
        html: isPL
          ? `<p>Cześć ${firstName},<br>Mam nadzieję, że Wasz pobyt się udał. Z naszej perspektywy wszystko było ok więc wlasnie zrobiłam przelew zwrotny depozytu.<br>Dziękuję jeszcze raz i mam nadzieję do zobaczenia!<br>Szymon</p>`
          : `<p>Hi ${firstName},<br>I hope your stay was enjoyable. Everything was fine on our end, so I have just processed the refund of your deposit.<br>Thank you once again and I hope to see you!<br>Szymon</p>`,
      };
    case "missing_data_alert":
      const missingFields = [];
      if (!booking.guestCountry) missingFields.push("Country");
      if (!booking.guestName) missingFields.push("Guest Name");
      if (!["airbnb", "booking"].includes(booking.channel) && booking.totalPrice === null) missingFields.push("Total Price");
      
      return {
        subject: `Action Required: Missing Data for Booking #${booking.id} (${booking.guestName})`,
        html: `<p>The following information is missing for an upcoming booking:</p>
               <ul>${missingFields.map(f => `<li>${f}</li>`).join("")}</ul>
               <p>Please update the booking details so the reminder email can be sent correctly.</p>
               <p>Property: ${booking.property}<br>Check-in: ${format(new Date(booking.checkIn), "yyyy-MM-dd")}</p>`,
      };
    default:
      throw new Error("Unknown email type");
  }
};

export async function sendGuestEmail(type: GuestEmailType, booking: Booking, extraData?: any): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  const language = booking.guestCountry === "PL" ? "PL" : "EN";
  const template = getTemplates(type, booking, language, extraData);

  const fromName = booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz";

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${GMAIL_USER}>`,
      to: TEST_RECIPIENT,
      subject: template.subject,
      html: template.html,
    });
    console.log(`[Email] Sent ${type} for booking #${booking.id} to ${TEST_RECIPIENT}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send ${type} for booking #${booking.id}:`, err);
    return false;
  }
}

export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${GMAIL_USER}>`,
      to: TEST_RECIPIENT,
      subject,
      text,
    });
    console.log(`[Email] Sent alert: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send alert:`, err);
    return false;
  }
}
