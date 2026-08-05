import { inArray, lt } from "drizzle-orm";
import { getDb } from "../db";
import { processedEmails } from "../../drizzle/schema";

/**
 * The poller's memory of which emails it has already handled.
 *
 * Replaces the IMAP \Seen flag in that role. The flag was shared state: the
 * owner reading a message in Gmail before the next poll made the poller skip it
 * forever, which is how a guest's question went unanswered. This table is ours
 * alone, so what the mailbox looks like no longer decides what gets processed.
 */
export class ProcessedEmailRepository {
  /** Message ids from the batch that have not been handled yet. */
  static async filterUnprocessed(messageIds: string[]): Promise<Set<string>> {
    const remaining = new Set(messageIds);
    if (remaining.size === 0) return remaining;

    const db = await getDb();
    // No database means no memory of past polls. Processing everything again is
    // the wrong answer — duplicate forwards to the owner — so treat the whole
    // batch as handled and let the next poll with a working DB sort it out.
    if (!db) return new Set();

    const rows = await db
      .select({ messageId: processedEmails.messageId })
      .from(processedEmails)
      .where(inArray(processedEmails.messageId, [...remaining]));

    for (const row of rows) remaining.delete(row.messageId);
    return remaining;
  }

  /**
   * Records an email as handled.
   *
   * Insert-ignore because two overlapping polls can reach the same message, and
   * the second one losing the race is not an error.
   */
  static async markProcessed(messageId: string, subject: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db
      .insert(processedEmails)
      .ignore()
      .values({ messageId, subject: subject.slice(0, 512) });
  }

  /**
   * Drops entries older than the poller's lookback window.
   *
   * They can never be matched against again — the search no longer returns
   * those messages — so keeping them only grows the table.
   */
  static async pruneOlderThan(cutoff: Date): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.delete(processedEmails).where(lt(processedEmails.processedAt, cutoff));
  }
}
