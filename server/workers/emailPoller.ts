import { ENV } from "../_core/env";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { BookingRepository } from "../repositories/BookingRepository";
import { BankTransferRepository } from "../repositories/BankTransferRepository";
import { qualifyEmail, QualifiedEmail, ParsedBookingData, ParsedBankData } from "./emailParsers";
import { findMatchingBookings, applyTransferMatch } from "./bookingMatcher";
import { sendAlertEmail, forwardUnmatchedEmail } from "../_core/email";
import { Logger } from "../_core/logger";
import { initialStatus, initialDepositStatus } from "./icalPoller";
import { format } from "date-fns";
import { createHash } from "crypto";

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

/**
 * Stable identity for an email that carries no Message-ID.
 *
 * IMAP sequence numbers are reassigned on every poll, so deriving an id from
 * them yields a different value each time the same email is seen — which would
 * slip past the unique index on `bank_transfers.externalId` and let a transfer
 * be counted twice. Hash the immutable content instead.
 */
function stableEmailId(from: string, subject: string, body: string): string {
  const digest = createHash("sha256").update([from, subject, body].join("\u0000")).digest("hex");
  return `sha256-${digest}`;
}

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

          // Do NOT mark \Seen here. A message flagged read at fetch time that
          // then fails processing is lost forever (never re-fetched). Instead we
          // flag \Seen only after the handler succeeds — see markEmailsSeen.
          const fetch = imap.fetch(targetResults, { bodies: "", markSeen: false });
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
                  const from = parsed.from?.text ?? "";
                  const subject = parsed.subject ?? "";
                  const body = parsed.text ?? (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, " ") : "") ?? "";
                  emails.push({
                    uid: attributes?.uid ?? seqno,
                    from,
                    subject,
                    body,
                    messageId: parsed.messageId ?? stableEmailId(from, subject, body),
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

/**
 * Mark the given messages (by IMAP UID) as \Seen.
 *
 * Called only for emails whose handler completed without throwing, so a
 * transient failure (DB blip, parser error) leaves the message unread and it is
 * retried on the next poll instead of being silently dropped.
 */
async function markEmailsSeen(uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  const imap = new Imap(getGmailConfig());

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { imap.end(); } catch { /* ignore */ }
      if (err) reject(err); else resolve();
    };

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) return finish(err);
        // UID STORE +FLAGS (\Seen). imap.addFlags is UID-based, matching the
        // UIDs returned by imap.search / carried on message attributes.
        imap.addFlags(uids, "\\Seen", (flagErr) => finish(flagErr ?? undefined));
      });
    });

    imap.once("error", (err: Error) => finish(err));
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
    console.log(`[EmailPoller] No match for ${subTemplate} confirmation (${data.checkIn?.toDateString()}). Creating new booking.`);
    
    let insertResult: any;
    try {
      [insertResult] = await BookingRepository.insertBooking({
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
        totalPrice: data.totalPrice != null ? String(data.totalPrice) : undefined,
        commission: data.commission != null ? String(data.commission) : undefined,
        hostRevenue: data.hostRevenue != null ? String(data.hostRevenue) : undefined,
        amountPaid: data.amountPaid != null ? String(data.amountPaid) : "0.00",
        reservationFee: (data.reservationFee ?? data.amountPaid) != null ? String(data.reservationFee ?? data.amountPaid) : undefined,
        currency: data.currency ?? "PLN",
        emailMessageId: email.messageId,
      });
    } catch (err) {
      console.error("[EmailPoller] Failed to insert booking:", err);
      throw err;
    }
    
    const newId = insertResult?.insertId;
    if (newId) {
      await Logger.bookingAction(newId, "system", `Created via ${subTemplate} email`, `Guest: ${data.guestName}`);
    }
    return "created";
  }

  // 2. Enrich existing booking
  console.log(`[EmailPoller] Found matching booking #${match.id}. Enriching data.`);
  if (testMode) return "updated";

  // Determine if we should update the status
  let newStatus = match.status;
  if (data.channel !== "slowhop") {
    // For Airbnb/Booking, if it's currently pending or it was auto-cancelled (not finished), we can set it to confirmed
    if (match.status === "pending" || match.status === "cancelled") {
      newStatus = "confirmed";
    }
  }

  await BookingRepository.updateBookingDetails(match.id, {
    status: newStatus,
    guestName: data.guestName ?? match.guestName,
    guestEmail: data.guestEmail ?? match.guestEmail,
    guestPhone: data.guestPhone ?? match.guestPhone,
    guestCountry: data.guestCountry ?? match.guestCountry,
    guestCount: data.guestCount ?? match.guestCount,
    adultsCount: data.adultsCount ?? match.adultsCount,
    childrenCount: data.childrenCount ?? match.childrenCount,
    animalsCount: data.animalsCount ?? match.animalsCount,
    totalPrice: data.totalPrice != null ? String(data.totalPrice) : match.totalPrice,
    commission: data.commission != null ? String(data.commission) : match.commission,
    hostRevenue: data.hostRevenue != null ? String(data.hostRevenue) : match.hostRevenue,
    amountPaid: data.amountPaid != null ? String(data.amountPaid) : match.amountPaid,
    reservationFee: (data.reservationFee ?? data.amountPaid) != null ? String(data.reservationFee ?? data.amountPaid) : match.reservationFee,
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
      amountPaid: data.amountPaid != null ? String(data.amountPaid) : match.amountPaid,
      reservationFee: (data.reservationFee ?? data.amountPaid) != null ? String(data.reservationFee ?? data.amountPaid) : match.reservationFee,
    });
    
    await Logger.bookingAction(match.id, "enrichment", "Enriched via S2 (Accounting) email", "Filled: Commission, Host Revenue, Reservation Fee");
    return true;
  }
  return false;
}

