/**
 * One-off: record the 500 PLN already refunded to the guest on booking #157.
 *
 * Olga Korzeniowska's stay was reduced by 500 after a complaint, and the money
 * went back in the same bank transfer as the 500 kaucja. Only half of that was
 * ever recorded: the price and `amountPaid` were corrected by hand on
 * 2026-08-31, and the kaucja return is carried by `depositStatus`, but nothing
 * recorded the 500 leaving the account. The booking therefore claimed 4760
 * received against 5760 of matched transfers less the 500 kaucja — the −500 the
 * daily reconciliation alert has been reporting.
 *
 * This writes the missing transfer row and nothing else. Running
 * BookingService.refundToGuest here would cut the price a second time; the
 * price side of that correction is already done.
 *
 * The row is built exactly as refundToGuest builds it, so its content key
 * matches and a later refund of the same shape still collides with it.
 *
 * Idempotent via externalId/contentKey — re-running is a no-op.
 *
 * Usage: npx tsx scripts/record_refund_157.ts [--apply]
 */
import "dotenv/config";
import { getDb, pool } from "../server/db";
import { bookings } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { BankTransferRepository, transferContentKey } from "../server/repositories/BankTransferRepository";
import { Logger } from "../server/_core/logger";

const BOOKING_ID = 157;
const AMOUNT = 500;
/** The day the correction was made; the outgoing transfer went with it. */
const REFUND_DATE = new Date("2026-08-31T12:00:00Z");
const APPLY = process.argv.includes("--apply");

/** What the reconciliation query computes for one booking. */
async function reconcile(db: any) {
  const rows = await db.execute(sql`
    SELECT b.amountPaid,
           ROUND(SUM(t.amount), 2) AS transfersTotal,
           ROUND(
             CAST(b.amountPaid AS DECIMAL(10,2))
             - (SUM(t.amount) - CASE WHEN b.depositStatus = 'returned' THEN b.depositAmount ELSE 0 END)
           , 2) AS discrepancy
      FROM bookings b
      JOIN bank_transfers t ON t.matchedBookingId = b.id AND t.status = 'matched'
     WHERE b.id = ${BOOKING_ID}
     GROUP BY b.id
  `);
  return (rows as any)[0][0];
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const [b] = await db.select().from(bookings).where(eq(bookings.id, BOOKING_ID));
  if (!b) throw new Error(`Booking #${BOOKING_ID} not found`);
  console.log("Booking:", {
    guestName: b.guestName,
    totalPrice: b.totalPrice,
    amountPaid: b.amountPaid,
    depositStatus: b.depositStatus,
    depositAmount: b.depositAmount,
  });
  console.log("Reconciliation BEFORE:", await reconcile(db));

  const row = {
    amount: String((-AMOUNT).toFixed(2)),
    currency: b.currency ?? "PLN",
    senderName: b.guestName || "Gość",
    transferTitle: `Zwrot części ceny (#${BOOKING_ID})`,
    transferDate: REFUND_DATE,
    accountNumber: "",
  };
  const contentKey = transferContentKey(row);
  const insert = {
    ...row,
    externalId: `refund-${contentKey.slice(0, 32)}`,
    contentKey,
    source: "manual" as const,
    status: "matched" as const,
    matchedBookingId: BOOKING_ID,
  };

  if (!APPLY) {
    console.log("DRY RUN — would insert:", insert);
    console.log("Re-run with --apply to write it.");
    return;
  }

  const { inserted, duplicateOf } = await BankTransferRepository.insertTransfer(insert);
  if (!inserted) {
    console.log(`Already recorded${duplicateOf ? ` as transfer #${duplicateOf.id}` : ""} — no-op.`);
    return;
  }

  await Logger.bookingAction(
    BOOKING_ID,
    "manual_edit",
    `Refunded ${AMOUNT.toFixed(2)} PLN to guest`,
    "Backfill: the price cut and amountPaid were corrected by hand on 2026-08-31; " +
      "this records the money that left the account in the same transfer as the kaucja return."
  );

  console.log("Reconciliation AFTER:", await reconcile(db));
}

main()
  .then(() => pool?.end())
  .catch((err) => {
    console.error(err);
    pool?.end();
    process.exit(1);
  });
