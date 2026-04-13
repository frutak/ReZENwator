import { ENV } from "../_core/env";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { BookingRepository } from "../repositories/BookingRepository";
import { qualifyEmail, QualifiedEmail, ParsedBookingData, ParsedBankData } from "./emailParsers";
import { findMatchingBookings, applyTransferMatch } from "./bookingMatcher";
import { sendAlertEmail, forwardUnmatchedEmail } from "../_core/email";
import { Logger } from "../_core/logger";
import { initialStatus, initialDepositStatus } from "./icalPoller";
import { format } from "date-fns";

// ─── Configuration ────────────────────────────────────────────────────────────

function getGmailConfig() {
  return {
    user: ENV.gmailUser,
    password: process.env.GMAIL_APP_PASSWORD || "",
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  };
}

const AUTO_MATCH_THRESHOLD = 80;

// ─── IMAP helpers ─────────────────────────────────────────────────────────────

async function fetchEmails(testMode: boolean): Promise<
  Array<{ uid: number; from: string; subject: string; body: string; messageId: string }>
> {
  const config = getGmailConfig();
  const imap = new Imap(config);
  
  return new Promise((resolve, reject) => {
    const emails: Array<{ uid: number; from: string; subject: string; body: string; messageId: string }> = [];
    let isFinished = false;

    const cleanup = () => {
      if (!isFinished) {
        isFinished = true;
        imap.end();
      }
    };

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) { cleanup(); return reject(err); }

        const searchCriteria = testMode ? ["ALL"] : ["UNSEEN"];
        imap.search(searchCriteria, (searchErr, results) => {
          if (searchErr) { cleanup(); return reject(searchErr); }
          if (!results || results.length === 0) { cleanup(); return resolve([]); }

          // In test mode, limit to last 80 emails to avoid processing too many
          const targetResults = testMode ? results.slice(-80) : results;

          const fetch = imap.fetch(targetResults, { bodies: "", markSeen: !testMode });
          const promises: Promise<void>[] = [];

          fetch.on("message", (msg, seqno) => {
            const p = new Promise<void>((res) => {
              let rawEmail = "";
              let attributes: any = null;
              msg.on("body", (stream) => {
                stream.on("data", (chunk: Buffer) => { rawEmail += chunk.toString("utf8"); });
              });
              msg.once("attributes", (attrs) => { attributes = attrs; });
              msg.once("end", async () => {
                try {
                  const parsed = await simpleParser(rawEmail);
                  emails.push({
                    uid: attributes?.uid ?? seqno,
                    from: parsed.from?.text ?? "",
                    subject: parsed.subject ?? "",
                    body: parsed.text ?? (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, " ") : "") ?? "",
                    messageId: parsed.messageId ?? `seq-${seqno}`,
                  });
                } finally { res(); }
              });
            });
            promises.push(p);
          });

          fetch.once("end", async () => {
            await Promise.all(promises);
            cleanup();
            resolve(emails);
          });
        });
      });
    });

    imap.once("error", (err: Error) => { cleanup(); reject(err); });
    imap.connect();
  });
}

// ─── Logic Handlers ───────────────────────────────────────────────────────────

/**
 * Handle Booking Confirmation Emails (S1, A1, B1).
 * Purpose: Filling-out all possible booking data.
 */
