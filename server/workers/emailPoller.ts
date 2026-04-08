import { ENV } from "../_core/env";

/**
 * Email Polling Service
 *
 * Connects to Gmail via IMAP, fetches unread emails from the configured
 * inbox, parses them using the email parsers,
 * and updates bookings in the database accordingly.
 *
 * For booking channel emails (Slowhop, Airbnb): enriches the matching
 * booking with guest details and moves status to 'confirmed'.
 *
 * For bank emails (Nestbank): runs fuzzy matching against existing bookings
 * and automatically marks high-confidence matches as 'paid'.
 */

import Imap from "imap";
import { simpleParser } from "mailparser";
import { and, eq, or, like, lte } from "drizzle-orm";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { parseEmail } from "./emailParsers";
import { findMatchingBookings, applyTransferMatch } from "./bookingMatcher";
import type { ParsedBookingEmail, ParsedBankEmail } from "./emailParsers";
import { sendAlertEmail, forwardUnmatchedEmail } from "../_core/email";
import { Logger } from "../_core/logger";
import { initialStatus, initialDepositStatus } from "./icalPoller";

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

/** Auto-confirm threshold: if match score >= this, auto-mark as paid */
const AUTO_MATCH_THRESHOLD = 75;

// ─── IMAP helpers ─────────────────────────────────────────────────────────────

function createImapConnection(): Imap {
  return new Imap(getGmailConfig());
}

async function fetchUnseenEmails(): Promise<
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
        clearTimeout(timeout);
        imap.end();
      }
    };

    const timeout = setTimeout(() => {
      console.warn("[Email] IMAP connection timed out after 45s");
      cleanup();
      reject(new Error("IMAP connection timeout"));
    }, 45000);

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, _box) => {
        if (err) {
          cleanup();
          return reject(err);
        }

        imap.search(["UNSEEN"], (searchErr, results) => {
          if (searchErr) {
            cleanup();
            return reject(searchErr);
          }

          if (!results || results.length === 0) {
            cleanup();
            return resolve([]);
          }

          const fetch = imap.fetch(results, {
            bodies: "",
            markSeen: true,
            struct: true,
          });

          const promises: Promise<void>[] = [];

          fetch.on("message", (msg, seqno) => {
            const p = new Promise<void>((res) => {
              let rawEmail = "";
              let attributes: any | null = null;

              msg.on("body", (stream) => {
                stream.on("data", (chunk: Buffer) => {
                  rawEmail += chunk.toString("utf8");
                });
              });

              msg.once("attributes", (attrs) => {
                attributes = attrs;
              });

              msg.once("end", async () => {
                try {
                  const parsed = await simpleParser(rawEmail);
                  const from = parsed.from?.text ?? "";
                  const subject = parsed.subject ?? "";
                  const body =
                    parsed.text ??
                    (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, " ") : undefined) ??
                    "";
                  const messageId = parsed.messageId ?? `seq-${seqno}`;

                  emails.push({
                    uid: attributes?.uid ?? seqno,
                    from,
                    subject,
                    body,
                    messageId,
                  });
                } catch (parseErr) {
                  console.error("[Email] Failed to parse email:", parseErr);
                } finally {
                  res();
                }
              });

              // Add a per-message timeout
              setTimeout(() => res(), 15000);
            });
            promises.push(p);
          });

          fetch.on("error", (fetchErr) => {
            console.error("[Email] Fetch error:", fetchErr);
          });

          fetch.once("end", async () => {
            try {
              await Promise.all(promises);
            } catch (err) {
              console.error("[Email] Error waiting for all email parses:", err);
            } finally {
              cleanup();
              resolve(emails);
            }
          });
        });
      });
    });

    imap.once("error", (err: Error) => {
      cleanup();
      reject(err);
    });

    imap.connect();
  });
}

// ─── Booking enrichment ───────────────────────────────────────────────────────

/**
 * Process a payment confirmation email (Booking.com).
 * Matches by Booking Object ID and updates status to 'finished'.
 */
