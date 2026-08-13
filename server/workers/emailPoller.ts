import { ENV } from "../_core/env";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { BookingRepository } from "../repositories/BookingRepository";
import { BankTransferRepository, transferContentKey, classifyTransferSource } from "../repositories/BankTransferRepository";
import { qualifyEmail, QualifiedEmail, ParsedBookingData, ParsedBankData } from "./emailParsers";
import { findMatchingBookings, applyTransferMatch } from "./bookingMatcher";
import { extractDisplayName, extractEmailAddress, matchBookingForEmail } from "./guestReplyMatcher";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";
import { ProcessedEmailRepository } from "../repositories/ProcessedEmailRepository";
import { sendAlertEmail, forwardUnmatchedEmail, GMAIL_USER } from "../_core/email";
import { Logger } from "../_core/logger";
import { initialStatus, initialDepositStatus } from "./icalPoller";
import { format } from "date-fns";
import { normalizeBookingDates } from "@shared/utils";
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
    // Gmail's IMAP frontend is occasionally slow to complete the AUTH exchange.
    // At the old 10s budget roughly one poll in forty died on `timeout-auth`
    // alone; the connection itself was fine, we just stopped waiting. 30s is
    // still far below the 30-minute poll interval, so a slow login costs
    // latency rather than a whole cycle.
    connTimeout: 30000,
    authTimeout: 30000,
  };
}

/**
 * Is this IMAP error worth another attempt?
 *
 * node-imap tags every error it raises with a `source`. The timeout and socket
 * families are transient — the server was slow or the connection dropped — and
 * a second attempt usually succeeds. `authentication` is deliberately excluded:
 * retrying a rejected password is how an account gets locked out, and no amount
 * of retrying fixes a wrong app password.
 */
const TRANSIENT_IMAP_SOURCES = new Set(["timeout", "timeout-auth", "socket", "socket-timeout"]);

function isTransientImapError(err: unknown): boolean {
  const source = (err as { source?: string } | null)?.source;
  if (source) return TRANSIENT_IMAP_SOURCES.has(source);
  // Older node-imap paths and raw socket failures arrive without a source tag.
  const code = (err as { code?: string } | null)?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "ECONNREFUSED";
}

const IMAP_MAX_ATTEMPTS = 3;
const IMAP_RETRY_BASE_MS = 3000;

/**
 * Run an IMAP operation, retrying transient failures with linear backoff.
 *
 * A single dropped login used to cost the entire 30-minute cycle. Nothing was
 * lost — the date-window search plus `processed_emails` means the next poll
 * re-reads the same mail — but a guest's message sat unseen for an extra half
 * hour for no better reason than a slow TLS handshake.
 */
async function withImapRetry<T>(label: string, op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= IMAP_MAX_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isTransientImapError(err) || attempt === IMAP_MAX_ATTEMPTS) break;

      const delay = IMAP_RETRY_BASE_MS * attempt;
      console.warn(
        `[EmailPoller] ${label} failed (attempt ${attempt}/${IMAP_MAX_ATTEMPTS}): ${String(err)}. Retrying in ${delay}ms...`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw lastErr;
}

const AUTO_MATCH_THRESHOLD = 80;

/**
 * How far back a normal poll looks.
 *
 * The poller used to search `UNSEEN` and lean on the \Seen flag as its record of
 * what it had handled. That record is shared with the owner's mail client: a
 * message opened in Gmail before the next poll was never fetched, and a guest's
 * question went unanswered because of it. It now searches by date over a window
 * comfortably wider than any plausible outage and skips what
 * `processed_emails` says is done — read state no longer decides anything.
 */
const POLL_LOOKBACK_DAYS = 7;

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

        // Date window rather than UNSEEN: see POLL_LOOKBACK_DAYS. IMAP wants
        // the RFC 3501 form, `SINCE 29-Jul-2026`, and compares whole days.
        const since = new Date(Date.now() - POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const searchCriteria = testMode
          ? ["ALL"]
          : [["SINCE", format(since, "dd-MMM-yyyy")]];
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

    // `on`, not `once`: node-imap can emit a second error while the socket is
    // torn down (an EPIPE from the logout write is the usual one). With `once`
    // the listener is gone by then, and an 'error' event without a listener
    // takes down the whole process — iCal polling and the watchdog with it.
    // The `isFinished` guard makes the repeat call a no-op, and settling an
    // already-settled promise is ignored.
    imap.on("error", (err: Error) => { cleanup(); reject(err); });
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

    // See fetchEmails: `on` rather than `once` so a follow-up socket error
    // during teardown is absorbed instead of crashing the process.
    imap.on("error", (err: Error) => finish(err));
    imap.connect();
  });
}

