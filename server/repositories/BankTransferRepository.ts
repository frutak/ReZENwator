import { getDb, type DbExecutor } from "../db";
import { bankTransfers, bookings, type InsertBankTransfer, type BankTransfer } from "../../drizzle/schema";
import { eq, and, isNull, desc, gte, lte, ne, or, sql } from "drizzle-orm";
import type { Property, Channel } from "@shared/config";
import { createHash } from "crypto";
import { payoutSource } from "../services/MatchingEngine";

/**
 * First month with complete transfer data.
 *
 * Bank transfers only started being recorded on 2026-04-30, so April holds a
 * single stray transfer and earlier months none at all. Cashflow is reported
 * from May 2026 onward; anything before that would understate reality rather
 * than simply be empty.
 */
export const CASHFLOW_START_MONTH = "2026-05";

/**
 * Who sent this money — the portal, or the guest paying the owner directly.
 *
 * Read from the sender and title, which is where it is legible: a Slowhop
 * forward says SLOWHOP, an Airbnb payout comes from Payoneer. Everything else is
 * someone paying the owner's account, which for these purposes is "the guest" —
 * including a travelling companion paying on their behalf, as on booking #172.
 *
 * Recording it removes an inference. `calculateAmountsDue` splits what is still
 * owed between the guest and the portal by reading the booking's status, on the
 * assumption that the matcher flips it to `paid` exactly when the guest's
 * balance lands. True today, but an assumption; with the payer stored, the split
 * can be read off the transfers themselves.
 */
export function classifyTransferSource(t: {
  senderName: string;
  transferTitle: string;
}): "portal" | "guest" {
  return payoutSource({ ...t, amount: 0, currency: "PLN", transferDate: new Date(), accountNumber: "" } as any)
    ? "portal"
    : "guest";
}

/**
 * Fingerprint of a payment, independent of the email that reported it.
 *
 * `externalId` answers "have we seen this message?"; this answers "have we seen
 * this money?". The two diverge when the same bank notification reaches the
 * mailbox as a second message — a new Message-ID clears both the
 * `processed_emails` gate and the `externalId` one, and the payment is applied
 * to the booking twice.
 *
 * The date is reduced to a day: the same notification re-delivered can carry a
 * different timestamp, while two genuinely separate payments that agree on
 * amount, sender, title *and* day are rare enough to be worth a look from the
 * owner rather than silent acceptance. Live data backs the shape — across the
 * first 84 transfers there was no content collision at all, though amount and
 * sender alone repeat (ZUS 1600 three times, an Airbnb payout of 2451.25
 * twice), which is why the title and the day belong in the key.
 */
