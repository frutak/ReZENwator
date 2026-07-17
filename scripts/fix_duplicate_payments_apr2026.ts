/**
 * One-off correction for the April 2026 duplicate-payment incident.
 *
 * Between Apr 7–9 2026 bank-notification emails were re-processed (emails were
 * marked unread during parser testing). applyTransferMatch had no idempotency
 * gate, so `amountPaid` was incremented again on each replay. See
 * scripts/audit_duplicate_payments.ts for the full audit.
 *
 * Two bookings still hold wrong values:
 *
 *   #42 Stanislaw Zarzycki (Hacjenda, Airbnb)
 *       Its own Payoneer payout of 4151.82 was applied 3x (09:20, 10:33, 10:41
 *       on Apr 7). 4151.82 * 3 = 12455.46.  →  12455.46 must become 4151.82
 *
 *   #39 Nadzeya Rahun (Hacjenda, Booking.com)
 *       Its own Booking.com payout (1003.20) is correct, but Weronika
 *       Dawidzka's 1300 PLN direct transfer — which belongs to booking #63 —
 *       was also credited here (score 47, Apr 7 09:21).
 *       →  2303.20 must become 1003.20
 *
 * Only `amountPaid` is touched. Both bookings are `finished` and their
 * transfer* fields already reference the correct transfer, so they are left
 * alone. Each change is written to booking_activities for traceability.
 *
 * Guarded: a booking is only updated if it still holds the exact wrong value,
 * so re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/fix_duplicate_payments_apr2026.ts          # dry run
 *   npx tsx scripts/fix_duplicate_payments_apr2026.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const CORRECTIONS = [
  {
    id: 42,
    expectCurrent: "12455.46",
    correctTo: "4151.82",
    reason:
      "Corrected duplicate payment: Payoneer payout of 4151.82 PLN was applied 3x on 2026-04-07 " +
      "(replayed bank notification email). 12455.46 -> 4151.82.",
  },
  {
    id: 39,
    expectCurrent: "2303.20",
    correctTo: "1003.20",
    reason:
      "Corrected misattributed payment: 1300 PLN transfer from DAWIDZKA WERONIKA (belongs to booking #63) " +
      "was credited here on 2026-04-07 (score 47). Own Booking.com payout of 1003.20 retained. " +
      "2303.20 -> 1003.20.",
  },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  for (const fix of CORRECTIONS) {
    const [rows]: any = await conn.query(
      "SELECT id, guestName, channel, status, hostRevenue, amountPaid FROM bookings WHERE id = ?",
      [fix.id]
    );
    if (rows.length === 0) {
      console.log(`#${fix.id}: NOT FOUND — skipped`);
      continue;
    }
    const b = rows[0];

    if (b.amountPaid !== fix.expectCurrent) {
      console.log(
        `#${fix.id} (${b.guestName}): amountPaid is ${b.amountPaid}, expected ${fix.expectCurrent} — ` +
          `already corrected or changed. SKIPPED (no write).`
      );
      continue;
    }

    console.log(`#${fix.id} (${b.guestName}, ${b.channel}, ${b.status})`);
    console.log(`   hostRevenue: ${b.hostRevenue}`);
    console.log(`   amountPaid:  ${b.amountPaid}  ->  ${fix.correctTo}`);

    if (!APPLY) {
      console.log(`   (dry run — nothing written)\n`);
      continue;
    }

    await conn.beginTransaction();
    try {
      const [res]: any = await conn.query(
        "UPDATE bookings SET amountPaid = ? WHERE id = ? AND amountPaid = ?",
        [fix.correctTo, fix.id, fix.expectCurrent]
      );
      if (res.affectedRows !== 1) throw new Error(`expected 1 row updated, got ${res.affectedRows}`);

      await conn.query(
        "INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)",
        [fix.id, "manual_edit", "Payment correction (duplicate/misattributed transfer)", fix.reason]
      );
      await conn.commit();
      console.log(`   WRITTEN + logged to booking_activities\n`);
    } catch (err) {
      await conn.rollback();
      console.error(`   FAILED, rolled back: ${String(err)}\n`);
      throw err;
    }
  }

  const [after]: any = await conn.query(
    "SELECT id, guestName, channel, status, hostRevenue, amountPaid FROM bookings WHERE id IN (39,42) ORDER BY id"
  );
  console.log("=== State now ===");
  console.table(after);

  await conn.end();
}

main();
