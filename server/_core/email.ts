import nodemailer from "nodemailer";
import type { Booking } from "../../drizzle/schema";
import { format } from "date-fns";
import { SettingRepository } from "../repositories/SettingRepository";
import { ENV } from "./env";
import { PdfGeneratorService } from "../services/PdfGeneratorService";
import { EmailTemplateService, type GuestEmailType, type EmailTemplate } from "../services/EmailTemplateService";

export { type GuestEmailType, type EmailTemplate };

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

export async function getRecipientForEmail(type: GuestEmailType | "alert", booking?: Booking): Promise<string> {
  const adminEmail = await SettingRepository.getAdminEmail();
  if (type === "alert" || type === "missing_data_alert") return adminEmail;
  if (process.env.TEST_MODE === "true") return adminEmail;
  if (!booking?.guestEmail) return adminEmail;
  return booking.guestEmail;
}

export async function sendGuestEmail(type: GuestEmailType, booking: Booking, extraData?: any): Promise<{ success: boolean; recipient: string }> {
  // Global safeguard: if guest name or email is missing, do not send the email
  // (unless it's specifically a missing_data_alert which is intended for the admin)
  // Exception: Airbnb bookings don't have guest email, so we allow them
  const isMissingEssential = !booking.guestName || (!booking.guestEmail && booking.channel !== "airbnb");
  if (type !== "missing_data_alert" && isMissingEssential) {
    console.log(`[Email] Skipping guest email ${type} for booking #${booking.id} due to missing essential data (Name: ${booking.guestName || "Missing"}, Email: ${booking.guestEmail || "Missing"})`);
    return { success: false, recipient: "N/A" };
  }

  const transporter = getTransporter();
  const recipient = await getRecipientForEmail(type, booking);
  if (!transporter) return { success: false, recipient };

  let template: EmailTemplate;
  let language: "PL" | "EN";
  
  if (!booking.guestCountry) {
    // Dual language mode: Polish on top, English underneath
    const templatePL = EmailTemplateService.getTemplates(type, booking, "PL", extraData);
    const templateEN = EmailTemplateService.getTemplates(type, booking, "EN", extraData);
    
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
    template = EmailTemplateService.getTemplates(type, booking, language, extraData);
  }

  const fromName = booking.property === "Sadoles" ? (process.env.SADOLES_NAME ?? "Sadoles") : (process.env.HACJENDA_NAME ?? "Hacjenda");

  const attachments = [];
  if (type === "booking_pending") {
    const pdfBuffer = await PdfGeneratorService.generateContractPDF(booking, language);
    attachments.push({
      filename: language === "PL" 
        ? `Umowa_Najmu_${booking.property}_${format(new Date(booking.checkIn), "yyyy-MM-dd")}.pdf`
        : `Rental_Agreement_${booking.property}_${format(new Date(booking.checkIn), "yyyy-MM-dd")}.pdf`,
      content: pdfBuffer,
    });
    
    // If dual language, also attach English version of the contract if it's booking_pending
    if (!booking.guestCountry) {
      const pdfBufferEN = await PdfGeneratorService.generateContractPDF(booking, "EN");
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
