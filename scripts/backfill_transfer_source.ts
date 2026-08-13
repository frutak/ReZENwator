/**
 * Adds `bank_transfers.source` and fills it for the rows already there.
 *
 * Who sent the money was legible all along — a Slowhop forward says SLOWHOP in
 * the sender, an Airbnb payout comes from Payoneer — but it was read for scoring
 * and thrown away. Storing it turns the guest/portal split in
 * `calculateAmountsDue` from an inference off the booking's status into a fact,
 * and makes the reconciliation check in the daily alert possible at all.
 *
 * The classification is `classifyTransferSource`, the same function the poller
 * now runs at insert time, so the backfill and the live path cannot drift.
 * Payments entered by hand keep `manual`, which the router sets.
 *
 * `drizzle-kit migrate` cannot run against this database, so the ALTER is
 * applied here (see DEPLOYMENT.md).
 *
 * Usage:
 *   npx tsx scripts/backfill_transfer_source.ts          # dry run
 *   npx tsx scripts/backfill_transfer_source.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { classifyTransferSource } from "../server/repositories/BankTransferRepository";

const APPLY = process.argv.includes("--apply");

async function columnExists(conn: mysql.Connection, table: string, column: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const hasColumn = await columnExists(conn, "bank_transfers", "source");
  console.log(`source column: ${hasColumn ? "present" : "missing"}`);

  if (!hasColumn && APPLY) {
    await conn.query("ALTER TABLE bank_transfers ADD source ENUM('portal','guest','manual')");
    console.log("column added");
  }

  const [rows]: any = await conn.query(
    "SELECT id, senderName, transferTitle, amount, externalId" +
      (hasColumn ? ", source" : "") +
      " FROM bank_transfers ORDER BY id"
  );

  const planned = rows.map((r: any) => ({
    id: r.id,
    sender: r.senderName,
    amount: r.amount,
    // A payment recorded by hand is neither a portal payout nor a guest's own
    // transfer; the router stamps those, and its `externalId` is how they are
    // recognised here for rows written before it did.
    source: String(r.externalId).startsWith("manual-") ? "manual" : classifyTransferSource(r),
    current: r.source ?? null,
  }));

  const counts = planned.reduce((acc: Record<string, number>, p: any) => {
    acc[p.source] = (acc[p.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${planned.length} transfers →`, counts);

  console.log("\nPróbka klasyfikacji:");
  console.table(
    planned.slice(0, 8).map((p: any) => ({ id: p.id, kwota: p.amount, nadawca: String(p.sender).slice(0, 42), source: p.source }))
  );

  const toWrite = planned.filter((p: any) => p.current !== p.source);
  console.log(`${toWrite.length} row(s) need writing`);

  if (!APPLY) {
    console.log("\n(dry run — nothing written)");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    for (const p of toWrite) {
      await conn.query("UPDATE bank_transfers SET source = ? WHERE id = ?", [p.source, p.id]);
    }
    await conn.commit();
    console.log(`${toWrite.length} row(s) written`);
  } catch (err) {
    await conn.rollback();
    console.error(`FAILED, rolled back: ${String(err)}`);
    throw err;
  }

  const [after]: any = await conn.query(
    "SELECT source, COUNT(*) ile, ROUND(SUM(amount), 2) suma FROM bank_transfers GROUP BY source"
  );
  console.table(after);

  await conn.end();
}

main();