/**
 * Handle Bank Transfer (Template 1).
 */
async function handleBankTransfer(data: ParsedBankData | null, email: any, testMode: boolean): Promise<boolean> {
  if (!data) {
    console.error(`[EmailPoller] Failed to parse bank transfer data for email: ${email.subject}`);
    return false;
  }

  // 1. Persist the transfer to the database.
  // This is also the idempotency gate: if the row already exists, the email has
  // been processed before (e.g. re-delivered, or manually marked unread) and the
  // payment must not be applied to the booking a second time.
  if (!testMode) {
    let inserted: boolean;
    try {
      ({ inserted } = await BankTransferRepository.insertTransfer({
        externalId: email.messageId,
        amount: String(data.amount),
        senderName: data.senderName,
        transferTitle: data.transferTitle,
        transferDate: data.transferDate,
        accountNumber: data.accountNumber,
        currency: data.currency,
        status: "pending",
      }));
    } catch (dbErr) {
      // Never fall through to matching on a failed write: without a persisted
      // transfer there is nothing to dedupe against, so a retry would re-apply.
      // The email is already flagged \Seen, so this transfer will not be picked
      // up again — alert rather than drop it silently.
      console.error(`[EmailPoller] Failed to insert bank transfer to DB, skipping match: ${String(dbErr)}`);
      await sendAlertEmail(
        `⚠️ Bank transfer NOT recorded: ${data.senderName} (${data.amount} ${data.currency})`,
        `A bank transfer email was parsed but could not be saved to the database, so it was NOT matched to any booking.\n\n` +
          `Sender: ${data.senderName}\nAmount: ${data.amount} ${data.currency}\nTitle: ${data.transferTitle}\n` +
          `Date: ${data.transferDate?.toISOString()}\nMessage-ID: ${email.messageId}\n\n` +
          `Error: ${String(dbErr)}\n\nThis transfer needs to be matched manually.`
      );
      throw dbErr;
    }

    if (!inserted) {
      console.log(`[EmailPoller] Bank transfer already processed (${email.messageId}), skipping.`);
      return true;
    }
  }

  // 2. Use the fuzzy matcher logic
  const results = await findMatchingBookings(data as any, testMode); 
  
  if (results.length > 0) {
    const best = results[0];
    if (best.score >= AUTO_MATCH_THRESHOLD) {
      if (testMode) return true;

      // 3. Apply the match to the booking AND flag the transfer matched in one
      // transaction — see applyTransferMatch. This replaces the previous
      // two-step (apply, then separately mark matched) that could leave the
      // transfer stuck `pending` if the process died between the two writes.
      await applyTransferMatch(best.bookingId, data as any, best.score, { externalId: email.messageId });

      return true;
    }
  }

  // 5. If we reach here, no auto-match was found.
  // Persist the unmatched email forwarding logic (which already exists in pollEmails caller, 
  // but let's make it cleaner by calling forwardUnmatchedEmail here if it's not a test)
  if (!testMode) {
    const simplifiedCandidates = results.slice(0, 3).map(r => ({
      bookingId: r.bookingId,
      score: r.score,
      guestName: r.booking.guestName,
      checkIn: r.booking.checkIn,
      property: r.booking.property,
    }));

    await forwardUnmatchedEmail(
      { from: email.from, subject: email.subject, body: email.body },
      simplifiedCandidates,
      "unmatched"
    );
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
    subTemplates: { S1: 0, S2: 0, A1: 0, B1: 0, AL1: 0, AH1: 0, UNKNOWN: 0 } as Record<string, number>,
    bankMatched: 0,
    bankUnmatched: 0,
  };

  // UIDs of emails whose handler finished without throwing — flagged \Seen
  // after the loop so a failed email stays unread and is retried next poll.
  const processedUids: number[] = [];

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
            if (["S1", "A1", "B1", "AL1", "AH1"].includes(qualified.subTemplate)) {
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
          // (BANK_TRANSFER is already handled inside handleBankTransfer)
          if (qualified.template !== "BANK_TRANSFER") {
            await forwardUnmatchedEmail(email, [], "unrecognized");
          }
        }

        // Reached only if nothing above threw — safe to mark this email read.
        if (!testMode) processedUids.push(email.uid);

      } catch (err) {
        errors.push(`Error in email ${email.subject}: ${String(err)}`);
      }
    }

    // Flag successfully-handled emails \Seen in a single pass. Failures stay
    // unread and are retried on the next poll.
    if (!testMode) {
      try {
        await markEmailsSeen(processedUids);
      } catch (seenErr) {
        errors.push(`Failed to mark emails seen: ${String(seenErr)}`);
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