async function processPaymentConfirmation(parsed: ParsedBookingEmail): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // 1. Specialized logic for Booking.com payouts
  // These come from the bank (Nestbank) but are detected as booking_payment
  if (parsed.channel === "booking" && parsed.isPaymentConfirmation) {
    const transferAmount = parsed.amountPaid || 0;
    
    // Find all 'portal_paid' bookings for this property that have finished (checkOut < now)
    const now = new Date();
    const candidates = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.channel, "booking"),
          eq(bookings.status, "portal_paid"),
          parsed.property ? eq(bookings.property, parsed.property as any) : undefined,
          lte(bookings.checkOut, now)
        )
      );

    // Try to find a match by amount (hostRevenue)
    const match = candidates.find(c => {
      const hostRevenue = parseFloat(String(c.hostRevenue || "0"));
      // Check for exact match or very close (±0.05 for rounding differences)
      return Math.abs(hostRevenue - transferAmount) < 0.05;
    });

    if (match) {
      await db
        .update(bookings)
        .set({
          status: "finished",
          amountPaid: String(transferAmount.toFixed(2)),
          transferAmount: String(transferAmount),
          transferDate: new Date(),
          transferTitle: `Booking.com Payout Match (${parsed.bookingObjectId ?? "N/A"})`,
        })
        .where(eq(bookings.id, match.id));

      await Logger.bookingAction(match.id, "status_change", "Marked as FINISHED via payout matching", `Source: Booking.com payment email (${parsed.bookingObjectId ?? "N/A"})`);

      console.log(`[Email] Booking #${match.id} marked as FINISHED via payout matching`);
      return true;
    } else {
      // No match found - send alert email to host
      const subject = `⚠️ Unmatched Booking.com Payout: ${parsed.property ?? "Unknown"}`;
      const text = `
        Received a Booking.com payout that couldn't be automatically matched to any finished reservation.
        
        Property: ${parsed.property ?? "Unknown"}
        Amount: ${transferAmount.toFixed(2)} PLN
        Object ID: ${parsed.bookingObjectId ?? "Unknown"}
        
        Please review the bookings manually.
      `.trim();
      
      await sendAlertEmail(subject, text);
      return false;
    }
  }

  // 2. Fallback logic for other payment confirmations (matching by ID/name)
  const candidates = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, "booking"),
        parsed.property ? eq(bookings.property, parsed.property as any) : undefined,
        or(
          parsed.bookingObjectId ? like(bookings.icalSummary, `%${parsed.bookingObjectId}%`) : undefined,
          parsed.bookingObjectId ? like(bookings.notes, `%${parsed.bookingObjectId}%`) : undefined,
          parsed.bookingObjectId ? like(bookings.emailMessageId, `%${parsed.bookingObjectId}%`) : undefined,
          parsed.guestName ? like(bookings.guestName, `%${parsed.guestName}%`) : undefined
        )
      )
    );

  if (candidates.length === 0) {
    console.warn(`[Email] No matching booking found for Payment Confirmation (ID: ${parsed.bookingObjectId}, Guest: ${parsed.guestName})`);
    return false;
  }

  // Prioritize "portal_paid" status if multiple exist (unlikely but safe)
  const match = candidates.find(c => c.status === "portal_paid") || candidates[0]!;
  
  const currentPaid = parseFloat(String(match.amountPaid || "0"));
  const transferAmount = parsed.amountPaid || 0;
  const newPaid = (currentPaid + transferAmount).toFixed(2);

  await db
    .update(bookings)
    .set({
      status: "finished",
      amountPaid: newPaid,
      transferAmount: transferAmount ? String(transferAmount) : undefined,
      transferDate: new Date(),
      transferTitle: `Booking.com Payment Confirmation (${parsed.bookingObjectId ?? parsed.guestName})`,
    })
    .where(eq(bookings.id, match.id));

  await Logger.bookingAction(match.id, "status_change", "Marked as FINISHED via payment confirmation", `Source: Booking.com email (${parsed.bookingObjectId ?? parsed.guestName})`);

  console.log(`[Email] Booking #${match.id} (Status: ${match.status}) marked as FINISHED via payment confirmation (${parsed.bookingObjectId ?? parsed.guestName})`);
  return true;
}

/**
 * Match a parsed booking email to an existing booking in the database
 * and enrich it with guest details.
 */
