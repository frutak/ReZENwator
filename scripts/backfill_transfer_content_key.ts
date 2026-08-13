/**
 * Adds `bank_transfers.contentKey` and fills it for the rows already there.
 *
 * `drizzle-kit migrate` cannot run against this database — its journal is out of
 * sync and it replays from migration 0000 — so the two statements from
 * drizzle/0020_plain_sage.sql are applied here instead, together with the
 * backfill, in one transaction.
 *
 * The unique index is added only once every existing row has a key, so a
 * collision among the current data surfaces as a failed migration rather than a
 * half-applied one. There were none when this was written: 84 transfers,
 * 84 distinct fingerprints.
 *
 * Usage:
 *   npx tsx scripts/backfill_transfer_content_key.ts          # dry run
 *   npx tsx scripts/backfill_transfer_content_key.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { transferContentKey } from "../server/repositories/BankTransferRepository";

const APPLY = process.argv.includes("--apply");

async function columnExists(conn: mysql.Connection, table: string, column: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn: mysql.Connection, table: string, index: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, index]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const hasColumn = await columnExists(conn, "bank_transfers", "contentKey");
  const hasIndex = await indexExists(conn, "bank_transfers", "bank_transfers_contentKey_unique");
  console.log(`contentKey column: ${hasColumn ? "present" : "missing"}`);
  console.log(`unique index:      ${hasIndex ? "present" : "missing"}`);

  const [rows]: any = await conn.query(
    "SELECT id, amount, currency, senderName, transferTitle, transferDate, accountNumber" +
      (hasColumn ? ", contentKey" : "") +
      " FROM bank_transfers ORDER BY id"
  );

  const keyed = rows.map((r: any) => ({ id: r.id, key: transferContentKey(r), current: r.contentKey ?? null }));
  const distinct = new Set(keyed.map((k: any) => k.key));
  const collisions = keyed.length - distinct.size;

  console.log(`\n${keyed.length} transfers, ${distinct.size} distinct fingerprints, ${collisions} collision(s)`);

  if (collisions > 0) {
    const seen = new Map<string, number[]>();
    for (const k of keyed) seen.set(k.key, [...(seen.get(k.key) ?? []), k.id]);
    for (const [key, ids] of seen) {
      if (ids.length > 1) console.log(`  collision on ${key.slice(0, 12)}…: transfers ${ids.join(", ")}`);
    }
    console.log("\nRefusing to add a unique index over colliding rows — resolve these first.");
    await conn.end();
    process.exitCode = 1;
    return;
  }

  const toWrite = keyed.filter((k: any) => k.current !== k.key);
  console.log(`${toWrite.length} row(s) need a key written`);

  if (!APPLY) {
    console.log("\n(dry run — nothing written)");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    if (!hasColumn) {
      await conn.query("ALTER TABLE bank_transfers ADD contentKey varchar(64)");
      console.log("column added");
    }
    for (const k of toWrite) {
      await conn.query("UPDATE bank_transfers SET contentKey = ? WHERE id = ?", [k.key, k.id]);
    }
    console.log(`${toWrite.length} row(s) keyed`);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error(`FAILED, rolled back: ${String(err)}`);
    throw err;
  }

  // Outside the transaction: MySQL commits DDL implicitly anyway, and the index
  // must go on only after every row is keyed.
  if (!hasIndex) {
    await conn.query("ALTER TABLE bank_transfers ADD CONSTRAINT bank_transfers_contentKey_unique UNIQUE (contentKey)");
    console.log("unique index added");
  }

  const [check]: any = await conn.query(
    "SELECT COUNT(*) total, COUNT(contentKey) keyed, COUNT(DISTINCT contentKey) distinctKeys FROM bank_transfers"
  );
  console.table(check);

  await conn.end();
}

main();
