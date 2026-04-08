import nodemailer from "nodemailer";
import type { Booking } from "../../drizzle/schema";
import { format } from "date-fns";
import { enUS, pl } from "date-fns/locale";
import { predictFirstName } from "./utils";
import { jsPDF } from "jspdf";
import fs from "fs";
import { getAdminEmail } from "../db";
import { ENV } from "./env";

/**
 * Generates the rental contract PDF using jsPDF.
 */
async function generateContractPDF(booking: Booking, language: "PL" | "EN"): Promise<Buffer> {
  const doc = new jsPDF();
  const isPL = language === "PL";
  
  // Load DejaVuSans font for Unicode support (Polish characters)
  const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const fontBoldPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  
  let fontName = "helvetica"; // fallback
  if (fs.existsSync(fontPath)) {
    const fontBase64 = fs.readFileSync(fontPath).toString("base64");
    doc.addFileToVFS("DejaVuSans.ttf", fontBase64);
    doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
    fontName = "DejaVuSans";
  }
  
  if (fs.existsSync(fontBoldPath)) {
    const fontBoldBase64 = fs.readFileSync(fontBoldPath).toString("base64");
    doc.addFileToVFS("DejaVuSans-Bold.ttf", fontBoldBase64);
    doc.addFont("DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
  }

  doc.setFont(fontName);

  const isSadoles = booking.property === "Sadoles";
  const propertyName = isSadoles ? (isPL ? "Sadoleś 66" : "Sadoles 66") : (isPL ? "Hacjenda Kiekrz" : "Hacjenda Kiekrz");
  const address = isSadoles ? ENV.sadolesAddress : ENV.hacjendaAddress;
  const bedrooms = isSadoles ? (isPL ? "5 sypialni" : "5 bedrooms") : (isPL ? "2 sypialnie" : "2 bedrooms");
  
  let purposeText = "";
  if (isPL) {
    purposeText = booking.purpose === "leisure" ? "wypoczynkowym" : 
                  booking.purpose === "company" ? "wyjazd firmowy" : "przeprowadzenie sesji lub nagrań reklamowych";
  } else {
    purposeText = booking.purpose === "leisure" ? "leisure" : 
                  booking.purpose === "company" ? "company trip" : "photo session or commercial recording";
  }
  
  const totalPrice = Math.round(parseFloat(String(booking.totalPrice || "0")) / 10) * 10;
  const reservationFee = parseFloat(String(booking.reservationFee || Math.round((totalPrice * 0.3) / 100) * 100));
  const depositReq = parseFloat(String(booking.depositAmount || "500"));
  
  const checkInDate = new Date(booking.checkIn);
  const checkOutDate = new Date(booking.checkOut);
  const contractDate = format(new Date(booking.createdAt), "dd.MM.yyyy");

  const guestInfo = booking.purpose === "leisure" 
    ? `${booking.guestName || "____________________"}, E-mail: ${booking.guestEmail || "____________________"}`
    : `${booking.companyName || "____________________"}, ${isPL ? "NIP" : "VAT ID"}: ${booking.nip || "__________"}, E-mail: ${booking.guestEmail || "____________________"}`;

  // Helper to add text with wrapping and auto-paging if needed
  let y = 20;
  const addLine = (text: string, size = 10, style = "normal") => {
    doc.setFontSize(size);
    doc.setFont(fontName, style);
    
    // Split text into lines that fit the width (160mm width for safety)
    const lines = doc.splitTextToSize(text, 160);
    const lineHeight = size * 0.5; // Approx line height in mm

    for (const line of lines) {
      // Check if we need a new page before drawing the line
      if (y > 270) {
        doc.addPage();
        y = 20;
        // Re-apply font settings on the new page
        doc.setFont(fontName, style);
        doc.setFontSize(size);
      }
      doc.text(line, 20, y);
      y += lineHeight;
    }
    y += 2; // Extra space after paragraph
  };

  if (isPL) {
    addLine("UMOWA NAJMU KRÓTKOTERMINOWEGO", 14, "bold");
    y += 5;
    addLine(`Zawarta w dniu ${contractDate} pomiędzy:`);
    y += 5;
    addLine("Wynajmującym:", 10, "bold");
    addLine(ENV.businessName);
    addLine(`NIP: ${process.env.BUSINESS_NIP || "__________"}, REGON: ${process.env.BUSINESS_REGON || "__________"}`);
    addLine(`z siedzibą: ${process.env.BUSINESS_ADDRESS || "__________"}`);
    y += 5;
    addLine("a");
    y += 5;
    addLine("Najemcą:", 10, "bold");
    addLine(guestInfo);
    y += 10;

    addLine("§ 1 Przedmiot Umowy", 11, "bold");
    addLine(`Wynajmujący oświadcza, że jest właścicielem nieruchomości (zwanej dalej Lokalem) znajdującej się pod adresem: ${address}.`);
    addLine(`Przedmiotem najmu jest część mieszkalna obejmująca: ${bedrooms}, salon, kuchnię oraz łazienki.`);
    addLine(`Z przedmiotu najmu wyłączone są piwnica oraz ${isSadoles ? "garderoba" : "pomieszczenia gospodarcze"}, w których znajdują się prywatne rzeczy Wynajmującego oraz sprzęt techniczny do obsługi nieruchomości.`);
    addLine("Wynajmujący oświadcza, że Lokal jest wolny od obciążeń na rzecz osób trzecich, które mogłyby uniemożliwić realizację celu umowy.");
    y += 5;

    addLine("§ 2 Termin i Cel Najmu", 11, "bold");
    addLine(`Najem obejmuje okres od dnia ${format(checkInDate, "dd.MM.yyyy")} od godziny 16:00 do dnia ${format(checkOutDate, "dd.MM.yyyy")} do godziny 11:00.`);
    addLine(`Lokal zostaje oddany Najemcy w celu: ${purposeText}.`);
    y += 5;

    addLine("§ 3 Opłaty i Kaucja", 11, "bold");
    addLine(`Z tytułu najmu Najemca zapłaci czynsz w wysokości ${totalPrice} zł (brutto). Wartość ta zawiera 8% podatku VAT.`);
    addLine("Płatność czynszu nastąpi w dwóch częściach:");
    addLine(`I rata (Zaliczka): w kwocie ${reservationFee} zł płatna w terminie 24h od dnia dokonania rezerwacji.`);
    addLine(`II rata (Dopłata): pozostała kwota czynszu w wysokości ${totalPrice - reservationFee} zł płatna najpóźniej na 7 dni przed dniem przyjazdu.`);
    addLine(`Dodatkowo Najemca wpłaci Kaucję zwrotną w wysokości ${depositReq} zł najpóźniej w terminie płatności II raty. Kaucja służy zabezpieczeniu roszczeń Wynajmującego z tytułu ewentualnych szkód lub kar umownych.`);
    addLine(`Wszystkie płatności należy kierować na rachunek: ${ENV.bankAccountNumber}.`);
    addLine("Zwrot wpłaconej zaliczki (I raty) przysługuje Najemcy wyłącznie w przypadku odwołania rezerwacji na co najmniej 28 dni przed planowanym terminem przyjazdu. W pozostałych przypadkach zaliczka przepada na rzecz Wynajmującego.");
    y += 5;

    addLine("§ 4 Zasady Pobytu i Odpowiedzialność", 11, "bold");
    addLine("Najemca ponosi pełną odpowiedzialność materialną za szkody w Lokalu i jego wyposażeniu powstałe z winy Najemcy lub osób trzecich przebywających w Lokalu za jego zgodą.");
    addLine("W Lokalu obowiązuje całkowity zakaz palenia tytoniu i wyrobów powiązanych.");
    addLine("Najemca zobowiązuje się do przestrzegania ciszy nocnej po godzinie 23:00. W przypadku rażącego naruszenia spokoju sąsiadów i interwencji, Wynajmujący ma prawo zatrzymać kaucję w całości jako karę umowną.");
    y += 5;

    addLine("§ 5 Prawa Autorskie i Produkcja Audiowizualna", 11, "bold");
    addLine("Wynajmujący wyraża zgodę na utrwalanie wizerunku Lokalu (wnętrz oraz elewacji) w formie zdjęć, nagrań wideo oraz innych materiałów audiowizualnych w ramach celu określonego w § 2 ust. 2.");
    addLine("Wszelkie efekty prac audiowizualnych powstałe w trakcie najmu stanowią wyłączną własność Najemcy (lub podmiotów przez niego wskazanych).");
    addLine("Wynajmujący oświadcza, że nie będzie rościł sobie żadnych praw autorskich ani majątkowych do powstałych materiałów, ich publikacji, rozpowszechniania czy modyfikacji w przyszłości.");
    y += 5;

    addLine("§ 6 Postanowienia Końcowe", 11, "bold");
    addLine("Wszelkie zmiany umowy wymagają formy pisemnej pod rygorem nieważności.");
    addLine("W sprawach nieuregulowanych umową mają zastosowanie przepisy Kodeksu Cywilnego.");
    addLine("Wpłacenie zaliczki jest równoznaczne z akceptacją regulaminu i warunków niniejszej umowy.");
  } else {
    addLine("SHORT-TERM RENTAL AGREEMENT", 14, "bold");
    y += 5;
    addLine(`Concluded on ${contractDate} between:`);
    y += 5;
    addLine("Lessor:", 10, "bold");
    addLine(ENV.businessName);
    addLine(`Tax ID (NIP): ${process.env.BUSINESS_NIP || "__________"}, REGON: ${process.env.BUSINESS_REGON || "__________"}`);
    addLine(`Registered office: ${process.env.BUSINESS_ADDRESS || "__________"}`);
    y += 5;
    addLine("and");
    y += 5;
    addLine("Lessee:", 10, "bold");
    addLine(guestInfo);
    y += 10;

    addLine("§ 1 Subject of the Agreement", 11, "bold");
    addLine(`The Lessor declares that they are the owner of the property (hereinafter referred to as the Premises) located at: ${address}.`);
    addLine(`The subject of the rental is the residential part including: ${bedrooms}, living room, kitchen, and bathrooms.`);
    addLine(`Excluded from the rental are the basement and ${isSadoles ? "dressing room" : "utility rooms"}, where the Lessor's private belongings and technical equipment for the property's maintenance are located.`);
    addLine("The Lessor declares that the Premises are free from any encumbrances in favor of third parties that could prevent the realization of the purpose of the agreement.");
    y += 5;

    addLine("§ 2 Term and Purpose of Rental", 11, "bold");
    addLine(`The rental covers the period from ${format(checkInDate, "dd.MM.yyyy")} from 4:00 PM until ${format(checkOutDate, "dd.MM.yyyy")} until 11:00 AM.`);
    addLine(`The Premises are handed over to the Lessee for the purpose of: ${purposeText}.`);
    y += 5;

    addLine("§ 3 Fees and Security Deposit", 11, "bold");
    addLine(`For the rental, the Lessee shall pay a rent in the amount of ${totalPrice} PLN (gross). This value includes 8% VAT tax.`);
    addLine("Payment of the rent shall occur in two parts:");
    addLine(`1st installment (Reservation Fee): in the amount of ${reservationFee} PLN payable within 24h from the day of making the reservation.`);
    addLine(`2nd installment (Balance): the remaining rent amount of ${totalPrice - reservationFee} PLN payable at the latest 7 days before the day of arrival.`);
    addLine(`Additionally, the Lessee shall pay a refundable Security Deposit in the amount of ${depositReq} PLN at the latest by the due date of the 2nd installment. The deposit serves to secure the Lessor's claims for potential damages or contractual penalties.`);
    addLine(`All payments should be directed to the account: ${ENV.bankAccountNumber}.`);
    addLine("Refund of the paid reservation fee (1st installment) is entitled to the Lessee only in case of cancellation at least 28 days before the planned arrival date. In other cases, the reservation fee is forfeited to the Lessor.");
    y += 5;

    addLine("§ 4 Rules of Stay and Liability", 11, "bold");
    addLine("The Lessee bears full material responsibility for damages to the Premises and its equipment caused by the fault of the Lessee or third parties staying in the Premises with their consent.");
    addLine("A total ban on smoking tobacco and related products applies in the Premises.");
    addLine("The Lessee undertakes to observe the quiet hours after 11:00 PM. In case of a gross violation of the neighbors' peace and intervention, the Lessor has the right to retain the security deposit in full as a contractual penalty.");
    y += 5;

    addLine("§ 5 Copyrights and Audiovisual Production", 11, "bold");
    addLine("The Lessor agrees to record the image of the Premises (interiors and facade) in the form of photos, video recordings, and other audiovisual materials within the purpose specified in § 2 para. 2.");
    addLine("All effects of audiovisual works created during the rental constitute the exclusive property of the Lessee (or entities indicated by them).");
    addLine("The Lessor declares that they will not claim any copyrights or property rights to the created materials, their publication, distribution, or modification in the future.");
    y += 5;

    addLine("§ 6 Final Provisions", 11, "bold");
    addLine("Any changes to the agreement require a written form under penalty of nullity.");
    addLine("In matters not regulated by the agreement, the provisions of the Civil Code shall apply.");
    addLine("Payment of the reservation fee is equivalent to acceptance of the regulations and terms of this agreement.");
  }

  return Buffer.from(doc.output("arraybuffer"));
}

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

export const GMAIL_USER = ENV.gmailUser;
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
    ? (isPL ? (process.env.SADOLES_GUIDE_PL ?? "#") : (process.env.SADOLES_GUIDE_EN ?? "#"))
    : (isPL ? (process.env.HACJENDA_GUIDE_PL ?? "#") : (process.env.HACJENDA_GUIDE_EN ?? "#"));

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
};