async function enrichBookingFromEmail(parsed: ParsedBookingEmail): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Special case: Payment confirmations
  if (parsed.isPaymentConfirmation) {
    return processPaymentConfirmation(parsed);
  }

  if (!parsed.checkIn || !parsed.checkOut) {
    console.warn("[Email] Booking email missing dates, cannot match");
    return false;
  }

  // Find matching booking by channel + approximate dates (±1 day tolerance)
  const dayMs = 24 * 60 * 60 * 1000;
  const checkInMin = new Date(parsed.checkIn.getTime() - dayMs);
  const checkInMax = new Date(parsed.checkIn.getTime() + dayMs);
  const checkOutMin = new Date(parsed.checkOut.getTime() - dayMs);
  const checkOutMax = new Date(parsed.checkOut.getTime() + dayMs);

  const candidates = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, parsed.channel),
        parsed.property ? eq(bookings.property, parsed.property as "Sadoles" | "Hacjenda") : undefined
      )
    );

  const match = candidates.find((b) => {
    const checkInOk =
      b.checkIn >= checkInMin && b.checkIn <= checkInMax;
    const checkOutOk =
      b.checkOut >= checkOutMin && b.checkOut <= checkOutMax;
    return checkInOk && checkOutOk;
  });

  if (!match) {
    console.log(
      `[Email] No matching booking found for ${parsed.channel} email (${parsed.checkIn.toDateString()}). Creating new record.`
    );
    
    // If no match found, create a new booking record instead of failing
    const adults = parsed.adultsCount ?? 0;
    const children = parsed.childrenCount ?? 0;
    const totalGuests = (adults + children) > 0 ? (adults + children) : (parsed.guestCount ?? 0);

    const [insertResult] = await db.insert(bookings).values({
      icalUid: `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      property: (parsed.property as "Sadoles" | "Hacjenda") ?? "Sadoles",
      channel: parsed.channel,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      status: initialStatus(parsed.channel),
      depositStatus: initialDepositStatus(parsed.channel),
      guestName: parsed.guestName,
      guestEmail: parsed.guestEmail,
      guestPhone: parsed.guestPhone,
      guestCountry: parsed.guestCountry,
      guestCount: totalGuests,
      adultsCount: adults,
      childrenCount: children,
      animalsCount: parsed.animalsCount,
      totalPrice: parsed.totalPrice ? String(parsed.totalPrice) : undefined,
      commission: parsed.commission ? String(parsed.commission) : undefined,
      hostRevenue: parsed.hostRevenue ? String(parsed.hostRevenue) : undefined,
      amountPaid: parsed.amountPaid ? String(parsed.amountPaid) : "0.00",
      reservationFee: parsed.amountPaid ? String(parsed.amountPaid) : undefined,
      currency: parsed.currency ?? "PLN",
      emailMessageId: parsed.rawText.substring(0, 100), // simplistic unique ref
    });
    
    const newBookingId = (insertResult as any).insertId;
    if (newBookingId) {
      await Logger.bookingAction(newBookingId, "system", "Created via email parsing", `Channel: ${parsed.channel}`);
    }

    return true;
  }

  // Determine new status
  const newStatus =
    match.status === "pending" || match.status === "confirmed" || match.status === "portal_paid"
      ? "confirmed"
      : match.status;

  const adults = parsed.adultsCount ?? match.adultsCount ?? 0;
  const children = parsed.childrenCount ?? match.childrenCount ?? 0;
  const totalGuests = (adults + children) > 0 ? (adults + children) : (parsed.guestCount ?? match.guestCount);

  // Update booking with guest details from email
  const newAmountPaid = parsed.amountPaid != null 
    ? (parseFloat(String(match.amountPaid || "0")) > parsed.amountPaid ? match.amountPaid : String(parsed.amountPaid))
    : match.amountPaid;
  
  const newReservationFee = parsed.amountPaid != null 
    ? (parseFloat(String(match.reservationFee || "0")) > parsed.amountPaid ? match.reservationFee : String(parsed.amountPaid))
    : match.reservationFee;

  await db
    .update(bookings)
    .set({
      status: newStatus,
      guestName: parsed.guestName ?? match.guestName,
      guestEmail: parsed.guestEmail ?? match.guestEmail,
      guestPhone: parsed.guestPhone ?? match.guestPhone,
      guestCountry: parsed.guestCountry ?? match.guestCountry,
      guestCount: totalGuests,
      adultsCount: adults,
      childrenCount: children,
      animalsCount: parsed.animalsCount ?? match.animalsCount,
      totalPrice: parsed.totalPrice ? String(parsed.totalPrice) : match.totalPrice,
      commission: parsed.commission ? String(parsed.commission) : match.commission,
      hostRevenue: parsed.hostRevenue != null ? String(parsed.hostRevenue) : match.hostRevenue,
      amountPaid: newAmountPaid,
      reservationFee: newReservationFee,

      currency: parsed.currency ?? match.currency,
    })
    .where(eq(bookings.id, match.id));

  await Logger.bookingAction(match.id, "enrichment", "Enriched with guest details from email", `Channel: ${parsed.channel}, Guest: ${parsed.guestName}`);

  console.log(
    `[Email] Enriched booking #${match.id} (${parsed.channel}) with guest: ${parsed.guestName}`
  );
  return true;
}

// ─── Main polling function ────────────────────────────────────────────────────

export async function pollEmails(): Promise<{
  processed: number;
  enriched: number;
  matched: number;
  errors: string[];
}> {
  const start = Date.now();
  let processed = 0;
  let enriched = 0;
  let matched = 0;
  const errors: string[] = [];

  const config = getGmailConfig();
  if (!config.password) {
    const msg = "Gmail app password not configured (GMAIL_APP_PASSWORD env var missing)";
    console.warn(`[Email] ${msg}`);
    return { processed: 0, enriched: 0, matched: 0, errors: [msg] };
  }

  let emails: Awaited<ReturnType<typeof fetchUnseenEmails>>;
  try {
    emails = await fetchUnseenEmails();
    console.log(`[Email] Fetched ${emails.length} unread email(s)`);
  } catch (err) {
    const msg = `Failed to fetch emails: ${String(err)}`;
    console.error(`[Email] ${msg}`);
    errors.push(msg);

    await Logger.system("email", {
      source: "Gmail IMAP",
      success: false,
      errorMessage: msg,
      durationMs: Date.now() - start,
    });

    return { processed: 0, enriched: 0, matched: 0, errors };
  }

  for (const email of emails) {
    processed++;
    console.log(`[Email] Processing: "${email.subject}" from ${email.from}`);

    try {
      const parsed = parseEmail(email.from, email.subject, email.body);

      if (!parsed) {
        console.log(`[Email] Skipping and forwarding unrecognized email: "${email.subject}"`);
        await forwardUnmatchedEmail(email, [], "unrecognized");
        continue;
      }

      console.log(`[Email] Detected type: ${parsed.type}, source: ${"channel" in parsed ? parsed.channel : "bank"}`);

      if (parsed.type === "booking") {
        const success = await enrichBookingFromEmail(parsed);
        if (success) {
          enriched++;
          console.log(`[Email] Successfully processed booking email: "${email.subject}"`);
        } else {
          console.warn(`[Email] Failed to match or create booking for "${email.subject}" — forwarding`);
          await forwardUnmatchedEmail(email, [], "unmatched");
        }
      } else if (parsed.type === "bank") {
        const bankData = parsed as ParsedBankEmail;
        const candidates = await findMatchingBookings(bankData);

        if (candidates.length > 0) {
          const best = candidates[0]!;
          if (best.score >= AUTO_MATCH_THRESHOLD) {
            await applyTransferMatch(best.bookingId, bankData, best.score);
            matched++;
            console.log(
              `[Email] Auto-matched transfer to booking #${best.bookingId} (score: ${best.score})`
            );
          } else {
            console.log(
              `[Email] Low-confidence match for booking #${best.bookingId} (score: ${best.score}) — forwarding to admin without updating DB`
            );
            await forwardUnmatchedEmail(email, candidates, "unmatched");
          }
        } else {
          console.log(`[Email] No matching booking found for transfer from ${bankData.senderName} — forwarding to admin`);
          await forwardUnmatchedEmail(email, [], "unmatched");
        }
      }
    } catch (err) {
      const msg = `Error processing email "${email.subject}": ${String(err)}`;
      console.error(`[Email] ${msg}`);
      errors.push(msg);
    }
  }

  // Log the sync run
  await Logger.system("email", {
    source: "Gmail IMAP",
    newBookings: enriched,
    updatedBookings: matched,
    success: errors.length === 0,
    errorMessage: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
    durationMs: Date.now() - start,
  });

  return { processed, enriched, matched, errors };
}
