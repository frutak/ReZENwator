import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import type { Booking } from "../../drizzle/schema";
import { predictFirstName, getGuestName } from "../_core/utils";
import { ENV } from "../_core/env";

export type GuestEmailType =
  | "booking_pending"
  | "booking_confirmed"
  | "booking_cancelled_no_payment"
  | "arrival_reminder"
  | "stay_finished"
  | "missing_data_alert";

export interface EmailTemplate {
  subject: string;
  html: string;
}

export class EmailTemplateService {
  private static getDayOfWeek(date: Date, isPL: boolean): string {
    if (isPL) {
      const days = ["W niedzielę", "W poniedziałek", "We wtorek", "W środę", "W czwartek", "W piątek", "W sobotę"];
      return days[date.getDay()];
    }
    return `On ${format(date, "EEEE", { locale: enUS })}`;
  }

  private static getArrivalReminderTemplate(booking: Booking, isPL: boolean, isEarlyArrival: boolean): EmailTemplate {
    const displayName = getGuestName(booking);
    const firstName = predictFirstName(displayName);
    const isSadoles = booking.property === "Sadoles";
    const checkInDate = new Date(booking.checkIn);
    const dayOfWeek = this.getDayOfWeek(checkInDate, isPL);
    
    const guideLink = isSadoles 
      ? (isPL ? ENV.sadolesGuidePl : ENV.sadolesGuideEn)
      : (isPL ? ENV.hacjendaGuidePl : ENV.hacjendaGuideEn);

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
        <p>Czy planujecie przyjechać ze zwierzętami? Zapraszamy także futrzastych i kudłatych gości, pobyt psa lub kota kosztuje 200 zł za zwierzaka, płatności można dokonać przelewem na numer konta ${ENV.bankAccountNumber}, Nazwisko do przelewu: ${ENV.ownerName}, lub blikiem na numer ${ENV.blikNumber} (koniecznie napisz, o który pobyt chodzi oraz że jest to opłata za zwierzaka). W razie pytań dawaj znać.</p>
      ` : `
        <p>Are you planning to come with pets? We also welcome furry and shaggy guests, the stay of a dog or cat costs 200 PLN per pet, payment can be made by transfer to account number ${ENV.bankAccountNumber}, transfer name: ${ENV.ownerName}, or by BLIK to number ${ENV.blikNumber} (be sure to write which stay it is and that it is a pet fee). If you have any questions, let me know.</p>
      `;
    }

    let paymentHtml = "";
    if (needsPaymentInfo) {
      paymentHtml = isPL ? `
        <p><strong>reszta opłaty za pobyt:</strong><br>
        prosiłbym o przelew reszty - ${remaining} zł + ${deposit} zł zwrotnego depozytu, na moje konto, ${isSadoles ? "najlepiej tak na 5 dni przed Waszym przyjazdem" : "tak najpóźniej tydzień przed Waszym przyjazdem"}:<br>
        ${ENV.bankAccountNumber}<br>
        Nazwisko do przelewu: ${ENV.ownerName}</p>
      ` : `
        <p><strong>Balance of the stay fee:</strong><br>
        I would like to ask for a transfer of the balance - ${remaining} PLN + ${deposit} PLN refundable deposit, to my account, ${isSadoles ? "preferably 5 days before your arrival" : "at the latest one week before your arrival"}:<br>
        ${ENV.bankAccountNumber}<br>
        Account name: ${ENV.ownerName}</p>
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
          <p><strong>przyjazd:</strong><br>czy wiesz już o której mniej więcej planujecie przyjechać? ${dayOfWeek} dom powinien być dla Was dostępny ${arrivalTimePL}, tylko zależnie od godziny Waszego przyjazdu albo ${ENV.sadolesManagerName} będzie czekać na Was w domu albo zostawimy Wam klucz w umówionym miejscu. W tym wypadku jeśli będziecie mieli jakieś pytania po przyjeździe to po prostu możecie zadzwonić do mnie lub do ${ENV.sadolesManagerName}.<br>
          mój numer: ${ENV.blikNumber}<br>
          numer ${ENV.sadolesManagerName}: ${ENV.sadolesManagerPhone}<br>
          Co do wyjazdu: zwykle ustalamy godzinę wyjazdu na 11, jeśli Wam zależy żeby było później to dajcie znać.</p>
          <p>dajcie znać, jeśli macie jakieś pytania!<br>pozdrawiam,<br>${ENV.ownerName.split(" ")[0]}</p>
        ` : `
          <p>Hi ${firstName},<br>Your arrival is approaching, so here are a few organizational details from my side:</p>
          ${petFeeHtml}
          ${paymentHtml}
          <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
          <p><strong>arrival:</strong><br>Do you already know roughly what time you plan to arrive? ${dayOfWeek}, the house should be available for you ${arrivalTimeEN}. Depending on your arrival time, either ${ENV.sadolesManagerName} will be waiting for you at the house or we will leave the key for you in an agreed place. In that case, if you have any questions after arrival, you can simply call me or ${ENV.sadolesManagerName}.<br>
          My number: ${ENV.blikNumber}<br>
          ${ENV.sadolesManagerName}'s number: ${ENV.sadolesManagerPhone}<br>
          Regarding departure: we usually set the departure time to 11 am. If you would like it to be later, please let me know.</p>
          <p>Let me know if you have any questions!<br>Regards,<br>${ENV.ownerName.split(" ")[0]}</p>
        `,
      };
    }

    const arrivalHacjendaPL = isEarlyArrival 
      ? `Czy wiecie już o której możecie być na miejscu? Zwykle dom jest dostępny od 15, ale jeśli Wam na tym zależy może się uda, żeby był dostępny wcześniej, tylko musicie to potwierdzić z ${ENV.hacjendaManagerName} (numer na dole wiadomości).`
      : `Dom będzie dostępny dla Was od godziny 16.`;
    
    const arrivalHacjendaEN = isEarlyArrival 
      ? `Do you already know what time you can be there? Usually, the house is available from 3 pm, but if it's important to you, it might be possible to have it available earlier, but you must confirm this with ${ENV.hacjendaManagerName} (number at the bottom of the message).`
      : `The house will be available for you from 4 pm.`;

    return {
      subject: isPL ? `Twój przyjazd do Hacjendy - ${format(checkInDate, "dd.MM")}` : `Your stay at Hacjenda - ${format(checkInDate, "dd.MM")}`,
      html: isPL ? `
        <p>Cześć ${firstName},<br><br>dzięki za Waszą rezerwację. Zbliża się termin Waszego przyjazdu, więc przesyłam kilka informacji praktycznych:</p>
        ${petFeeHtml}
        ${paymentHtml}
        <p><strong>przewodnik:</strong><br>załączam przewodnik po domu i okolicy, który przygotowaliśmy dla naszych gości:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>przyjazd:</strong><br>${arrivalHacjendaPL} Check-in wygląda tak , że mamy przy górnych drzwiach keylocka - mały sejfik na klucz. Kod do sejfu to ${ENV.hacjendaKeylockCode}. Co do wyjazdu to analogicznie zakładamy wyjazd do godziny 11, a jeśli bardzo Wam zależy żeby było inaczej to możecie porozmawiać o możliwościach z ${ENV.hacjendaManagerName}.</p>
        <p>jeśli macie jakieś pytania odnośnie godzin przyjazdu i wyjazdu czy rzeczy znajdujących się w domu możecie się skontaktować z managerem obiektu ${ENV.hacjendaManagerName}, tel ${ENV.hacjendaManagerPhone}.<br>pozdrawiam,<br>${ENV.ownerName.split(" ")[0]}</p>
      ` : `
        <p>Hi ${firstName},<br><br>thanks for your booking. Your arrival is approaching, so I'm sending some practical information:</p>
        ${petFeeHtml}
        ${paymentHtml}
        <p><strong>guide:</strong><br>I am attaching a guide to the house and the area that we have prepared for our guests:<br><a href="${guideLink}">${guideLink}</a></p>
        <p><strong>arrival:</strong><br>${arrivalHacjendaEN} Check-in looks like this: we have a keylock by the upper door - a small safe for the key. The safe code is ${ENV.hacjendaKeylockCode}. Regarding departure, we similarly assume departure by 11 am, and if it's very important to you to have it otherwise, you can discuss the possibilities with ${ENV.hacjendaManagerName}.</p>
        <p>If you have any questions regarding arrival and departure times or things in the house, you can contact the property manager ${ENV.hacjendaManagerName} at ${ENV.hacjendaManagerPhone}.<br>Regards,<br>${ENV.ownerName.split(" ")[0]}</p>
      `,
    };
  }

