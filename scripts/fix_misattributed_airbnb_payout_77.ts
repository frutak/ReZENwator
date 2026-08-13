/**
 * Moves the Airbnb payout of 24.05.2026 from booking #76 to booking #77.
 *
 * Airbnb pays on the second day of a stay. Two Hacjenda stays priced identically
 * (hostRevenue 1352 each) produced two payouts, and both ended up on #76:
 *
 *   transfer #18  24.05  Airbnb    → #77 Katarzyna Maćkowiak, 22–23.05  (day 2 = 23.05, a Saturday)
 *   transfer #36  14.06  Payoneer  → #76 Natalia Kuś,         13–14.06  (day 2 = 14.06)
 *
 * Why the matcher put the first one on the wrong booking: #77's payment had been
 * recorded by hand, which at the time wrote `amountPaid` straight onto the
 * booking and left no transfer row. The portal-payout branch skips candidates
 * that already look fully paid, so #77 was invisible and #76 was the only
 * booking left with a matching hostRevenue — matched at score 100. That hole is
 * closed going forward: a payment entered by hand now creates its own transfer
 * row, and the payout clock added the same day would rank #77 far above #76 for
 * a transfer dated 24.05.
 *
 * No money moves. Both bookings already hold the right amount — #77 from the
 * manual entry, #76 from transfer #36. Only the link is wrong, and with it the
 * answer to "which payout paid for which stay", which is what the reconciliation
 * check and the cashflow view read.
 *
 * Guarded: the transfer is re-pointed only if it is still exactly the row
 * described here and both bookings still hold 1352.00. Re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/fix_misattributed_airbnb_payout_77.ts          # dry run
 *   npx tsx scripts/fix_misattributed_airbnb_payout_77.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const TRANSFER_ID = 18;
const FROM_BOOKING = 76;
const TO_BOOKING = 77;
const AMOUNT = "1352.00";

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const [[transfer]]: any = await conn.query(
    "SELECT id, amount, senderName, DATE_FORMAT(transferDate,'%Y-%m-%d') d, matchedBookingId, status " +
      "FROM bank_transfers WHERE id = ?",
    [TRANSFER_ID]
  );
  if (!transfer) throw new Error(`Transfer #${TRANSFER_ID} not found`);

  if (transfer.matchedBookingId === TO_BOOKING) {
    console.log(`Transfer #${TRANSFER_ID} already points at booking #${TO_BOOKING}. Nothing to do.`);
    await conn.end();
    return;
  }
  if (transfer.matchedBookingId !== FROM_BOOKING || transfer.amount !== AMOUNT || transfer.d !== "2026-05-24") {
    throw new Error(
      `Transfer #${TRANSFER_ID} is not the row this script was written for ` +
        `(booking ${transfer.matchedBookingId}, ${transfer.amount}, ${transfer.d}) — refusing to touch it.`
    );
  }

  const [bookings]: any = await conn.query(
    "SELECT id, guestName, DATE_FORMAT(checkIn,'%d.%m.%Y') przyjazd, hostRevenue, amountPaid " +
      "FROM bookings WHERE id IN (?, ?) ORDER BY id",
    [FROM_BOOKING, TO_BOOKING]
  );
  console.table(bookings);

  for (const b of bookings) {
    if (b.amountPaid !== AMOUNT) {
      throw new Error(`Booking #${b.id} holds ${b.amountPaid}, expected ${AMOUNT} — refusing to touch it.`);
    }
  }

  console.log(
    `\nTransfer #${TRANSFER_ID} (${transfer.amount}, ${transfer.senderName}, ${transfer.d})\n` +
      `  matchedBookingId  ${FROM_BOOKING}  ->  ${TO_BOOKING}\n` +
      `  amountPaid on both bookings: unchanged at ${AMOUNT}\n`
  );

  if (!APPLY) {
    console.log("(dry run — nothing written)");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    const [res]: any = await conn.query(
      "UPDATE bank_transfers SET matchedBookingId = ? WHERE id = ? AND matchedBookingId = ?",
      [TO_BOOKING, TRANSFER_ID, FROM_BOOKING]
    );
    if (res.affectedRows !== 1) throw new Error(`expected 1 row updated, got ${res.affectedRows}`);

    const note =
      `Airbnb payout of ${AMOUNT} from 24.05.2026 (transfer #${TRANSFER_ID}) re-attributed from booking ` +
      `#${FROM_BOOKING} to #${TO_BOOKING}. Airbnb pays on the second day of a stay: #${TO_BOOKING} ran 22–23.05, ` +
      `#${FROM_BOOKING} ran 13–14.06 and is paid by transfer #36 of 14.06. Both stays are priced identically ` +
      `(1352.00), and #${TO_BOOKING} had its payment recorded by hand — which left no transfer row, so the ` +
      `matcher read it as already paid and skipped it. No amounts changed; only the link.`;

    for (const bookingId of [FROM_BOOKING, TO_BOOKING]) {
      await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
        bookingId,
        "manual_edit",
        "Bank transfer re-attributed to the stay it paid for",
        note,
      ]);
    }
    await conn.commit();
    console.log("WRITTEN + logged on both bookings");
  } catch (err) {
    await conn.rollback();
    console.error(`FAILED, rolled back: ${String(err)}`);
    throw err;
  }

  const [after]: any = await conn.query(
    `SELECT b.id, b.guestName, DATE_FORMAT(b.checkIn,'%d.%m.%Y') przyjazd, b.hostRevenue, b.amountPaid,
            COUNT(t.id) przelewy, ROUND(COALESCE(SUM(t.amount),0),2) suma
       FROM bookings b LEFT JOIN bank_transfers t ON t.matchedBookingId = b.id AND t.status = 'matched'
      WHERE b.id IN (?, ?) GROUP BY b.id`,
    [FROM_BOOKING, TO_BOOKING]
  );
  console.table(after);

  await conn.end();
}

main();
