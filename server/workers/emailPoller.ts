/**
 * Email Polling Service
 *
 * Connects to Gmail via IMAP, fetches unread emails from the dedicated
 * furtka.rentals@gmail.com inbox, parses them using the email parsers,
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
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, syncLogs } from "../../drizzle/schema";
import { parseEmail } from "./emailParsers";
import { findMatchingBookings, applyTransferMatch } from "./bookingMatcher";
import type { ParsedBookingEmail, ParsedBankEmail } from "./emailParsers";

// ─── Configuration ────────────────────────────────────────────────────────────

function getGmailConfig() {
  return {
    user: process.env.GMAIL_USER || "furtka.rentals@gmail.com",
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
  return new Promise((resolve, reject) => {
    const imap = createImapConnection();
    const emails: Array<{ uid: number; from: string; subject: string; body: string; messageId: string }> = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, _box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        imap.search(["UNSEEN"], (searchErr, results) => {
          if (searchErr) {
            imap.end();
            return reject(searchErr);
          }

          if (!results || results.length === 0) {
            imap.end();
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

              msg.on("body", (stream) => {
                stream.on("data", (chunk: Buffer) => {
                  rawEmail += chunk.toString("utf8");
                });
              });

              msg.once("attributes", (attrs) => {
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
                      uid: attrs.uid ?? seqno,
                      from,
                      subject,
                      body,
                      messageId,
                    });
                  } catch (parseErr) {
                    console.error("[Email] Failed to parse email:", parseErr);
                  }
                  res();
                });
              });
            });
            promises.push(p);
          });

          fetch.once("error", (fetchErr) => {
            imap.end();
            reject(fetchErr);
          });

          fetch.once("end", async () => {
            await Promise.all(promises);
            imap.end();
            resolve(emails);
          });
        });
      });
    });

    imap.once("error", (err: Error) => {
      reject(err);
    });

    imap.connect();
  });
}

// ─── Booking enrichment ───────────────────────────────────────────────────────

/**
 * Match a parsed booking email to an existing booking in the database
 * and enrich it with guest details.
 */
async function enrichBookingFromEmail(parsed: ParsedBookingEmail): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

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
    await db.insert(bookings).values({
      property: (parsed.property as "Sadoles" | "Hacjenda") ?? "Sadoles",
      channel: parsed.channel,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      status: "confirmed",
      guestName: parsed.guestName,
      guestEmail: parsed.guestEmail,
      guestPhone: parsed.guestPhone,
      adultsCount: parsed.adultsCount,
      childrenCount: parsed.childrenCount,
      animalsCount: parsed.animalsCount,
      totalPrice: parsed.totalPrice ? String(parsed.totalPrice) : undefined,
      hostRevenue: parsed.hostRevenue ? String(parsed.hostRevenue) : undefined,
      amountPaid: parsed.amountPaid ? String(parsed.amountPaid) : "0.00",
      currency: parsed.currency ?? "PLN",
      emailMessageId: parsed.rawText.substring(0, 100), // simplistic unique ref
    });
    
    return true;
  }

  // Determine new status
  const newStatus =
    match.status === "pending" || match.status === "confirmed"
      ? "confirmed"
      : match.status;

  // Update booking with guest details from email
  await db
    .update(bookings)
    .set({
      status: newStatus,
      guestName: parsed.guestName ?? match.guestName,
      guestEmail: parsed.guestEmail ?? match.guestEmail,
      guestPhone: parsed.guestPhone ?? match.guestPhone,
      adultsCount: parsed.adultsCount ?? match.adultsCount,
      childrenCount: parsed.childrenCount ?? match.childrenCount,
      animalsCount: parsed.animalsCount ?? match.animalsCount,
      totalPrice: parsed.totalPrice ? String(parsed.totalPrice) : match.totalPrice,
      hostRevenue: parsed.hostRevenue != null ? String(parsed.hostRevenue) : match.hostRevenue,
      amountPaid: parsed.amountPaid != null ? String(parsed.amountPaid) : match.amountPaid,
      currency: parsed.currency ?? match.currency,
    })
    .where(eq(bookings.id, match.id));

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

    const db = await getDb();
    if (db) {
      await db.insert(syncLogs).values({
        syncType: "email",
        source: "Gmail IMAP",
        newBookings: 0,
        updatedBookings: 0,
        success: "false",
        errorMessage: msg,
        durationMs: Date.now() - start,
      }).catch(() => {});
    }

    return { processed: 0, enriched: 0, matched: 0, errors };
  }

  for (const email of emails) {
    processed++;
    console.log(`[Email] Processing: "${email.subject}" from ${email.from}`);

    try {
      const parsed = parseEmail(email.from, email.subject, email.body);

      if (!parsed) {
        console.log(`[Email] Skipping unrecognized email: "${email.subject}"`);
        continue;
      }

      console.log(`[Email] Detected type: ${parsed.type}, source: ${"channel" in parsed ? parsed.channel : "bank"}`);

      if (parsed.type === "booking") {
        const success = await enrichBookingFromEmail(parsed);
        if (success) {
          enriched++;
          console.log(`[Email] Successfully enriched booking from "${email.subject}"`);
        } else {
          console.warn(`[Email] Failed to match booking for "${email.subject}"`);
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
            // Store transfer details on the best candidate for manual review
            const db = await getDb();
            if (db) {
              await db
                .update(bookings)
                .set({
                  transferAmount: bankData.amount ? String(bankData.amount) : undefined,
                  transferSender: bankData.senderName,
                  transferTitle: bankData.transferTitle,
                  transferDate: bankData.transferDate,
                  matchScore: best.score,
                })
                .where(eq(bookings.id, best.bookingId));
            }
            console.log(
              `[Email] Low-confidence match for booking #${best.bookingId} (score: ${best.score}) — needs manual review`
            );
          }
        } else {
          console.log(`[Email] No matching booking found for transfer from ${bankData.senderName}`);
        }
      }
    } catch (err) {
      const msg = `Error processing email "${email.subject}": ${String(err)}`;
      console.error(`[Email] ${msg}`);
      errors.push(msg);
    }
  }

  // Log the sync run
  const db = await getDb();
  if (db) {
    await db.insert(syncLogs).values({
      syncType: "email",
      source: "Gmail IMAP",
      newBookings: enriched,
      updatedBookings: matched,
      success: errors.length === 0 ? "true" : "false",
      errorMessage: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
      durationMs: Date.now() - start,
    }).catch(() => {});
  }

  return { processed, enriched, matched, errors };
}