  static getTemplates(type: GuestEmailType, booking: Booking, language: "PL" | "EN", extraData?: any): EmailTemplate {
    const isPL = language === "PL";
    const displayName = getGuestName(booking);
    const firstName = predictFirstName(displayName);
    const propertyName = booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz";

    switch (type) {
      case "booking_pending":
        const totalPriceVal = Math.round(parseFloat(String(booking.totalPrice || 0)) / 10) * 10;
        const reservationFee = parseFloat(String(booking.reservationFee || Math.round((totalPriceVal * 0.3) / 100) * 100));
        const depositAmount = parseFloat(String(booking.depositAmount || 0));
        const leftover = totalPriceVal - reservationFee;
        const propertyLocativeName = booking.property === "Sadoles" ? "Sadolesiu 66" : "Hacjendzie Kiekrz";
        const propertyNameEN = booking.property === "Sadoles" ? "Sadoles 66" : "Hacjenda Kiekrz";
        
        const checkInFormatted = format(new Date(booking.checkIn), "dd.MM.yyyy");
        const checkOutFormatted = format(new Date(booking.checkOut), "dd.MM.yyyy");
        
        const purposeMapPL: Record<string, string> = {
          leisure: "wypoczynkowy",
          production: "sesja/nagrania",
          company: "wyjazd firmowy"
        };
        const purposeMapEN: Record<string, string> = {
          leisure: "leisure",
          production: "photo session/recording",
          company: "company trip"
        };

        const bookingEmailDisplay = booking.guestEmail || (booking.channel === "airbnb" ? "Airbnb - no guest email" : "---");

        const bookingDetailsPL = `
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Szczegóły rezerwacji:</h3>
            <p style="margin-bottom: 5px;"><b>Obiekt:</b> ${booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz"}</p>
            <p style="margin-bottom: 5px;"><b>Termin:</b> ${checkInFormatted} - ${checkOutFormatted}</p>
            <p style="margin-bottom: 5px;"><b>Gość:</b> ${displayName} (${bookingEmailDisplay})</p>
            <p style="margin-bottom: 5px;"><b>Liczba osób:</b> ${booking.guestCount}</p>
            ${booking.animalsCount ? `<p style="margin-bottom: 5px;"><b>Zwierzęta:</b> ${booking.animalsCount}</p>` : ""}
            <p style="margin-bottom: 5px;"><b>Cel pobytu:</b> ${purposeMapPL[booking.purpose || "leisure"]}</p>
            <p style="margin-bottom: 5px;"><b>Całkowita kwota pobytu:</b> ${totalPriceVal} PLN</p>
            <p style="margin-bottom: 0;"><b>Kaucja zwrotna (płatna później):</b> ${depositAmount} PLN</p>
          </div>
        `;

        const bookingDetailsEN = `
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Booking Details:</h3>
            <p style="margin-bottom: 5px;"><b>Property:</b> ${propertyNameEN}</p>
            <p style="margin-bottom: 5px;"><b>Dates:</b> ${checkInFormatted} - ${checkOutFormatted}</p>
            <p style="margin-bottom: 5px;"><b>Guest:</b> ${displayName} (${bookingEmailDisplay})</p>
            <p style="margin-bottom: 5px;"><b>Guests:</b> ${booking.guestCount}</p>
            ${booking.animalsCount ? `<p style="margin-bottom: 5px;"><b>Pets:</b> ${booking.animalsCount}</p>` : ""}
            <p style="margin-bottom: 5px;"><b>Purpose of stay:</b> ${purposeMapEN[booking.purpose || "leisure"]}</p>
            <p style="margin-bottom: 5px;"><b>Total stay amount:</b> ${totalPriceVal} PLN</p>
            <p style="margin-bottom: 0;"><b>Refundable security deposit (paid later):</b> ${depositAmount} PLN</p>
          </div>
        `;

        return {
          subject: isPL ? `Twoja rezerwacja w ${propertyLocativeName} - oczekuje na wpłatę` : `Your reservation at ${propertyNameEN} - awaiting payment`,
          html: isPL ? `
            <p>Cześć ${firstName},</p>
            <p>Dziękujemy za dokonanie rezerwacji w ${propertyLocativeName}, wybrane przez Ciebie daty zostały dla Ciebie tymczasowo zablokowane.</p>
            ${bookingDetailsPL}
            <p>Żeby potwierdzić rezerwację, musisz <b>w ciągu 24h</b> dokonać przelewu <b>zaliczki</b> na kwotę <b>${reservationFee} PLN</b> na nasz numer konta:</p>
            <p>${ENV.businessName}, ${ENV.bankAccountNumber}</p>
            <p>Jeśli wolisz płatności w innej walucie lub masz jakieś inne pytania co do płatności - daj znam znać jak najszybciej.</p>
            <p>Resztę opłaty (<b>${leftover} PLN</b>) oraz kaucję zwrotną (<b>${depositAmount} PLN</b>) masz do zapłacenia najpóźniej na tydzień przed przyjazdem. Wszystkie szczegóły są w załączonej umowie.</p>
            <p>Jeśli masz jakieś pytania co do płatności, umowy lub pobytu - daj nam znać!</p>
            <p>pozdrawiam i mam nadzieję, do zobaczenia!<br>${ENV.ownerName.split(" ")[0]}</p>
          ` : `
            <p>Hi ${firstName},</p>
            <p>Thank you for booking at ${propertyNameEN}, the dates you selected have been temporarily blocked for you.</p>
            ${bookingDetailsEN}
            <p>To confirm your reservation, you must <b>within 24 hours</b> make a transfer of the <b>reservation fee</b> in the amount of <b>${reservationFee} PLN</b> to our account number:</p>
            <p>${ENV.businessName}, ${ENV.bankAccountNumber}</p>
            <p>If you prefer payment in another currency or have any other questions regarding payment - let us know as soon as possible.</p>
            <p>The rest of the fee (<b>${leftover} PLN</b>) and the refundable security deposit (<b>${depositAmount} PLN</b>) must be paid at the latest one week before arrival. All details are in the attached agreement.</p>
            <p>If you have any questions regarding payment, agreement or stay - let us know!</p>
            <p>Regards and I hope to see you!<br>${ENV.ownerName.split(" ")[0]}</p>
          `
        };
      case "booking_cancelled_no_payment":
        return {
          subject: isPL ? `Anulowanie rezerwacji w ${propertyName}` : `Cancellation of reservation at ${propertyName}`,
          html: isPL ? `
            <p>Cześć ${firstName},</p>
            <p>Niestety nie otrzymaliśmy wpłaty zaliczki za Twój pobyt w ${propertyName} i tym samym usuwamy Twoją rezerwację.</p>
            <p>Jeśli wpłata została wysłana lub nadal chcesz do nas przyjechać, prosimy o pilny kontakt.</p>
            <p>Pozdrawiamy,<br>${ENV.ownerName.split(" ")[0]}</p>
          ` : `
            <p>Hi ${firstName},</p>
            <p>Unfortunately we have not received the reservation fee for your stay in ${propertyName} and we hereby remove your reservation.</p>
            <p>If you have sent the fee or you would still like to come please contact us asap.</p>
            <p>Regards,<br>${ENV.ownerName.split(" ")[0]}</p>
          `
        };
      case "booking_confirmed":
        const propertyLocative = booking.property === "Sadoles" ? "Sadolesiu" : "Hacjendzie";
        return {
          subject: isPL ? `Do zobaczenia w ${propertyLocative}` : `See you in ${booking.property}`,
          html: isPL 
            ? `<p>Cześć ${firstName},<br><br>Cieszymy się, że planujesz przyjazd do ${propertyName}. Bliżej terminu przyjazdu prześlemy Ci wszystkie informacje, a póki co pamiętaj, że możesz się z nami skontaktować jeśli tylko będziesz mieć jakieś pytania.<br><br>Do zobaczenia!<br>${ENV.ownerName.split(" ")[0]}, ${propertyName}</p>`
            : `<p>Hi ${firstName},<br><br>We are glad you are planning a visit to ${propertyName}. Closer to your arrival date, we will send you all the necessary information. In the meantime, remember that you can contact us if you have any questions.<br><br>See you!<br>${ENV.ownerName.split(" ")[0]}, ${propertyName}</p>`,
        };
      case "arrival_reminder":
        return this.getArrivalReminderTemplate(booking, isPL, extraData?.isEarlyArrival ?? true);
      case "stay_finished":
        return {
          subject: isPL ? "Podziękowanie za pobyt" : "Thank you for your stay",
          html: isPL
            ? `<p>Cześć ${firstName},<br>Mam nadzieję, że Wasz pobyt się udał. Z naszej perspektywy wszystko było ok więc wlasnie zrobiłem przelew zwrotny depozytu.<br>Dziękuję jeszcze raz i mam nadzieję do zobaczenia!<br>${ENV.ownerName.split(" ")[0]}</p>`
            : `<p>Hi ${firstName},<br>I hope your stay was enjoyable. Everything was fine on our end, so I have just processed the refund of your deposit.<br>Thank you once again and I hope to see you!<br>${ENV.ownerName.split(" ")[0]}</p>`,
        };
      case "missing_data_alert":
        const missingFields = [];
        if (!booking.guestCountry) missingFields.push("Country");
        if (displayName === "Unknown guest") missingFields.push("Guest Name / Company Name");
        if (!booking.guestEmail && booking.channel !== "airbnb") missingFields.push("Email");
        if (!["airbnb", "booking"].includes(booking.channel) && booking.totalPrice === null) missingFields.push("Total Price");
        
        return {
          subject: `Action Required: Missing Data for Booking #${booking.id} (${displayName})`,
          html: `<p>The following information is missing for an upcoming booking:</p>
                 <ul>${missingFields.map(f => `<li>${f}</li>`).join("")}</ul>
                 <p>Please update the booking details so the reminder email can be sent correctly.</p>
                 <p>Property: ${booking.property}<br>Check-in: ${format(new Date(booking.checkIn), "yyyy-MM-dd")}</p>`,
        };
      default:
        throw new Error("Unknown email type");
    }
  }
}
