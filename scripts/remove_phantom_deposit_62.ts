/**
 * Removes the phantom kaucja match from booking #62 (Agata Jalosinska, Sadoleś,
 * 10–12.04.2026, Slowhop 1249415).
 *
 * Her 500 zł kaucja reached the account once, on 2026-04-08 — confirmed against
 * the bank statement. It appears twice in the booking's history because bank
 * notification emails were re-processed on Apr 7–9 2026 (they were marked unread
 * during parser testing) while applyTransferMatch still had no idempotency gate:
 * the same notification was matched again on Apr 9 at 12:17:05 UTC, this time
 * scoring 83. That is the same incident as
 * scripts/fix_duplicate_payments_apr2026.ts, which corrected #42 and #39 but did
 * not cover #62.
 *
 * `bookings.amountPaid` needs no correction — the row was already reconciled by
 * hand and holds 2133.50, with no trace of the second 500 — so only the activity
 * row goes, and a note replaces it so the history still explains itself.
 *
 * Guarded: the row is deleted only if it is still the exact phantom match, and
 * only when the genuine Apr 8 match is present alongside it. Re-running is a
 * no-op.
 *
 * Usage:
 *   npx tsx scripts/remove_phantom_deposit_62.ts          # dry run
 *   npx tsx scripts/remove_phantom_deposit_62.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const BOOKING_ID = 62;
/** The duplicate, identified by everything about it, not just its id. */
const PHANTOM = {
  id: 1335,
  action: "Auto-matched bank transfer (Score: 83)",
  details: "Sender: AGATA JAŁOSIŃSKA UL. STANISŁAWA AUG, Amount: 500 PLN, New Status: paid",
};
/** The real one, which must survive. */
const GENUINE_ID = 1321;

const NOTE =
  "Removed a phantom 500 PLN kaucja match (activity #1335, logged 2026-04-09 12:17:05 UTC, score 83). " +
  "The kaucja was paid once, on 2026-04-08 (activity #1321) — verified against the bank statement. " +
  "The duplicate came from bank notification emails being re-processed on Apr 7–9 2026 before " +
  "applyTransferMatch was made idempotent. amountPaid was already correct and was not touched.";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const [rows]: any = await conn.query(
    "SELECT id, bookingId, type, action, details, createdAt FROM booking_activities " +
      "WHERE bookingId = ? AND details LIKE '%Amount: 500 PLN%' ORDER BY id",
    [BOOKING_ID]
  );

  console.log(`Booking #${BOOKING_ID} — 500 PLN matches in history: ${rows.length}`);
  console.table(rows);

  const phantom = rows.find((r: any) => r.id === PHANTOM.id);
  const genuine = rows.find((r: any) => r.id === GENUINE_ID);

  if (!phantom) {
    console.log("Phantom match not present — already removed. Nothing to do.");
    await conn.end();
    return;
  }
  if (!genuine) {
    throw new Error(`Genuine match #${GENUINE_ID} is missing — refusing to delete the only remaining one.`);
  }
  if (phantom.action !== PHANTOM.action || phantom.details !== PHANTOM.details) {
    throw new Error(`Activity #${PHANTOM.id} no longer matches the phantom row — refusing to delete.`);
  }

  console.log(`\nWill delete activity #${phantom.id}: ${phantom.action} — ${phantom.details}`);
  console.log(`Will keep    activity #${genuine.id}: ${genuine.action} — ${genuine.details}`);

  if (!APPLY) {
    console.log("\n(dry run — nothing written)");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    const [res]: any = await conn.query(
      "DELETE FROM booking_activities WHERE id = ? AND bookingId = ? AND details = ?",
      [PHANTOM.id, BOOKING_ID, PHANTOM.details]
    );
    if (res.affectedRows !== 1) throw new Error(`expected 1 row deleted, got ${res.affectedRows}`);

    await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
      BOOKING_ID,
      "manual_edit",
      "Removed duplicate payment entry (kaucja)",
      NOTE,
    ]);
    await conn.commit();
    console.log("\nDELETED + logged to booking_activities");
  } catch (err) {
    await conn.rollback();
    console.error(`\nFAILED, rolled back: ${String(err)}`);
    throw err;
  }

  const [after]: any = await conn.query(
    "SELECT id, type, action, details, createdAt FROM booking_activities " +
      "WHERE bookingId = ? AND (details LIKE '%500 PLN%' OR action LIKE '%duplicate%') ORDER BY id",
    [BOOKING_ID]
  );
  console.log("\n=== History now ===");
  console.table(after);

  const [booking]: any = await conn.query(
    "SELECT id, guestName, status, depositStatus, hostRevenue, amountPaid FROM bookings WHERE id = ?",
    [BOOKING_ID]
  );
  console.table(booking);

  await conn.end();
}

main();