// ─── Logic Handlers ───────────────────────────────────────────────────────────

/**
 * True when the confirmation says the guest has settled the whole stay with the
 * portal. The owner has still been paid nothing at this point — the portal owes
 * them the payout — so this maps to `portal_paid`, not to `paid`, and never to an
 * `amountPaid` figure. A partial zaliczka does not qualify.
 */
function settledWithPortalInFull(data: ParsedBookingData): boolean {
  return data.channel !== "slowhop" && data.settledWithPortalInFull === true;
}

/**
 * Handle Booking Confirmation Emails (S1, A1, B1, AL1).
 * Purpose: Filling-out all possible booking data.
 *
 * Exported for the tests, which drive it directly — the alternative is standing
 * up an IMAP server to reach it.
 */
export async function handleBookingConfirmation(subTemplate: string, data: ParsedBookingData, email: any, testMode: boolean): Promise<"created" | "updated" | null> {
  if (!data.checkIn || !data.checkOut) return null;

  // Confirmation mails state a date and no time, and the parsers hand that back
  // as local midnight. Every other way a booking is born settles the hours — the
  // iCal poller for an all-day event, `BookingService` for a manual create — but
  // this path wrote the parse through untouched, so a booking whose mail arrived
  // before its iCal event showed up sat at 00:00 and stayed there: the feed then
  // preserves whatever time the row already has, taking a midnight for a
  // deliberate early arrival. That is how Sofia Krutko's stay (#174) came to
  // read "16 Oct 2026 00:00" in the app and would have told her so by mail.
  const { checkIn, checkOut } = normalizeBookingDates(data.checkIn, data.checkOut);

  // 1a. Prefer an exact match on the channel's reservation number, which some
  // feeds (Alohacamp, Slowhop) put in the iCal summary. This is what the email
  // and the feed genuinely share, so it beats the date window below.
  let match = data.bookingId
    ? await BookingRepository.findBySummaryId(data.channel as any, data.bookingId)
    : null;

  if (match) {
    console.log(`[EmailPoller] Matched ${subTemplate} by reservation no ${data.bookingId} → booking #${match.id}.`);
  }

  // 1b. Fall back to channel + dates (±1 day)
  if (!match) {
    const dayMs = 24 * 60 * 60 * 1000;
    const checkInMin = new Date(checkIn.getTime() - dayMs);
    const checkInMax = new Date(checkIn.getTime() + dayMs);
    const checkOutMin = new Date(checkOut.getTime() - dayMs);
    const checkOutMax = new Date(checkOut.getTime() + dayMs);

    const candidates = await BookingRepository.findEmailMatchCandidates(data.channel as any, data.property as any);

    match = candidates.find((b) =>
      b.checkIn >= checkInMin && b.checkIn <= checkInMax &&
      b.checkOut >= checkOutMin && b.checkOut <= checkOutMax
    ) ?? null;
  }

  if (!match) {
    if (testMode) return "created";
    // If not found, create it (iCal hasn't seen it yet)
    console.log(`[EmailPoller] No match for ${subTemplate} confirmation (${checkIn.toDateString()}). Creating new booking.`);

    let insertResult: any;
    try {
      [insertResult] = await BookingRepository.insertBooking({
        icalUid: `email-${data.channel}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        property: data.property ?? "Sadoles",
        channel: data.channel as any,
        checkIn,
        checkOut,
        status: settledWithPortalInFull(data) ? "portal_paid" : initialStatus(data.channel as any),
        depositStatus: initialDepositStatus(data.channel as any),
        // Mirror the feed's summary so the reservation number stays searchable
        // if the iCal event shows up (or another mail arrives) later on.
        icalSummary: data.bookingId ? `Reservation no ${data.bookingId} (from ${subTemplate} email)` : undefined,
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
        // A confirmation mail never reports money reaching the owner's account —
        // a portal prepayment is recorded as reservationFee and turns into
        // amountPaid only when the portal's forward is matched to a transfer.
        amountPaid: "0.00",
        reservationFee: data.reservationFee != null ? String(data.reservationFee) : undefined,
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
      newStatus = settledWithPortalInFull(data) ? "portal_paid" : "confirmed";
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
    // Never overwritten from a confirmation mail — see the insert path above.
    amountPaid: match.amountPaid,
    reservationFee: data.reservationFee != null ? String(data.reservationFee) : match.reservationFee,
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
    // `amountPaid` is deliberately not written here: the przedpłata this mail
    // reports went to Slowhop, and the forward it announces raises amountPaid
    // when its own bank transfer is matched.
    await BookingRepository.updateBookingDetails(match.id, {
      status: "confirmed",
      commission: data.commission ? String(data.commission) : match.commission,
      hostRevenue: data.hostRevenue ? String(data.hostRevenue) : match.hostRevenue,
      reservationFee: data.reservationFee != null ? String(data.reservationFee) : match.reservationFee,
    });
    
    await Logger.bookingAction(match.id, "enrichment", "Enriched via S2 (Accounting) email", "Filled: Commission, Host Revenue, Reservation Fee");
    return true;
  }
  return false;
}

/**
 * Handle Bank Transfer (Template 1).
 *
 * Exported for the tests, which drive it directly rather than through IMAP.
 */
export async function handleBankTransfer(data: ParsedBankData | null, email: any, testMode: boolean): Promise<boolean> {
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
    let duplicateOf: { id: number; externalId: string; transferDate: Date } | undefined;
    try {
      ({ inserted, duplicateOf } = await BankTransferRepository.insertTransfer({
        externalId: email.messageId,
        // Identifies the payment rather than the message that carried it, so a
        // second notification of the same transfer cannot be applied again.
        contentKey: transferContentKey(data),
        // Portal forward or the guest paying directly — read from the sender.
        source: classifyTransferSource(data),
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
      if (duplicateOf) {
        // Same money, different message. Almost always the same notification
        // reaching the mailbox twice — but it could be a genuine second payment
        // of the identical amount, with the identical title, on the same day,
        // and nothing in the mail distinguishes the two. Refuse to apply it and
        // put the question to the owner, rather than silently doubling a
        // booking's balance or silently dropping real money.
        console.warn(
          `[EmailPoller] Suspected duplicate payment (${data.amount} ${data.currency} from ${data.senderName}); ` +
            `already recorded as transfer #${duplicateOf.id}. Not applied.`
        );
        await sendAlertEmail(
          `⚠️ Podejrzany duplikat wpłaty: ${data.senderName} (${data.amount} ${data.currency})`,
          `Ten sam przelew przyszedł drugi raz, w innej wiadomości — nie zaksięgowałem go ponownie.\n\n` +
            `Kwota: ${data.amount} ${data.currency}\nNadawca: ${data.senderName}\n` +
            `Tytuł: ${data.transferTitle}\nData: ${data.transferDate?.toISOString().slice(0, 10)}\n\n` +
            `Już zapisany jako przelew #${duplicateOf.id} (Message-ID: ${duplicateOf.externalId}).\n` +
            `Ta wiadomość: ${email.messageId}\n\n` +
            `Jeśli to naprawdę DRUGA wpłata o tej samej kwocie, tego samego dnia i z tym samym tytułem, ` +
            `dodaj ją ręcznie w aplikacji. Jeśli to tylko powtórzone powiadomienie — nic nie trzeba robić.`
        );
      } else {
        console.log(`[EmailPoller] Bank transfer already processed (${email.messageId}), skipping.`);
      }
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

/**
 * Longest inbound body we keep.
 *
 * `inboundBody` is a MySQL TEXT column (64 KB), and Polish text can run four
 * bytes per character. A thread with a lot of quoted history could overflow it,
 * and an insert that throws leaves the email unread — so the next poll retries
 * it, fails again, and the mailbox never drains. Truncating loses the tail of a
 * long quote; not truncating loses the pipeline.
 */
const MAX_INBOUND_BODY_CHARS = 16000;

/**
 * Handle an inbound email from a guest.
 *
 * Ingestion only. The sender is matched to a booking and the message recorded;
 * nothing is drafted and nothing is sent. Drafting and sending run as separate
 * passes so that neither can block the poller from draining the mailbox.
 *
 * The caller still forwards the email to the admin exactly as before. That is
 * deliberate for now: until the matcher has been checked against real traffic,
 * recording a row must not cost the owner visibility of the message.
 */
async function handleGuestReply(email: any, testMode: boolean): Promise<"recorded" | "duplicate" | "skipped"> {
  try {
    return await recordGuestReply(email, testMode);
  } catch (err) {
    // Never let this fail the email. Throwing here would leave the message
    // unread — the poller only flags \Seen after a clean handler — so a missing
    // table or a DB blip would wedge the mailbox on the same message every
    // 30 minutes. The admin forward below still delivers it either way, so the
    // worst case is a draft we did not record.
    console.error(`[EmailPoller] Failed to record guest email ${email.messageId}:`, err);
    return "skipped";
  }
}

async function recordGuestReply(email: any, testMode: boolean): Promise<"recorded" | "duplicate" | "skipped"> {
  const address = extractEmailAddress(email.from);
  if (!address) return "skipped";

  // Our own outbound mail coming back (bounce, self-copy) is not a guest.
  if (address === GMAIL_USER.toLowerCase()) return "skipped";

  const match = await matchBookingForEmail(address, new Date(), extractDisplayName(email.from));

  // Neither the address nor the sender's name maps to a booking: this is the
  // generic unrecognized mail the poller has always forwarded — newsletters,
  // spam, portal notices. Recording those would bury real correspondence.
  if (match.method === "none") return "skipped";

  if (testMode) return "recorded";

  const { inserted } = await GuestReplyRepository.insertInbound({
    inboundMessageId: email.messageId,
    bookingId: match.method === "email" || match.method === "name" ? match.booking.id : null,
    matchMethod: match.method,
    inboundFrom: address,
    inboundSubject: (email.subject ?? "").slice(0, 512),
    inboundBody: (email.body ?? "").slice(0, MAX_INBOUND_BODY_CHARS),
    status: "new",
  });

  if (!inserted) {
    console.log(`[EmailPoller] Guest email already recorded (${email.messageId}), skipping.`);
    return "duplicate";
  }

  if (match.method === "email" || match.method === "name") {
    await Logger.bookingAction(
      match.booking.id,
      "email",
      "Received guest email",
      `From ${address}: "${email.subject}"${match.method === "name" ? " (matched by sender name, not address)" : ""}`
    );
  } else {
    console.log(`[EmailPoller] Guest email from ${address} matched ${match.candidates.length} bookings — needs manual resolution.`);
  }

  return "recorded";
}

// ─── Main Dispatcher ──────────────────────────────────────────────────────────

export async function pollEmails(testMode = false): Promise<{ 
  processed: number;
  added: number;
  enriched: number;
  matched: number;
  /** Inbound guest emails recorded for reply drafting. */
  guestReplies: number;
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
  let guestReplies = 0;
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
    const fetched = await withImapRetry("Fetch", () => fetchEmails(testMode));

    // The search window covers a week, so most of what comes back was handled
    // on an earlier poll. Drop those before anything runs: re-handling them
    // would forward the same message to the owner again every 30 minutes.
    const emails = testMode
      ? fetched
      : await (async () => {
          const unprocessed = await ProcessedEmailRepository.filterUnprocessed(
            fetched.map((e) => e.messageId)
          );
          return fetched.filter((e) => unprocessed.has(e.messageId));
        })();

    console.log(
      `[EmailPoller] Fetched ${fetched.length} emails, ${emails.length} new (testMode: ${testMode}).`
    );

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
            // A guest writing in lands here, since no parser claims it. Record
            // it if the sender maps to a booking; the forward below still runs
            // either way.
            if (await handleGuestReply(email, testMode) === "recorded") guestReplies++;
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

        // Reached only if nothing above threw. Recording it here is what stops
        // the next poll from handling it again; a message that failed is left
        // unrecorded on purpose and retried.
        if (!testMode) {
          await ProcessedEmailRepository.markProcessed(email.messageId, email.subject ?? "");
          processedUids.push(email.uid);
        }

      } catch (err) {
        errors.push(`Error in email ${email.subject}: ${String(err)}`);
      }
    }

    // Flagging \Seen is now cosmetic — `processed_emails` decides what gets
    // handled — but it is still what keeps the owner's inbox readable.
    if (!testMode) {
      try {
        await withImapRetry("Mark seen", () => markEmailsSeen(processedUids));
      } catch (seenErr) {
        // Cosmetic only — `processed_emails` already recorded the work, so the
        // next poll will not re-handle these. The inbox just stays bold.
        console.error("[EmailPoller] Failed to mark emails seen:", seenErr);
        errors.push(`Failed to mark emails seen: ${String(seenErr)}`);
      }

      // Entries older than the search window can never be consulted again.
      try {
        await ProcessedEmailRepository.pruneOlderThan(
          new Date(Date.now() - (POLL_LOOKBACK_DAYS + 7) * 24 * 60 * 60 * 1000)
        );
      } catch (pruneErr) {
        console.error("[EmailPoller] Failed to prune processed emails:", pruneErr);
      }
    }
  } catch (err) {
    // Log to stderr as well as to sync_logs. This failure used to be recorded
    // only in the database, so a poll that died left nothing in journalctl but
    // a missing "Fetched N emails" line — the outage was invisible unless you
    // knew to go query the table.
    console.error("[EmailPoller] Poll failed:", err);
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

  return { processed, added, enriched, matched, guestReplies, errors, stats, unmatchedBankTransfers };
}