const getTemplates = (type: GuestEmailType, booking: Booking, language: "PL" | "EN", extraData?: any): EmailTemplate => {
  const isPL = language === "PL";
  const firstName = getFirstName(booking.guestName);
  const propertyName = booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz";

  const isSadoles = booking.property === "Sadoles";
  const guideLink = isSadoles 
    ? (isPL ? (process.env.SADOLES_GUIDE_PL ?? "#") : (process.env.SADOLES_GUIDE_EN ?? "#"))
    : (isPL ? (process.env.HACJENDA_GUIDE_PL ?? "#") : (process.env.HACJENDA_GUIDE_EN ?? "#"));

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

      const bookingDetailsPL = `
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Szczegóły rezerwacji:</h3>
          <p style="margin-bottom: 5px;"><b>Obiekt:</b> ${booking.property === "Sadoles" ? "Sadoleś 66" : "Hacjenda Kiekrz"}</p>
          <p style="margin-bottom: 5px;"><b>Termin:</b> ${checkInFormatted} - ${checkOutFormatted}</p>
          <p style="margin-bottom: 5px;"><b>Gość:</b> ${booking.guestName || booking.companyName || "---"} (${booking.guestEmail})</p>
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
          <p style="margin-bottom: 5px;"><b>Guest:</b> ${booking.guestName || booking.companyName || "---"} (${booking.guestEmail})</p>
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
      return getArrivalReminderTemplate(booking, isPL, extraData?.isEarlyArrival ?? true);
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

export async function getRecipientForEmail(type: GuestEmailType | "alert", booking?: Booking): Promise<string> {
  const adminEmail = await getAdminEmail();
  if (type === "alert" || type === "missing_data_alert") return adminEmail;
  if (process.env.TEST_MODE === "true") return adminEmail;
  if (!booking?.guestEmail) return adminEmail;
  return booking.guestEmail;
}

export async function sendGuestEmail(type: GuestEmailType, booking: Booking, extraData?: any): Promise<{ success: boolean; recipient: string }> {
  const transporter = getTransporter();
  const recipient = await getRecipientForEmail(type, booking);
  if (!transporter) return { success: false, recipient };

  let template: EmailTemplate;
  let language: "PL" | "EN";
  
  if (!booking.guestCountry) {
    // Dual language mode: Polish on top, English underneath
    const templatePL = getTemplates(type, booking, "PL", extraData);
    const templateEN = getTemplates(type, booking, "EN", extraData);
    
    template = {
      subject: `${templatePL.subject} / ${templateEN.subject}`,
      html: `
        <div class="email-pl">
          ${templatePL.html}
        </div>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <div class="email-en" style="color: #666;">
          ${templateEN.html}
        </div>
      `,
    };
    language = "PL"; // Default language for attachments/PDFs
  } else {
    language = booking.guestCountry === "PL" ? "PL" : "EN";
    template = getTemplates(type, booking, language, extraData);
  }

  const fromName = booking.property === "Sadoles" ? (process.env.SADOLES_NAME ?? "Sadoles") : (process.env.HACJENDA_NAME ?? "Hacjenda");

  const attachments = [];
  if (type === "booking_pending") {
    const pdfBuffer = await generateContractPDF(booking, language);
    attachments.push({
      filename: language === "PL" 
        ? `Umowa_Najmu_${booking.property}_${format(new Date(booking.checkIn), "yyyy-MM-dd")}.pdf`
        : `Rental_Agreement_${booking.property}_${format(new Date(booking.checkIn), "yyyy-MM-dd")}.pdf`,
      content: pdfBuffer,
    });
    
    // If dual language, also attach English version of the contract if it's booking_pending
    if (!booking.guestCountry) {
      const pdfBufferEN = await generateContractPDF(booking, "EN");
      attachments.push({
        filename: `Rental_Agreement_${booking.property}_${format(new Date(booking.checkIn), "yyyy-MM-dd")}.pdf`,
        content: pdfBufferEN,
      });
    }
  }

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${GMAIL_USER}>`,
      to: recipient,
      subject: template.subject,
      html: template.html,
      attachments,
    });
    console.log(`[Email] Sent ${type} for booking #${booking.id} to ${recipient} with ${attachments.length} attachments`);
    return { success: true, recipient };
  } catch (err) {
    console.error(`[Email] Failed to send ${type} for booking #${booking.id}:`, err);
    return { success: false, recipient };
  }
}

