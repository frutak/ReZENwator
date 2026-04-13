import { jsPDF } from "jspdf";
import fs from "fs";
import { format } from "date-fns";
import type { Booking } from "../../drizzle/schema";
import { ENV } from "../_core/env";

export class PdfGeneratorService {
  /**
   * Generates the rental contract PDF using jsPDF.
   */
  static async generateContractPDF(booking: Booking, language: "PL" | "EN"): Promise<Buffer> {
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
      
      const lines = doc.splitTextToSize(text, 160);
      const lineHeight = size * 0.5;

      for (const line of lines) {
        if (y > 270) {
          doc.addPage();
          y = 20;
          doc.setFont(fontName, style);
          doc.setFontSize(size);
        }
        doc.text(line, 20, y);
        y += lineHeight;
      }
      y += 2;
    };

    if (isPL) {
      addLine("UMOWA NAJMU KRÓTKOTERMINOWEGO", 14, "bold");
      y += 5;
      addLine(`Zawarta w dniu ${contractDate} pomiędzy:`);
      y += 5;
      addLine("Wynajmującym:", 10, "bold");
      addLine(ENV.businessName);
      addLine(`NIP: ${ENV.businessNip}, REGON: ${ENV.businessRegon}`);
      addLine(`z siedzibą: ${ENV.businessAddress}`);
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
      addLine(`Tax ID (NIP): ${ENV.businessNip}, REGON: ${ENV.businessRegon}`);
      addLine(`Registered office: ${ENV.businessAddress}`);
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
}