export function transferContentKey(t: {
  amount: string | number;
  currency?: string | null;
  senderName: string;
  transferTitle: string;
  transferDate: Date | string;
  accountNumber?: string | null;
}): string {
  const day = new Date(t.transferDate).toISOString().slice(0, 10);
  const amount = Number(t.amount).toFixed(2);
  const parts = [
    amount,
    (t.currency ?? "PLN").toUpperCase(),
    t.senderName.trim().toUpperCase(),
    t.transferTitle.trim().toUpperCase(),
    day,
    (t.accountNumber ?? "").trim(),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export class BankTransferRepository {
  /**
   * Fetches all transfers with a specific status.
   */
  static async getTransfersByStatus(status: BankTransfer["status"]) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.status, status))
      .orderBy(desc(bankTransfers.transferDate));
  }

  /**
   * Fetches matched transfers joined with their corresponding booking.
   */
  static async getMatchedTransfers() {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        transfer: bankTransfers,
        booking: bookings,
      })
      .from(bankTransfers)
      .leftJoin(bookings, eq(bankTransfers.matchedBookingId, bookings.id))
      .where(eq(bankTransfers.status, "matched"))
      .orderBy(desc(bankTransfers.transferDate));
  }

  /**
   * Fetches a single transfer by its internal ID.
   */
  static async getTransferById(id: number) {
    const db = await getDb();
    if (!db) return null;
    const [result] = await db
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.id, id))
      .limit(1);
    return result || null;
  }

  /**
   * Inserts a new bank transfer record.
   *
   * Two unique indexes stand behind this, and the caller needs to tell them
   * apart:
   *
   *   `externalId`  — the same email again (re-delivered, or re-processed).
   *                   Nothing to say; the payment was already handled.
   *   `contentKey`  — the same *payment* arriving under a different Message-ID.
   *                   Either the notification reached the mailbox twice, or the
   *                   guest really did pay the identical amount, with the
   *                   identical title, on the same day. Only the owner can tell,
   *                   so this comes back as `duplicateOf` for them to be asked.
   *
   * Either way the money must not be applied — a caller that ignores
   * `inserted: false` double-counts the transfer.
   *
   * Pass `executor` to enlist in a transaction the caller owns. The refund flow
   * does: the row is the idempotency gate, so it has to be written and the
   * booking adjusted in one commit, or a crash between them leaves a refund
   * recorded that the price never reflected.
   */
  static async insertTransfer(
    transfer: InsertBankTransfer,
    executor?: DbExecutor
  ): Promise<{ inserted: boolean; duplicateOf?: BankTransfer }> {
    const db = executor ?? (await getDb());
    if (!db) throw new Error("Database not initialized");

    const [result] = await db.insert(bankTransfers).ignore().values(transfer);
    if (result.affectedRows > 0) return { inserted: true };

    // Which of the two indexes rejected it? `INSERT IGNORE` will not say.
    const [existing] = await db
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.externalId, transfer.externalId))
      .limit(1);
    if (existing) return { inserted: false };

    if (transfer.contentKey) {
      const [byContent] = await db
        .select()
        .from(bankTransfers)
        .where(eq(bankTransfers.contentKey, transfer.contentKey))
        .limit(1);
      if (byContent) return { inserted: false, duplicateOf: byContent };
    }

    return { inserted: false };
  }

  /**
   * Reads a transfer and holds the row until the transaction ends.
   *
   * The manual-match flow decides what to do from `matchedBookingId`, so that
   * read has to be inside the same transaction as the writes that follow. Read
   * outside it, two concurrent re-matches of the same transfer (A→B and A→C)
   * both see A as the previous booking, and the second one hands A its money
   * back a second time while B silently keeps it.
   */
  static async getTransferByIdForUpdate(id: number, executor: DbExecutor) {
    const [result] = await executor
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.id, id))
      .limit(1)
      .for("update");
    return result || null;
  }

  /**
   * Bookings whose balance is not backed by the transfers recorded against them.
   *
   * `bookings.amountPaid` and `bank_transfers.matchedBookingId` are two records
   * of the same money that never met. When they disagree, something was applied
   * twice, applied and never recorded, or recorded and never applied — the April
   * 2026 incident was the first kind, and it surfaced only because someone read
   * the mail archive by hand months later.
   *
   * A returned kaucja is subtracted from `amountPaid` when the status flips, so
   * it is subtracted from the expected figure here too.
   *
   * Scope matters more than the arithmetic. Bank transfers have only been
   * recorded since 2026-04-30, so an older booking legitimately carries money
   * with no row behind it — Wysocka's Slowhop forward from January, say. Checking
   * those produces thirteen findings that are all explained by history, and an
   * alert that is wrong on its first day never gets read again. Restricting it to
   * bookings *created* after transfers began gives a check that is clean today
   * (23 bookings, no discrepancies) and widens by itself as new bookings arrive.
   */
  static async findUnreconciled(createdAfter: Date, tolerance = 1) {
    const db = await getDb();
    if (!db) return [];

    const rows = await db.execute(sql`
      SELECT b.id, b.guestName, b.property, b.channel, b.status, b.checkIn,
             b.amountPaid,
             ROUND(SUM(t.amount), 2) AS transfersTotal,
             COUNT(t.id) AS transferCount,
             ROUND(
               CAST(b.amountPaid AS DECIMAL(10,2))
               - (SUM(t.amount) - CASE WHEN b.depositStatus = 'returned' THEN b.depositAmount ELSE 0 END)
             , 2) AS discrepancy
        FROM bookings b
        JOIN bank_transfers t
          ON t.matchedBookingId = b.id AND t.status = 'matched'
       WHERE b.createdAt >= ${createdAfter}
       GROUP BY b.id
      HAVING ABS(discrepancy) > ${tolerance}
       ORDER BY ABS(discrepancy) DESC
    `);

    return (rows as any)[0] as Array<{
      id: number;
      guestName: string | null;
      property: string;
      channel: string;
      status: string;
      checkIn: Date;
      amountPaid: string;
      transfersTotal: string;
      transferCount: number;
      discrepancy: string;
    }>;
  }

  /**
   * Claims a combined payout for splitting.
   *
   * The parent keeps its amount, its sender and its Message-ID — it is the real
   * bank line and the audit trail back to the notification — but stops being
   * money in its own right: `split` is excluded from every sum, because
   * `getMonthlyCashflow` and `findUnreconciled` both filter on `matched`, and
   * from the pending queue, so it does not come back asking to be matched.
   *
   * Conditional on `pending` for the same reason `claimMatch` is conditional:
   * two splits of the same transfer arriving together (a double-click, a client
   * retry) would otherwise both create children and credit every booking twice.
   * MySQL serialises the two writes on the row and the loser sees no rows
   * affected.
   */
  static async claimSplit(transferId: number, executor: DbExecutor): Promise<boolean> {
    const [result] = await executor
      .update(bankTransfers)
      .set({ status: "split", matchedBookingId: null })
      .where(and(eq(bankTransfers.id, transferId), eq(bankTransfers.status, "pending")));

    return result.affectedRows > 0;
  }

  /**
   * Creates one booking's share of a combined payout.
   *
   * The child is an ordinary transfer in every way that matters downstream —
   * one row, one booking, one amount — so reverting it, counting it in the
   * cashflow and reconciling it against `amountPaid` all work with no special
   * case. `parentTransferId` is what says it is not its own bank line.
   *
   * Both unique keys are derived from the parent and the booking rather than
   * from the child's own content: the amounts within a batch can repeat (two
   * identically priced stays paid out together), and a natural fingerprint
   * would then collide between siblings and silently drop one. Derived this
   * way they are stable, so re-running a split inserts nothing the second time
   * and returns the child that already exists.
   */
  static async upsertSplitChild(
    parent: BankTransfer,
    bookingId: number,
    amount: number,
    executor: DbExecutor
  ): Promise<BankTransfer> {
    const suffix = `split:${parent.id}:${bookingId}`;

    await executor
      .insert(bankTransfers)
      .ignore()
      .values({
        externalId: `${parent.externalId}#${suffix}`,
        contentKey: createHash("sha256").update(`${parent.contentKey ?? parent.id}\u0000${suffix}`).digest("hex"),
        source: parent.source,
        amount: amount.toFixed(2),
        senderName: parent.senderName,
        transferTitle: parent.transferTitle,
        transferDate: parent.transferDate,
        accountNumber: parent.accountNumber,
        currency: parent.currency,
        status: "pending",
        parentTransferId: parent.id,
      });

    const [child] = await executor
      .select()
      .from(bankTransfers)
      .where(eq(bankTransfers.externalId, `${parent.externalId}#${suffix}`))
      .limit(1);

    if (!child) throw new Error(`Failed to create split child for booking #${bookingId}`);
    return child;
  }

  /** The shares a combined payout was split into. */
  static async getSplitChildren(parentId: number) {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(bankTransfers).where(eq(bankTransfers.parentTransferId, parentId));
  }

  /** Looks a transfer up by its payment fingerprint. */
  static async findByContentKey(contentKey: string) {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(bankTransfers).where(eq(bankTransfers.contentKey, contentKey)).limit(1);
  }

  /**
   * Claims a transfer for a booking, refusing a repeat of the same pairing.
   *
   * The manual-match endpoint reads the transfer, reverts any previous match and
   * applies the new one. Two of those running at once — a double-click, or a
   * client retry — both read `pending`, so neither reverts anything and both add
   * the amount to the booking. This conditional update is the interlock: MySQL
   * serialises the two writes on the row, and the loser sees `affectedRows: 0`.
   *
   * Re-matching to a *different* booking stays allowed; that is a real
   * correction, and the caller reverts the old booking before applying.
   */
  static async claimMatch(transferId: number, bookingId: number, executor?: DbExecutor): Promise<boolean> {
    const db = executor ?? (await getDb());
    if (!db) throw new Error("Database not initialized");

    const [result] = await db
      .update(bankTransfers)
      .set({ status: "matched", matchedBookingId: bookingId })
      .where(
        and(
          eq(bankTransfers.id, transferId),
          or(ne(bankTransfers.status, "matched"), ne(bankTransfers.matchedBookingId, bookingId), isNull(bankTransfers.matchedBookingId))
        )
      );

    return result.affectedRows > 0;
  }

  /**
   * Updates a transfer's status by its internal ID.
   *
   * Pass `executor` (a transaction handle) to run this write inside the same
   * transaction as the booking-payment update, so the two commit atomically.
   */
  static async updateTransferStatus(id: number, status: BankTransfer["status"], matchedBookingId?: number, executor?: DbExecutor) {
    const db = executor ?? await getDb();
    if (!db) throw new Error("Database not initialized");

    return db.update(bankTransfers)
      .set({
        status,
        matchedBookingId: matchedBookingId ?? null
      })
      .where(eq(bankTransfers.id, id));
  }

  /**
   * Updates a transfer's status by its external ID (email Message-ID).
   *
   * Pass `executor` (a transaction handle) to run this write inside the same
   * transaction as the booking-payment update, so the two commit atomically.
   */
  static async updateTransferStatusByExternalId(externalId: string, status: BankTransfer["status"], matchedBookingId?: number, executor?: DbExecutor) {
    const db = executor ?? await getDb();
    if (!db) throw new Error("Database not initialized");

    return db.update(bankTransfers)
      .set({
        status,
        matchedBookingId: matchedBookingId ?? null
      })
      .where(eq(bankTransfers.externalId, externalId));
  }

  /**
   * Monthly cash inflow, aggregated by the date money actually arrived.
   *
   * This is deliberately different from the booking-based analytics, which
   * group by check-in date: a stay in August paid for in May counts here as
   * May. Only `matched` transfers are included — `ignored` ones are the
   * owner's flag for "not rental income" (ZUS, bailiff, personal transfers).
   *
   * Property/channel filters resolve through the matched booking, so a
   * filtered view necessarily drops transfers whose booking is gone.
   */
  static async getMonthlyCashflow(filters: {
    property?: Property;
    channel?: Channel;
    year?: number;
  } = {}): Promise<Array<{ month: string; total: number; count: number }>> {
    const db = await getDb();
    if (!db) return [];

    const conditions = [eq(bankTransfers.status, "matched")];

    // Never report months whose data is known to be incomplete.
    conditions.push(gte(bankTransfers.transferDate, new Date(`${CASHFLOW_START_MONTH}-01T00:00:00Z`)));

    if (filters.year) {
      conditions.push(gte(bankTransfers.transferDate, new Date(filters.year, 0, 1)));
      conditions.push(lte(bankTransfers.transferDate, new Date(filters.year, 11, 31, 23, 59, 59)));
    }
    if (filters.property) conditions.push(eq(bookings.property, filters.property));
    if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));

    const rows = await db
      .select({
        month: sql<string>`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`,
        total: sql<string>`SUM(${bankTransfers.amount})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(bankTransfers)
      // Inner join: a matched transfer always has a booking, and filtering by
      // property/channel is only meaningful through it.
      .innerJoin(bookings, eq(bookings.id, bankTransfers.matchedBookingId))
      .where(and(...conditions))
      .groupBy(sql`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(${bankTransfers.transferDate}, '%Y-%m')`);

    return rows.map((r) => ({
      month: r.month,
      total: parseFloat(String(r.total ?? "0")) || 0,
      count: Number(r.count ?? 0),
    }));
  }
}