export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const transporter = getTransporter();
  const adminEmail = await getRecipientForEmail("alert");
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${GMAIL_USER}>`,
      to: adminEmail,
      subject,
      text,
    });
    console.log(`[Email] Sent alert: ${subject} to ${adminEmail}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send alert to ${adminEmail}:`, err);
    return false;
  }
}

/**
 * Forwards an unrecognized or unmatched email to the admin.
 */
export async function forwardUnmatchedEmail(
  email: { from: string; subject: string; body: string },
  candidates: Array<{ bookingId: number; score: number; guestName: string | null; checkIn: Date; property: string }> = [],
  reason: string = "unmatched"
): Promise<boolean> {
  const transporter = getTransporter();
  const adminEmail = await getRecipientForEmail("alert");
  if (!transporter) return false;

  const top3 = candidates.slice(0, 3);
  const candidatesList = top3.length > 0 
    ? top3.map(c => `- Booking #${c.bookingId}: ${c.guestName || "Unknown"} (${c.property}, ${format(new Date(c.checkIn), "dd.MM.yyyy")}) - Score: ${c.score}`).join("\n")
    : "No candidates found.";

  const reasonText = reason === "unrecognized" 
    ? "THIS EMAIL WAS NOT RECOGNIZED BY ANY PARSER."
    : "THIS EMAIL WAS NOT AUTOMATICALLY MATCHED TO ANY BOOKING.";

  const text = `
    ${reasonText}
    It is being forwarded for manual review.

    --- Potential Matches (Top 3) ---
    ${candidatesList}

    --- Original Email ---
    From: ${email.from}
    Subject: ${email.subject}
    
    ${email.body}
  `.trim();

  try {
    await transporter.sendMail({
      from: `"Rental Manager" <${GMAIL_USER}>`,
      to: adminEmail,
      subject: `Fwd: [${reason.toUpperCase()}] ${email.subject}`,
      text,
    });
    console.log(`[Email] Forwarded ${reason} email to ${adminEmail}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to forward email:`, err);
    return false;
  }
}