async function handleBookingConfirmation(subTemplate: string, data: ParsedBookingData, email: any, testMode: boolean): Promise<"created" | "updated" | null> {
  if (!data.checkIn || !data.checkOut) return null;

  // 1. Find existing booking by channel + dates (±1 day)
  const dayMs = 24 * 60 * 60 * 1000;
  const checkInMin = new Date(data.checkIn.getTime() - dayMs);
  const checkInMax = new Date(data.checkIn.getTime() + dayMs);
  const checkOutMin = new Date(data.checkOut.getTime() - dayMs);
  const checkOutMax = new Date(data.checkOut.getTime() + dayMs);

  const candidates = await BookingRepository.findEmailMatchCandidates(data.channel as any, data.property as any);

  const match = candidates.find((b) => 
    b.checkIn >= checkInMin && b.checkIn <= checkInMax &&
    b.checkOut >= checkOutMin && b.checkOut <= checkOutMax
  );

  if (!match) {
    if (testMode) return "created";
    // If not found, create it (iCal hasn't seen it yet)
    console.log(`[Email] No match for ${subTemplate} confirmation. Creating new booking.`);
    const [insertResult] = await BookingRepository.insertBooking({
      icalUid: `email-${data.channel}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      property: data.property ?? "Sadoles",
      channel: data.channel as any,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      status: initialStatus(data.channel as any),
      depositStatus: initialDepositStatus(data.channel as any),
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      guestCountry: data.guestCountry,
      guestCount: data.guestCount ?? (data.adultsCount ?? 0) + (data.childrenCount ?? 0),
      adultsCount: data.adultsCount,
      childrenCount: data.childrenCount,
      animalsCount: data.animalsCount,
      totalPrice: data.totalPrice ? String(data.totalPrice) : undefined,
      commission: data.commission ? String(data.commission) : undefined,
      hostRevenue: data.hostRevenue ? String(data.hostRevenue) : undefined,
      amountPaid: data.amountPaid ? String(data.amountPaid) : "0.00",
      reservationFee: data.amountPaid ? String(data.amountPaid) : undefined,
      currency: data.currency ?? "PLN",
      emailMessageId: email.messageId,
    });
    
    const newId = (insertResult as any).insertId;
    await Logger.bookingAction(newId, "system", `Created via ${subTemplate} email`, `Guest: ${data.guestName}`);
    return "created";
  }

  // 2. Enrich existing booking
  if (testMode) return "updated";

  await BookingRepository.updateBookingDetails(match.id, {
    // For Slowhop, S1 only enriches data; it does NOT confirm the booking (that's for S2).
    // For others (Airbnb/Booking), S1 is the confirmation trigger.
    status: (data.channel === "slowhop" || data.channel === "direct") ? match.status : "confirmed",
    guestName: data.guestName ?? match.guestName,
    guestEmail: data.guestEmail ?? match.guestEmail,
    guestPhone: data.guestPhone ?? match.guestPhone,
    guestCountry: data.guestCountry ?? match.guestCountry,
    guestCount: data.guestCount ?? match.guestCount,
    adultsCount: data.adultsCount ?? match.adultsCount,
    childrenCount: data.childrenCount ?? match.childrenCount,
    animalsCount: data.animalsCount ?? match.animalsCount,
    totalPrice: data.totalPrice ? String(data.totalPrice) : match.totalPrice,
    commission: data.commission ? String(data.commission) : match.commission,
    hostRevenue: data.hostRevenue ? String(data.hostRevenue) : match.hostRevenue,
    amountPaid: data.amountPaid ? String(data.amountPaid) : match.amountPaid,
    reservationFee: data.amountPaid ? String(data.amountPaid) : match.reservationFee,
    currency: data.currency ?? match.currency,
  });

  await Logger.bookingAction(match.id, "enrichment", `Enriched via ${subTemplate} email`, `Data filled: Name, Contact, Prices`);
  return "updated";
}

/**
 * Handle Slowhop S2 (Prepayment/Commission accounting).
 * Purpose: Fill out commission and prepayment details.
 */
async function handleSlowhopS2(data: ParsedBookingData, testMode: boolean): Promise<boolean> {
  if (!data.bookingId) return false;

  const match = await BookingRepository.findSlowhopBySummaryId(data.bookingId);

  if (match) {
    if (testMode) return true;
    await BookingRepository.updateBookingDetails(match.id, {
      status: "confirmed",
      commission: data.commission ? String(data.commission) : match.commission,
      hostRevenue: data.hostRevenue ? String(data.hostRevenue) : match.hostRevenue,
      reservationFee: data.amountPaid ? String(data.amountPaid) : match.reservationFee,
    });
    
    await Logger.bookingAction(match.id, "enrichment", "Enriched via S2 (Accounting) email", "Filled: Commission, Host Revenue, Reservation Fee");
    return true;
  }
  return false;
}

/**
 * Handle Bank Transfer (Template 1).
 */
async function handleBankTransfer(data: ParsedBankData, email: any, testMode: boolean): Promise<boolean> {
  // Use the fuzzy matcher logic
  const results = await findMatchingBookings(data as any, testMode); 
  
  if (results.length > 0) {
    const best = results[0];
    if (best.score >= AUTO_MATCH_THRESHOLD) {
      if (testMode) return true;
      await applyTransferMatch(best.bookingId, data as any, best.score);
      return true;
    }
  }

  return false;
}

// ─── Main Dispatcher ──────────────────────────────────────────────────────────

export async function pollEmails(testMode = false): Promise<{ 
  processed: number; 
  added: number;
  enriched: number; 
  matched: number;
  errors: string[];
  unmatchedBankTransfers: Array<{ subject: string; date: Date; sender: string }>;
  stats: {
    templates: Record<string, number>;
    subTemplates: Record<string, number>;
    bankMatched: number;
    bankUnmatched: number;
  }
}> {
  const start = Date.now();
  let processed = 0;
  let added = 0;
  let enriched = 0;
  let matched = 0;
  const errors: string[] = [];
  const unmatchedBankTransfers: Array<{ subject: string; date: Date; sender: string }> = [];
  
  const stats = {
    templates: { BANK_TRANSFER: 0, BOOKING_CONFIRMATION: 0, OTHER: 0 } as Record<string, number>,
    subTemplates: { S1: 0, S2: 0, A1: 0, B1: 0, UNKNOWN: 0 } as Record<string, number>,
    bankMatched: 0,
    bankUnmatched: 0,
  };

  try {
    const emails = await fetchEmails(testMode);
    console.log(`[EmailPoller] Fetched ${emails.length} emails (testMode: ${testMode}).`);


    for (const email of emails) {
      processed++;
      try {
        const qualified = qualifyEmail(email.from, email.subject, email.body);
        stats.templates[qualified.template]++;
        if (qualified.template === "BOOKING_CONFIRMATION") {
          stats.subTemplates[qualified.subTemplate]++;
        }

        let action: "added" | "enriched" | "matched" | null = null;

        switch (qualified.template) {
          case "BOOKING_CONFIRMATION":
            if (["S1", "A1", "B1"].includes(qualified.subTemplate)) {
              const result = await handleBookingConfirmation(qualified.subTemplate, qualified.data, email, testMode);
              if (result === "created") action = "added";
              else if (result === "updated") action = "enriched";
            } else if (qualified.subTemplate === "S2") {
              const success = await handleSlowhopS2(qualified.data, testMode);
              if (success) action = "enriched";
            }
            break;
          case "BANK_TRANSFER":
            const success = await handleBankTransfer(qualified.data, email, testMode);
            if (success) {
              action = "matched";
              stats.bankMatched++;
            } else {
              stats.bankUnmatched++;
              unmatchedBankTransfers.push({
                subject: email.subject,
                date: qualified.data.transferDate,
                sender: qualified.data.senderName
              });
            }
            break;
          case "OTHER":
            break;
        }

        if (action) {
          if (action === "added") added++;
          else if (action === "enriched") enriched++;
          else if (action === "matched") matched++;
        } else if (!testMode) {
          // Forward unmatched to admin only in normal mode
          const candidates = qualified.template === "BANK_TRANSFER" ? await findMatchingBookings(qualified.data as any, testMode) : [];
          await forwardUnmatchedEmail(email, candidates as any, "unmatched");
        }

      } catch (err) {
        errors.push(`Error in email ${email.subject}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`Polling failed: ${String(err)}`);
  }

  if (!testMode) {
    await Logger.system("email", {
      source: "IMAP Poller",
      newBookings: added + enriched,
      success: errors.length === 0,
      errorMessage: errors.length > 0 ? errors[0] : null,
      durationMs: Date.now() - start,
    });
  }

  return { processed, added, enriched, matched, errors, stats, unmatchedBankTransfers };
}
